// Singing a melody into an instrument, without the DOM: a take's pitch, frame by frame, then
// notes on the grid.
//
// The voice is heard in frames, every hundredth of a second: its pitch (YIN, on the sound
// brought down to about 16 kHz, enough for a voice) and its level. A frame an octave from the
// voice around it is YIN's mistake, and brought back. Notes are found first, then each is
// given one pitch. A note starts when the voice starts, after a short silence (the "fr" of
// "frère") or a deep dip in level (the "d" of "doo doo" on one pitch), or where the pitch
// jumps; a slow drift is not a jump, so a note sung across the line between two semitones
// stays one note, and a piece too short to be a note (a slide into one) belongs to the note
// it leads to. A note's pitch is the median of its frames, rounded to the nearest semitone
// after taking out how sharp or flat the singer is on the whole take (a voice a quarter tone
// low throughout is still singing in tune with itself).
//
// Then the notes are cleaned onto the sixteenth grid, as a singer means them: the take moved
// by how late it is (a delay the browser does not tell, and the singer's), a note held over
// a breath up to the next, a single step glued to a note beside it taken as part of it.
//
// The thresholds were set on recorded takes (tests/sing-takes), two voices singing over the
// click, and the test scores each change on them. Recording with echo cancellation, the
// voice's level drops after each click and overshoots: that is why a dip must be deep.
//
// A drum takes the starts of sounds instead (claps, "ts", "k"), each one a hit, moved onto
// the grid the same way.
//
// A take is first brought to the level of those takes: a microphone without automatic gain
// can be ten times quieter, and the thresholds below are levels.

import { HIGHEST, LOWEST, type Note } from '../../runtime/sound'

/** Seconds between two frames. */
export const HOP = 0.01
/** The rate the voice is analysed at, about: plenty for a voice's pitch. */
const TARGET_RATE = 16000
/** Seconds of sound each pitch is measured on. */
const WINDOW = 0.032
/** The range of a voice, in Hz: a low bass to a high soprano, whistling a little above. */
const LOWEST_HZ = 65
const HIGHEST_HZ = 1100
/** YIN's threshold: below it, the sound repeats enough to have a pitch. */
const CLARITY = 0.15
/** Quieter than this (RMS, full scale = 1) is not a voice. */
const QUIET = 0.008
/** A level falling under this part of the note's recent peak ends it (a new syllable). */
const DIP = 0.15
/** Frames without pitch that end a note (20 ms): a consonant between two syllables. */
const GAP = 2
/** Frames without pitch that surely end a note (40 ms): fewer may be YIN losing the voice. */
const LOST = 4
/** Frames a note needs to count, and the frames each side of a jump compared (50 ms). */
const SETTLE = 5
/** A jump in pitch, in semitones, that starts a new note: more than a voice wobbles, less
 * than a semitone sung a little narrow. */
const JUMP_PITCH = 0.7
/** Frames a piece of a note needs to be a note of its own (120 ms); shorter, it is a slide. */
const PIECE = 12
/** Frames each side a frame's pitch is compared with, to find it an octave off (100 ms). */
const OCTAVE_AROUND = 10
/** Steps between two notes, at most, that are not a rest but a breath: the note before lasts. */
const LEGATO = 2
/** Milliseconds a take may be late (or early), all delays the browser does not tell. */
const EARLIEST = -100
const LATEST = 400
/** The grid a take is moved onto, in steps, and how much each line counts. */
const GRID: [number, number][] = [[4, 1], [2, 0.5], [1, 0.25]]
/** Steps, about, a note sung on a line is off from it. */
const ON_GRID = 0.2
/** What a second of shift costs each note, against how well it sits on the grid (at most 1.75). */
const SMALLER = 0.5
/** Milliseconds a singer may hurry or drag on the take's lateness, and the steps each side
 * of a note whose starts tell how much. */
const DRIFT = 100
const DRIFT_AROUND = 12
/** A drum hit: the level jumps this many times over within a few frames, and is not quiet. */
const JUMP = 2.5
const HIT_LEVEL = 0.02
/** Frames between two hits, at least (70 ms). */
const HIT_GAP = 7
/** The level the loud part of a take is brought to (its 95th percentile of frames): the
 * recorded takes' level. At most MAX_GAIN louder, so a take of silence stays silence. */
const LOUD = 0.1
const MAX_GAIN = 20

export interface VoiceFrame {
  /** When it was heard, on the clock of the chunks given (an AudioContext's). */
  time: number
  /** MIDI number with a fraction, or null when there is no pitch (silence, a consonant). */
  pitch: number | null
  /** RMS level. */
  level: number
}

/** Measures the pitch of a sound given in chunks, frame after frame. */
export class PitchTracker {
  readonly rate: number
  private readonly factor: number
  private readonly win: number
  private readonly hop: number
  private readonly tauMin: number
  private readonly tauMax: number
  private buf: Float32Array
  private len = 0
  /** The time of buf[0]. */
  private head = 0
  private acc = 0
  private accN = 0

  constructor(inputRate: number) {
    this.factor = Math.max(1, Math.round(inputRate / TARGET_RATE))
    this.rate = inputRate / this.factor
    this.win = Math.round(WINDOW * this.rate)
    this.hop = HOP * this.rate
    this.tauMin = Math.floor(this.rate / HIGHEST_HZ)
    this.tauMax = Math.ceil(this.rate / LOWEST_HZ)
    this.buf = new Float32Array((this.win + this.tauMax) * 4)
  }

  /** Adds a chunk heard from `time` on; returns the frames it completes. */
  push(samples: Float32Array, time: number): VoiceFrame[] {
    if (this.len === 0 && this.accN === 0) this.head = time
    for (let i = 0; i < samples.length; i++) {
      this.acc += samples[i]
      if (++this.accN < this.factor) continue
      if (this.len === this.buf.length) {
        const bigger = new Float32Array(this.buf.length * 2)
        bigger.set(this.buf)
        this.buf = bigger
      }
      this.buf[this.len++] = this.acc / this.factor
      this.acc = 0
      this.accN = 0
    }
    const frames: VoiceFrame[] = []
    const need = this.win + this.tauMax
    let at = 0
    while (this.len - Math.round(at) >= need) {
      const off = Math.round(at)
      frames.push(this.measure(off, this.head + (off + this.win / 2) / this.rate))
      at += this.hop
    }
    const drop = Math.round(at)
    if (drop) {
      this.buf.copyWithin(0, drop, this.len)
      this.len -= drop
      this.head += drop / this.rate
    }
    return frames
  }

  private measure(off: number, time: number): VoiceFrame {
    const x = this.buf
    let sum = 0
    for (let j = 0; j < this.win; j++) sum += x[off + j] * x[off + j]
    const level = Math.sqrt(sum / this.win)
    if (level < QUIET) return { time, pitch: null, level }
    const hz = yin(x, off, this.win, this.tauMin, this.tauMax, this.rate)
    return { time, pitch: hz ? 69 + 12 * Math.log2(hz / 440) : null, level }
  }
}

/** YIN (de Cheveigné & Kawahara, 2002): the period the window repeats at, in Hz, or 0. */
export function yin(x: Float32Array, off: number, win: number, tauMin: number, tauMax: number, rate: number): number {
  const d = new Float64Array(tauMax + 2)
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0
    for (let j = 0; j < win; j++) {
      const v = x[off + j] - x[off + j + tau]
      s += v * v
    }
    d[tau] = s
  }
  // The difference, normalized by its mean so far: about 1 for noise, near 0 at the period.
  const n = new Float64Array(tauMax + 2)
  n[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    running += d[tau]
    n[tau] = running ? (d[tau] * tau) / running : 1
  }
  let tau = tauMin
  while (tau <= tauMax && n[tau] >= CLARITY) tau++
  if (tau > tauMax) return 0
  while (tau + 1 <= tauMax && n[tau + 1] < n[tau]) tau++
  const a = n[tau - 1]
  const b = n[tau]
  const c = n[tau + 1]
  const shift = a + c - 2 * b ? (a - c) / (2 * (a + c - 2 * b)) : 0
  return rate / (tau + Math.max(-1, Math.min(1, shift)))
}

/** A frame placed on the song: its step, with a fraction. */
export interface TakeFrame {
  step: number
  pitch: number | null
  level: number
}

/**
 * The frames of a whole recording, made as loud as the takes the thresholds were set on.
 * Their times are seconds from its start.
 */
export function listen(sound: Float32Array, rate: number): VoiceFrame[] {
  // The level of each frame, as the tracker measures it (before the gate), on the sound as is.
  const win = Math.round(WINDOW * rate)
  const hop = Math.round(HOP * rate)
  const levels: number[] = []
  for (let a = 0; a + win <= sound.length; a += hop) {
    let sum = 0
    for (let i = a; i < a + win; i++) sum += sound[i] * sound[i]
    levels.push(Math.sqrt(sum / win))
  }
  if (!levels.length) return []
  levels.sort((x, y) => x - y)
  const loud = levels[Math.floor(0.95 * (levels.length - 1))]
  const gain = loud > 0 ? Math.min(MAX_GAIN, LOUD / loud) : 1
  return new PitchTracker(rate).push(sound.map((v) => v * gain), 0)
}

/** The notes of a take, in the order of the grid. `hop` is a frame's length in steps. */
export function transcribe(frames: TakeFrame[], drum: boolean, hop: number): Note[] {
  return drum ? hits(frames, hop) : melody(frames, hop)
}

/** A note before it is put on the grid: its start and end in steps, with fractions. */
interface Heard {
  start: number
  end: number
  pitch: number | null
}

function melody(frames: TakeFrame[], hop: number): Note[] {
  const pitches = octaves(frames.map((f) => f.pitch))
  // Runs of voice: a short silence (a consonant, "fr") or a deep dip in level ends one.
  // A silence so short may also be YIN losing the voice for a moment: across it, a run too
  // short to be a note of its own is joined to the one it touches.
  type Frame = { pitch: number; step: number }
  const found: { frames: Frame[]; touches: boolean }[] = []
  let run: Frame[] = []
  let gap = 0
  let peak = 0
  let touches = false
  const close = (dip: boolean) => {
    if (run.length) found.push({ frames: run, touches })
    touches = !dip && gap < LOST
    run = []
    peak = 0
  }
  frames.forEach((f, i) => {
    const pitch = pitches[i]
    if (pitch === null) {
      if (++gap === GAP) close(false)
      if (gap >= LOST) touches = false
      return
    }
    if (run.length && f.level < DIP * peak) close(true)
    gap = 0
    run.push({ pitch, step: f.step })
    // The peak of the last frames only, so a note that slowly fades does not end itself.
    peak = Math.max(f.level, peak * 0.97)
  })
  close(false)
  const runs: Frame[][] = []
  for (const r of found) {
    const last = runs[runs.length - 1]
    if (last && r.touches && (last.length < PIECE || r.frames.length < PIECE)) last.push(...r.frames)
    else runs.push(r.frames)
  }
  for (let k = runs.length - 1; k >= 0; k--) if (runs[k].length < SETTLE) runs.splice(k, 1)
  if (!runs.length) return []

  // Each run cut where the pitch jumps: where the pitch of the frames just after differs
  // from the pitch of the frames just before. Each piece gets the median of its frames.
  const pieces = runs.map((r) => {
    const p = r.map((f) => f.pitch)
    const contrast = p.map((_, i) =>
      i < SETTLE || i > p.length - SETTLE ? 0 : Math.abs(median(p.slice(i, i + SETTLE)) - median(p.slice(i - SETTLE, i))),
    )
    const cuts = [0]
    for (let i = 0; i < p.length; i++) {
      if (contrast[i] < JUMP_PITCH) continue
      // The steepest frame of the jump.
      let best = i
      while (i + 1 < p.length && contrast[i + 1] >= JUMP_PITCH) if (contrast[++i] > contrast[best]) best = i
      if (best - cuts[cuts.length - 1] >= SETTLE && p.length - best >= SETTLE) cuts.push(best)
    }
    cuts.push(p.length)
    // A piece too short to be a note joins the one it leads to; the last one, the one before.
    for (let k = 1; k < cuts.length - 1; ) {
      if (cuts[k] - cuts[k - 1] < PIECE) cuts.splice(k, 1)
      else k++
    }
    if (cuts.length > 2 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < PIECE) cuts.splice(cuts.length - 2, 1)
    return cuts.slice(1).map((b, k) => ({ a: cuts[k], b: b - 1, pitch: median(p.slice(cuts[k], b)) }))
  })
  // How far off the semitones the whole take sits, each piece counted by its length.
  let cx = 0
  let cy = 0
  for (const piece of pieces.flat()) {
    const w = piece.b - piece.a + 1
    cx += w * Math.cos(2 * Math.PI * piece.pitch)
    cy += w * Math.sin(2 * Math.PI * piece.pitch)
  }
  const off = Math.atan2(cy, cx) / (2 * Math.PI)

  const heard: Heard[] = []
  runs.forEach((r, k) => {
    // Pieces that round to the same semitone are one note.
    for (const piece of pieces[k]) {
      const pitch = Math.max(LOWEST, Math.min(HIGHEST, Math.round(piece.pitch - off)))
      const last = heard[heard.length - 1]
      const start = r[piece.a].step
      const end = r[piece.b].step + hop
      if (last && piece.a > 0 && last.pitch === pitch) last.end = end
      else heard.push({ start, end, pitch })
    }
  })
  return onGrid(heard, hop)
}

/**
 * Pitches with the octave mistakes taken out: YIN sometimes hears a voice an octave off for
 * a few frames, and a frame an octave from the voice around it is brought back to it.
 */
function octaves(pitches: (number | null)[]): (number | null)[] {
  return pitches.map((p, i) => {
    if (p === null) return null
    const around = pitches.slice(Math.max(0, i - OCTAVE_AROUND), i + OCTAVE_AROUND + 1).filter((x): x is number => x !== null)
    const m = median(around)
    for (const o of [-12, 12]) if (Math.abs(p + o - m) < 1) return p + o
    return p
  })
}

/**
 * Notes heard, put on the grid. Before rounding, the take is moved by how late (or early) it
 * is as a whole: the microphone's delay the browser does not tell (Safari's is about a tenth
 * of a second, with echo cancellation) and a singer behind the click make a step or more;
 * then by how much the singer hurries or drags around each note. Then a melody is legato: a
 * note lasts up to the next one when what lies between is too short to be a rest meant (the
 * singer breathes or says a consonant). One voice: a note ends where the next starts; two
 * starting together, the later wins.
 */
function onGrid(heard: Heard[], hop: number): Note[] {
  const stepSeconds = HOP / hop
  const starts = heard.map((h) => h.start)
  const late = lateness(starts, stepSeconds, EARLIEST, LATEST, 0)
  const notes: Note[] = []
  for (const h of heard) {
    // The singer hurries and drags a little: the notes around move this one, a little.
    const around = starts.filter((t) => Math.abs(t - h.start) <= DRIFT_AROUND)
    const here = lateness(around, stepSeconds, late - DRIFT, late + DRIFT, late) / 1000 / stepSeconds
    const start = h.start - here
    const end = h.end - here
    const s = Math.round(start) + 0 // never -0
    let e = Math.round(end)
    if (h.pitch === null) e = s + 1
    else if (e <= s) {
      if (end - start < 0.5) continue
      e = s + 1
    }
    notes.push({ step: s, pitch: h.pitch, length: e - s })
  }
  notes.sort((a, b) => a.step - b.step)
  const kept: Note[] = []
  for (const n of notes) {
    const prev = kept[kept.length - 1]
    if (prev && prev.pitch === null && prev.step === n.step) continue
    if (prev && prev.pitch !== null) {
      const rest = n.step - prev.step - prev.length
      if (rest < 0 || rest <= LEGATO) prev.length = n.step - prev.step
      if (prev.length <= 0) kept.pop()
    }
    kept.push(n)
  }
  // A single step glued to a note a semitone or less from it is a piece of that note: the
  // voice sliding in, or caught for a moment. Repeated sixteenths are not what a voice sings.
  const melody: Note[] = []
  for (let k = 0; k < kept.length; k++) {
    const n = kept[k]
    const prev = melody[melody.length - 1]
    const next = kept[k + 1]
    const glued = (a: Note | undefined, b: Note | undefined) =>
      a && b && a.pitch !== null && b.pitch !== null && a.step + a.length === b.step && Math.abs(a.pitch - b.pitch) <= 1
    if (n.length === 1 && glued(prev, n) && prev.pitch === n.pitch) prev.length++
    else if (n.length === 1 && glued(n, next) && next.length > 1) {
      next.length += next.step - n.step
      next.step = n.step
    } else melody.push(n)
  }
  return melody
}

/**
 * How late notes starting at `starts` (steps) are, in milliseconds from `from` to `to`: the
 * shift that puts them best on the grid, a beat counting more than an eighth, an eighth than
 * a step. Of two shifts as good, the one nearer `near`.
 */
function lateness(starts: number[], stepSeconds: number, from: number, to: number, near: number): number {
  let best = near
  let bestScore = -Infinity
  for (let ms = from; ms <= to; ms += 5) {
    const shift = ms / 1000 / stepSeconds
    // A rhythm all in eighths fits every eighth: the nearer shift wins.
    let score = -SMALLER * (Math.abs(ms - near) / 1000) * starts.length
    for (const t of starts) {
      const x = t - shift
      for (const [every, weight] of GRID) {
        const d = (x / every - Math.round(x / every)) * every
        score += weight * Math.exp(-(d * d) / (2 * ON_GRID * ON_GRID))
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = ms
    }
  }
  return best
}

function hits(frames: TakeFrame[], hop: number): Note[] {
  const heard: Heard[] = []
  let last = -Infinity
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f.level < HIT_LEVEL || i - last < HIT_GAP) continue
    let before = Infinity
    for (let j = Math.max(0, i - 3); j < i; j++) before = Math.min(before, frames[j].level)
    if (i > 0 && f.level < JUMP * Math.max(before, QUIET / 2)) continue
    last = i
    heard.push({ start: f.step, end: f.step + 1, pitch: null })
  }
  return onGrid(heard, hop)
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

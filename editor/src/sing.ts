// Singing a melody into a track, without the DOM: a take's pitch, frame by frame, then
// notes on the grid.
//
// The voice is heard in frames, every hundredth of a second: its pitch (YIN, on the sound
// brought down to about 16 kHz, enough for a voice) and its level. Notes are found first,
// then each is given one pitch. A note starts when the voice starts, after a deep dip in
// level (the "d" of "doo doo" on one pitch), or where the pitch jumps; a slow drift is not a
// jump, so a note sung across the line between two semitones stays one note, and a piece
// too short to be a note (a slide into one) belongs to the note it leads to. A note's pitch
// is the median of its frames, rounded to the nearest semitone after taking out how sharp
// or flat the singer is on the whole take (a voice a quarter tone low throughout is still
// singing in tune with itself). Time is rounded to the sixteenth grid.
//
// The thresholds were set on recorded takes (tests/sing-takes), two voices singing over the
// click. Recording with echo cancellation, the voice's level drops after each click and
// overshoots: that is why a dip must be deep, and a silence a few frames long, to end a note.
//
// A drum track takes the starts of sounds instead (claps, "ts", "k"), each one a hit.
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
/** Frames without pitch that end a note (40 ms): fewer is a voice YIN lost for a moment. */
const GAP = 4
/** Frames a note needs to count, and the frames each side of a jump compared (50 ms). */
const SETTLE = 5
/** A jump in pitch, in semitones, that starts a new note: more than a voice wobbles, less
 * than a semitone sung a little narrow. */
const JUMP_PITCH = 0.7
/** Frames a piece of a note needs to be a note of its own (120 ms); shorter, it is a slide. */
const PIECE = 12
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
  return drum ? hits(frames) : melody(frames, hop)
}

function melody(frames: TakeFrame[], hop: number): Note[] {
  // Runs of voice: a few frames without pitch are bridged, a deep dip in level breaks.
  const runs: TakeFrame[][] = []
  let run: TakeFrame[] = []
  let gap = 0
  let peak = 0
  const close = () => {
    if (run.length >= SETTLE) runs.push(run)
    run = []
    peak = 0
  }
  for (const f of frames) {
    if (f.pitch === null) {
      if (++gap >= GAP) close()
      continue
    }
    if (run.length && f.level < DIP * peak) close()
    gap = 0
    run.push(f)
    // The peak of the last frames only, so a note that slowly fades does not end itself.
    peak = Math.max(f.level, peak * 0.97)
  }
  close()
  if (!runs.length) return []

  // Each run cut where the pitch jumps: where the pitch of the frames just after differs
  // from the pitch of the frames just before. Each piece gets the median of its frames.
  const pieces = runs.map((r) => {
    const p = r.map((f) => f.pitch as number)
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

  const notes: Note[] = []
  runs.forEach((r, k) => {
    // Pieces that round to the same semitone are one note.
    const merged: { pitch: number; a: number; b: number }[] = []
    for (const piece of pieces[k]) {
      const pitch = Math.round(piece.pitch - off)
      const last = merged[merged.length - 1]
      if (last && last.pitch === pitch) last.b = piece.b
      else merged.push({ pitch, a: piece.a, b: piece.b })
    }
    for (const p of merged) {
      const start = r[p.a].step
      const end = r[p.b].step + hop
      let s = Math.round(start)
      let e = Math.round(end)
      if (e <= s) {
        if (end - start < 0.5) continue
        e = s + 1
      }
      notes.push({ step: s, pitch: Math.max(LOWEST, Math.min(HIGHEST, p.pitch)), length: e - s })
    }
  })
  // One voice: a note ends where the next starts; two starting together, the later wins.
  notes.sort((a, b) => a.step - b.step)
  const kept: Note[] = []
  for (const n of notes) {
    const prev = kept[kept.length - 1]
    if (prev && prev.step + prev.length > n.step) {
      prev.length = n.step - prev.step
      if (prev.length <= 0) kept.pop()
    }
    kept.push(n)
  }
  return kept
}

function hits(frames: TakeFrame[]): Note[] {
  const notes: Note[] = []
  let last = -Infinity
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f.level < HIT_LEVEL || i - last < HIT_GAP) continue
    let before = Infinity
    for (let j = Math.max(0, i - 3); j < i; j++) before = Math.min(before, frames[j].level)
    if (i > 0 && f.level < JUMP * Math.max(before, QUIET / 2)) continue
    last = i
    const step = Math.round(f.step)
    if (notes[notes.length - 1]?.step !== step) notes.push({ step, pitch: null, length: 1 })
  }
  return notes
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

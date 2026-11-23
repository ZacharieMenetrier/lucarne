// Lucarne's sound: songs are notes, played with recorded instruments.
//
// An instrument is the recording of one note (instruments/<name>.wav), stored as it plays:
// mono, 16 kHz, 8-bit. Its .json holds the note it was recorded at; an instrument without
// one has no pitch (a drum): it always plays as recorded. The engine does three things, and
// nothing else (no vibrato, no effects, no settings):
//
//   1. A note plays the recording from its start, faster or slower for its pitch.
//   2. When the note ends, it fades out in a tenth of a second.
//   3. If the note lasts longer than the recording, its last 5 waves repeat.
//
// Every instrument also sounds as loud as the others: measured when it is loaded (LOUDNESS),
// then turned up or down by its volume, set by ear in the editor.
//
// Repeating 5 waves rather than a longer stretch: a held note becomes a steady tone, where a
// second of the recording repeated would come back like a rhythm (chosen by ear).
//
// A song (songs/<name>.json) is a tempo, a time signature and its instruments, each one once
// with its notes, on a fixed grid of sixteenth notes, never two of the same pitch at once. It
// ends with the bar of its last note, and loops.
//
// This file has no imports: the script that prepares the built-in instruments runs it with
// plain Node.

/** Every instrument plays at 16 kHz, 8-bit: what the import stores, and what is heard. */
export const RATE = 16000
/** The grid: a note starts and lasts a whole number of sixteenth notes, four to a quarter. */
export const STEPS_PER_QUARTER = 4
/**
 * The time signatures a song can have: how many steps make a bar, and a beat. Only these
 * three, the ones songs are written in; 2/4 reads well enough as 4/4, and 12/8 as 6/8. The
 * tempo always counts quarter notes, whatever the time, so changing it never changes speed.
 */
export const TIMES = {
  '4/4': { bar: 16, beat: 4 },
  '3/4': { bar: 12, beat: 4 },
  '6/8': { bar: 12, beat: 6 },
} as const
export type Time = keyof typeof TIMES
/** A song's time when its file sets none. */
export const DEFAULT_TIME: Time = '4/4'
/** A song's tempo, in quarter notes per minute, when its file sets none. */
export const DEFAULT_TEMPO = 120
export const MIN_TEMPO = 40
export const MAX_TEMPO = 300
/** The lowest and highest notes a song can hold (MIDI numbers: C1 and C8). */
export const LOWEST = 24
export const HIGHEST = 108
/** Seconds: the fade at the end of every note. */
const FADE = 0.1
/** The end of a recording that repeats while a note is held, in waves. */
const WAVES = 5

// ---------------------------------------------------------------------------
// Notes

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "C5" → 72 (MIDI: A4 is 69). Sharps only, written "#". Null if it is not a note. */
export function noteNumber(name: string): number | null {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name.trim().toUpperCase())
  if (!m) return null
  const n = NAMES.indexOf(m[1] + m[2])
  return n < 0 ? null : (Number(m[3]) + 1) * 12 + n
}

/** 72 → "C5". */
export function noteName(n: number): string {
  return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1)
}

export const frequency = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// ---------------------------------------------------------------------------
// Songs

export interface Note {
  /** Where it starts, in sixteenths from the start of the song. */
  step: number
  /** Its MIDI number; null on a drum (an instrument without a note). */
  pitch: number | null
  /** How long it lasts, in sixteenths. */
  length: number
}

/**
 * An instrument of a song and what it plays. A song has each instrument once: two flutes
 * would be one flute louder, and two lists of notes to look for the one to change. A chord
 * is several notes of one instrument.
 */
export interface Part {
  instrument: string
  notes: Note[]
}

export interface Song {
  tempo: number
  time: Time
  /** In the order they are listed (and colored) in the editor. */
  instruments: Part[]
}

export function emptySong(): Song {
  return { tempo: DEFAULT_TEMPO, time: DEFAULT_TIME, instruments: [] }
}

/** Steps in one bar, and in one beat, of the song. */
export const barSteps = (song: Song) => TIMES[song.time].bar
export const beatSteps = (song: Song) => TIMES[song.time].beat

/**
 * Reads a song file: `"instruments": { "flute": [notes], … }`, each instrument a key, so a
 * song cannot have one twice. A note is [step, "C5", length], or [step] on a drum.
 */
export function parseSong(text: string): Song {
  const raw = JSON.parse(text) as { tempo?: unknown; time?: unknown; instruments?: unknown }
  if (!raw || typeof raw !== 'object') throw new Error('a song is an object')
  const tempo = raw.tempo === undefined ? DEFAULT_TEMPO : Number(raw.tempo)
  if (!Number.isFinite(tempo) || tempo < MIN_TEMPO || tempo > MAX_TEMPO) throw new Error(`tempo must be between ${MIN_TEMPO} and ${MAX_TEMPO}`)
  const time = raw.time === undefined ? DEFAULT_TIME : raw.time
  if (typeof time !== 'string' || !(time in TIMES)) throw new Error(`time must be one of ${Object.keys(TIMES).join(', ')}`)
  const given = raw.instruments ?? {}
  if (typeof given !== 'object' || Array.isArray(given)) throw new Error('instruments is an object: { "flute": [notes] }')
  const instruments: Part[] = []
  for (const [instrument, list] of Object.entries(given)) {
    if (!instrument) throw new Error('an instrument has no name')
    if (!Array.isArray(list)) throw new Error(`the notes of "${instrument}" are not a list`)
    const notes: Note[] = []
    for (const n of list) {
      if (!Array.isArray(n)) throw new Error(`a note of "${instrument}" is not a list`)
      const step = Number(n[0])
      if (!Number.isInteger(step) || step < 0) throw new Error(`a note of "${instrument}" has a bad step: ${JSON.stringify(n)}`)
      if (n.length === 1) {
        notes.push({ step, pitch: null, length: 1 })
        continue
      }
      const pitch = typeof n[1] === 'string' ? noteNumber(n[1]) : null
      const length = Number(n[2] ?? 1)
      if (pitch === null) throw new Error(`a note of "${instrument}" has a bad pitch: ${JSON.stringify(n)}`)
      if (!Number.isInteger(length) || length < 1) throw new Error(`a note of "${instrument}" has a bad length: ${JSON.stringify(n)}`)
      notes.push({ step, pitch, length })
    }
    instruments.push({ instrument, notes: untangle(notes) })
  }
  return { tempo, time: time as Time, instruments }
}

export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.step - b.step || (a.pitch ?? 0) - (b.pitch ?? 0))
}

/**
 * An instrument never covers itself: two of its notes of the same pitch never overlap. When one
 * starts while the same pitch still sounds, the earlier one stops there, as a string struck
 * again starts over; two at the same step are one (the last). Drum hits: one per step.
 * Changes `notes` in place, sorted, and returns it.
 */
export function untangle(notes: Note[]): Note[] {
  sortNotes(notes)
  const last = new Map<number | null, Note>()
  const kept: Note[] = []
  for (const n of notes) {
    const before = last.get(n.pitch)
    if (before && before.step === n.step) kept.splice(kept.indexOf(before), 1)
    else if (before && noteEnd(before) > n.step) before.length = n.step - before.step
    last.set(n.pitch, n)
    kept.push(n)
  }
  notes.length = 0
  notes.push(...kept)
  return notes
}

/**
 * The song file: one instrument per line, the tempo and time only when not the default. Two
 * parts of one instrument (only a song built in code can have them) are written as one.
 */
export function serializeSong(song: Song): string {
  const note = (n: Note) => (n.pitch === null ? `[${n.step}]` : `[${n.step}, "${noteName(n.pitch)}", ${n.length}]`)
  const merged = new Map<string, Note[]>()
  for (const p of song.instruments) merged.set(p.instrument, [...(merged.get(p.instrument) ?? []), ...p.notes])
  const parts = [...merged].map(([name, notes]) => `    ${JSON.stringify(name)}: [${untangle(notes.map((n) => ({ ...n }))).map(note).join(', ')}]`)
  const lines = ['{']
  if (song.tempo !== DEFAULT_TEMPO) lines.push(`  "tempo": ${song.tempo},`)
  if (song.time !== DEFAULT_TIME) lines.push(`  "time": "${song.time}",`)
  lines.push(parts.length ? `  "instruments": {\n${parts.join(',\n')}\n  }` : '  "instruments": {}', '}')
  return lines.join('\n') + '\n'
}

/** Where a note ends, in steps (a drum hit takes one). */
export const noteEnd = (n: Note) => n.step + (n.pitch === null ? 1 : n.length)

/** The song's length in steps: up to the end of the bar of its last note, at least one bar. */
export function songSteps(song: Song): number {
  let end = 0
  for (const p of song.instruments) for (const n of p.notes) end = Math.max(end, noteEnd(n))
  const bar = barSteps(song)
  return Math.max(1, Math.ceil(end / bar)) * bar
}

/** Seconds per sixteenth. */
export const stepSeconds = (tempo: number) => 60 / tempo / STEPS_PER_QUARTER

// ---------------------------------------------------------------------------
// Instruments

export interface Instrument {
  /** The recording at RATE, its values between -1 and 1 (8-bit steps). */
  data: Float32Array
  /** The note it was recorded at (MIDI); null for a drum. */
  note: number | null
  /** The part that repeats while a note is held (samples); empty on a drum. */
  loopStart: number
  loopEnd: number
  /** What its notes are multiplied by: as loud as every other one, then its volume. */
  gain: number
}

/**
 * An instrument's volume, in dB, set by ear: what the measure of its loudness misses (a
 * drum's hit is covered by held notes; a low sound is heard less). Whole dB, from MIN_VOLUME
 * to MAX_VOLUME; 0 when its file sets none.
 */
export const MIN_VOLUME = -12
export const MAX_VOLUME = 12

/**
 * An instrument's .json: `{ "note": "C5", "volume": 4 }`, each left out when it has none. A
 * game's .json without a recording sets the volume of the engine's instrument of that name.
 */
export interface InstrumentFile {
  /** The note it was recorded at; null for a drum. */
  note: number | null
  /** Unset: the engine's volume for a built-in instrument, 0 for any other. */
  volume?: number
}

export function parseInstrumentFile(text: string): InstrumentFile {
  const raw = JSON.parse(text) as { note?: unknown; volume?: unknown }
  const note = typeof raw?.note === 'string' ? noteNumber(raw.note) : null
  const v = Number(raw?.volume)
  if (raw?.volume === undefined || !Number.isFinite(v)) return { note }
  return { note, volume: Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, Math.round(v))) }
}

/** The .json of an instrument; null when there is nothing to write. */
export function serializeInstrumentFile({ note, volume }: InstrumentFile): string | null {
  const parts = []
  if (note !== null) parts.push(`"note": "${noteName(note)}"`)
  if (volume !== undefined) parts.push(`"volume": ${volume}`)
  return parts.length ? `{ ${parts.join(', ')} }\n` : null
}

/**
 * How loud every instrument sounds: the level of its first quarter of a second. Recordings
 * are stored as loud as they can be, peak at the top, but the ear hears how much sound there
 * is, not the peak: a drum, one sharp hit, sounded far softer than a bassoon held at its
 * peak (up to 16 dB). So the engine measures each one where it plays and evens them out,
 * when it is loaded rather than in its file, where turning a sound down would cost it 8-bit
 * steps. The quarter second is how long the ear takes to judge a sound, for a short hit and
 * the start of a held note alike. The level is the middle of the built-in instruments'.
 */
const LOUDNESS = 0.25
const LOUDNESS_SECONDS = 0.25

/** The gain that brings a recording to LOUDNESS (1 if it is silent). */
export function loudnessGain(data: Float32Array): number {
  const n = Math.round(LOUDNESS_SECONDS * RATE)
  let e = 0
  for (let i = 0; i < Math.min(n, data.length); i++) e += data[i] * data[i]
  // Over the whole quarter second, even past a shorter sound's end: a short sound is soft.
  const level = Math.sqrt(e / n)
  return level ? LOUDNESS / level : 1
}

/** Readies a recording to be played at its volume (dB): finds its last 5 waves and blends
 *  them so they loop without a seam. `data` is not changed. */
export function instrument(data: Float32Array, note: number | null, volume = 0): Instrument {
  const d = Float32Array.from(data)
  const gain = loudnessGain(d) * Math.pow(10, volume / 20)
  if (note === null || d.length < 8) return { data: d, note, loopStart: d.length, loopEnd: d.length, gain }
  // The loop is sized on the recording's real pitch (a player is rarely exactly on the
  // note), so its 5 waves are 5 whole waves and a held note stays in tune.
  const f0 = detectPitch(d, RATE, frequency(note)) || frequency(note)
  const end = d.length
  const L = Math.max(2, Math.min(Math.round((WAVES * RATE) / f0), end >> 1))
  // The blend covers half the loop, and the two parts it blends must stay in step over all
  // of it, or they cancel and the level dips: its start moves a sample or two to match best.
  const X = L >> 1
  let start = end - L
  let best = Infinity
  for (let s = end - L - 2; s <= end - L + 2; s++) {
    if (s - X < 0) continue
    let e = 0
    for (let i = 1; i <= X; i++) {
      const x = d[s - i] - d[end - i]
      e += x * x
    }
    if (e < best) {
      best = e
      start = s
    }
  }
  const fade = Math.min(X, start)
  for (let i = 0; i < fade; i++) {
    const w = i / fade
    d[end - fade + i] = d[end - fade + i] * (1 - w) + d[start - fade + i] * w
  }
  return { data: d, note, loopStart: start, loopEnd: end, gain }
}

// 4-point Gaussian interpolation, in a table of 256 positions between two samples: smooth,
// a little soft, like the sample chips of old consoles.
const GAUSS = (() => {
  const t = new Float32Array(256 * 4)
  const G = 2 * 0.55 * 0.55
  for (let p = 0; p < 256; p++) {
    const f = p / 256
    let sum = 0
    for (let k = 0; k < 4; k++) {
      const x = k - 1 - f
      t[p * 4 + k] = Math.exp((-x * x) / G)
      sum += t[p * 4 + k]
    }
    for (let k = 0; k < 4; k++) t[p * 4 + k] /= sum
  }
  return t
})()

/**
 * Plays one note of an instrument into `out` (added to what is there), from `at`, wrapping
 * around past the end of `out` when `wrap` (a song that loops). `seconds` is how long the note
 * is held; a drum ignores the pitch and the length, and plays its whole recording.
 */
export function addNote(out: Float32Array, at: number, outRate: number, inst: Instrument, pitch: number | null, seconds: number, gain = 1, wrap = false) {
  const { data, loopStart, loopEnd } = inst
  gain *= inst.gain
  const drum = inst.note === null
  const ratio = ((drum || pitch === null ? 1 : frequency(pitch) / frequency(inst.note!)) * RATE) / outRate
  const hold = Math.round(seconds * outRate)
  const fade = Math.round(FADE * outRate)
  const len = loopEnd - loopStart
  const n = drum ? Math.ceil(data.length / ratio) : hold + fade
  const attack = Math.max(1, Math.round(0.003 * outRate))
  let pos = 0
  for (let i = 0; i < n; i++, pos += ratio) {
    if (pos >= loopEnd) {
      if (len <= 0) break
      pos -= len * Math.ceil((pos - loopEnd + 1e-9) / len)
    }
    const j = Math.floor(pos)
    const g = ((pos - j) * 256) | 0
    let v = 0
    for (let k = 0; k < 4; k++) {
      let idx = j + k - 1
      if (idx >= loopEnd && len > 0) idx -= len
      if (idx >= 0 && idx < data.length) v += data[idx] * GAUSS[g * 4 + k]
    }
    let env = i < attack ? i / attack : 1
    if (!drum && i >= hold) env *= 1 - (i - hold) / fade
    let o = at + i
    if (o >= out.length) {
      if (!wrap) break
      o %= out.length
    }
    out[o] += v * env * gain
  }
}

/** How loud each note is in a song: room for a few at once before it has to be turned down. */
const VOICE = 0.4

/**
 * Turns the whole sound down, all of it by the same amount, if it would go past 1 anywhere.
 * Not a limiter on each sample (it flattened the drums' hits, and pushed the held notes
 * under them): every instrument keeps its level next to the others. The whole song is there
 * before it plays, so its loudest point is known.
 */
function fit(out: Float32Array): Float32Array {
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i] /= peak
  return out
}

/**
 * The whole song, once, at `outRate`: what plays in a loop. A note still sounding at the end
 * (a held note's fade, a drum's tail) continues at the start, as it does when the song loops.
 * An instrument that is missing is silent.
 */
export function renderSong(song: Song, instruments: (name: string) => Instrument | undefined, outRate: number): Float32Array {
  const step = stepSeconds(song.tempo)
  const out = new Float32Array(Math.round(songSteps(song) * step * outRate))
  for (const p of song.instruments) {
    const inst = instruments(p.instrument)
    if (!inst) continue
    for (const n of p.notes) addNote(out, Math.round(n.step * step * outRate), outRate, inst, n.pitch, n.length * step, VOICE, true)
  }
  return fit(out)
}

/** One note alone, as heard when it is placed in the editor. */
export function renderNote(inst: Instrument, pitch: number | null, seconds: number, outRate: number): Float32Array {
  const len = inst.note === null ? Math.ceil((inst.data.length * outRate) / RATE) : Math.round((seconds + FADE) * outRate)
  const out = new Float32Array(len)
  addNote(out, 0, outRate, inst, pitch, seconds, VOICE)
  return fit(out)
}

// ---------------------------------------------------------------------------
// Importing a recording: what the editor does to a sound file, and the script that
// prepares the built-in instruments.

/**
 * Makes an instrument of a recording: from the start of its note, cut where it should end,
 * at 16 kHz, 8-bit, as loud as it can be. A sustained sound (a flute, a bow) is cut before the
 * player stops, so its end still sounds and can repeat; a sound that fades (a strike, a
 * pluck) is kept until it has died out.
 */
export function prepareRecording(src: Float32Array, rate: number): Float32Array {
  const d = resample(src, rate, RATE)
  let peak = 0
  for (const v of d) peak = Math.max(peak, Math.abs(v))
  if (!peak) return new Float32Array(0)
  let start = 0
  while (start < d.length && Math.abs(d[start]) < peak * 0.05) start++
  // A few milliseconds before the note starts, so its attack is whole.
  start = Math.max(0, start - Math.round(0.003 * RATE))
  const win = RATE / 20
  const level: number[] = []
  for (let s = start; s + win <= d.length; s += win) {
    let e = 0
    for (let i = s; i < s + win; i++) e += d[i] * d[i]
    level.push(Math.sqrt(e / win))
  }
  const top = Math.max(...level, 0)
  // Where the sound has died out.
  let silent = level.findIndex((l, i) => i > 2 && l < top * 0.001)
  if (silent < 0) silent = level.length
  // Still strong two fifths of the way: a sustained sound.
  const sustained = level[Math.floor(silent * 0.4)] >= top * 0.4
  let end = start + silent * win
  if (sustained) {
    const mid = level.slice(Math.floor(silent * 0.2), Math.max(Math.floor(silent * 0.2) + 1, Math.floor(silent * 0.7))).sort((a, b) => a - b)
    const usual = mid[mid.length >> 1]
    let stops = level.findIndex((l, i) => i > silent * 0.3 && l < usual * 0.6)
    if (stops < 0) stops = silent
    // Well before the player stops: the end repeats while a note is held.
    end = Math.max(start + win * 4, start + stops * win - Math.round(0.15 * RATE))
  }
  const out = d.slice(start, Math.min(d.length, end))
  let p = 0
  for (const v of out) p = Math.max(p, Math.abs(v))
  for (let i = 0; i < out.length; i++) out[i] = Math.round((out[i] / p) * 0.95 * 127) / 127
  return out
}

/**
 * Finds the note of a prepared recording and tunes it exactly to that note (a player, or a
 * string, is often a little off), so that instruments are in tune with each other. No pitch
 * found: a drum, returned as it is, with no note.
 */
export function tuneRecording(d: Float32Array, near?: number): { data: Float32Array; note: number | null } {
  const f = detectPitch(d, RATE, near)
  if (!f) return { data: d, note: null }
  const note = Math.round(69 + 12 * Math.log2(f / 440))
  // Read a little slower to go down, faster to go up: the same sound, on its note.
  const step = frequency(note) / f
  const tuned = new Float32Array(Math.floor(d.length / step))
  for (let j = 0; j < tuned.length; j++) {
    const x = j * step
    const i = Math.floor(x)
    const v = d[i] * (1 - (x - i)) + (d[i + 1] ?? d[i]) * (x - i)
    tuned[j] = Math.max(-1, Math.min(1, Math.round(v * 127) / 127))
  }
  return { data: tuned, note }
}

/** Averages down (or reads across, going up) to another rate. */
export function resample(src: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(src)
  const n = Math.floor((src.length * to) / from)
  const d = new Float32Array(n)
  const step = from / to
  for (let j = 0; j < n; j++) {
    if (step <= 1) {
      const x = j * step
      const i = Math.floor(x)
      const f = x - i
      d[j] = (src[i] ?? 0) * (1 - f) + (src[i + 1] ?? src[i] ?? 0) * f
      continue
    }
    const a = Math.floor(j * step)
    const b = Math.max(a + 1, Math.floor((j + 1) * step))
    let s = 0
    for (let i = a; i < b && i < src.length; i++) s += src[i]
    d[j] = s / (b - a)
  }
  return d
}

/**
 * The pitch of a recording, in Hz (0: none found), by autocorrelation on a stretch of its
 * steady part. `near`, when given, picks among octaves the one closest to it.
 */
export function detectPitch(d: Float32Array, rate: number, near?: number): number {
  const W = Math.round(rate / 16)
  const start = Math.min(d.length - W - Math.ceil(rate / 50) - 2, Math.floor(d.length * 0.3))
  if (start < 0) return 0
  const minLag = Math.max(2, Math.floor(rate / 2000))
  const maxLag = Math.ceil(rate / 50)
  const rs = new Float64Array(maxLag + 2)
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = 0; i < W; i++) s += d[start + i] * (d[start + i + lag] ?? 0)
    rs[lag] = s
  }
  if (!(rs[0] > 0)) return 0
  let lag = minLag
  while (lag < maxLag && rs[lag] > 0) lag++ // past the first dip
  let top = lag
  for (let l = lag; l <= maxLag; l++) if (rs[l] > rs[top]) top = l
  if (rs[top] < rs[0] * 0.3) return 0
  // The first peak close to the highest one, so an octave below does not win.
  let best = lag
  while (best < top && !(rs[best] >= 0.9 * rs[top] && rs[best] >= rs[best + 1] && rs[best] >= rs[best - 1])) best++
  const a = rs[best - 1], b = rs[best], c = rs[best + 1]
  const curve = a - 2 * b + c
  let f = rate / (best + (curve ? (a - c) / (2 * curve) : 0))
  if (near) while (f < near / Math.SQRT2) f *= 2
  if (near) while (f > near * Math.SQRT2) f /= 2
  return f
}

// ---------------------------------------------------------------------------
// WAV files

/** An 8-bit mono WAV at `rate` (values between -1 and 1). */
export function encodeWav(data: Float32Array, rate = RATE): Uint8Array {
  const out = new Uint8Array(44 + data.length)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + data.length, true)
  ascii(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  ascii(36, 'data')
  v.setUint32(40, data.length, true)
  for (let i = 0; i < data.length; i++) out[44 + i] = Math.max(0, Math.min(255, Math.round(data[i] * 127) + 128))
  return out
}

/** Reads a PCM WAV (8, 16, 24 or 32-bit, any channels: mixed to one). */
export function decodeWav(bytes: Uint8Array): { data: Float32Array; rate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let at = 12
  let fmt: { channels: number; rate: number; bits: number; float: boolean } | null = null
  while (at + 8 <= bytes.length) {
    const id = tag(at)
    const size = v.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      const format = v.getUint16(body, true)
      fmt = { channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true), float: format === 3 }
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV file without a format')
      const { channels, bits, float } = fmt
      const width = bits / 8
      const frames = Math.floor(Math.min(size, bytes.length - body) / (width * channels))
      const data = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let s = 0
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width
          if (bits === 8) s += (bytes[p] - 128) / 128
          else if (bits === 16) s += v.getInt16(p, true) / 32768
          else if (bits === 24) s += ((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8 >> 8) / 8388608
          else if (float) s += v.getFloat32(p, true)
          else s += v.getInt32(p, true) / 2147483648
        }
        data[i] = s / channels
      }
      return { data, rate: fmt.rate }
    }
    at = body + size + (size & 1)
  }
  throw new Error('WAV file without sound')
}

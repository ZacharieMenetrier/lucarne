import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEMPO,
  RATE,
  decodeWav,
  detectPitch,
  encodeWav,
  frequency,
  instrument,
  noteName,
  noteNumber,
  parseSong,
  prepareRecording,
  renderNote,
  renderSong,
  resample,
  serializeSong,
  tuneRecording,
  songSteps,
  stepSeconds,
  type Song,
} from '../runtime/sound'

const OUT = 48000

/** A tone at `f` Hz for `seconds`, with a few harmonics, at `rate`. */
function tone(f: number, seconds: number, rate = RATE, level = (_t: number) => 0.8) {
  const d = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < d.length; i++) {
    const t = i / rate
    d[i] = level(t) * (Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(4 * Math.PI * f * t) * 0.2 + Math.sin(6 * Math.PI * f * t) * 0.1)
  }
  return d
}

const rms = (a: Float32Array, s: number, e: number) => {
  let x = 0
  for (let i = s; i < e; i++) x += a[i] * a[i]
  return Math.sqrt(x / (e - s))
}
const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

describe('notes', () => {
  it('names notes and reads them back', () => {
    expect(noteNumber('C5')).toBe(72)
    expect(noteNumber('A4')).toBe(69)
    expect(noteNumber('c#4')).toBe(61)
    expect(noteNumber('H2')).toBeNull()
    expect(noteNumber('Db4')).toBeNull()
    for (let n = 24; n <= 108; n++) expect(noteNumber(noteName(n))).toBe(n)
    expect(frequency(69)).toBe(440)
  })
})

describe('songs', () => {
  const song: Song = {
    tempo: 90,
    tracks: [
      { instrument: 'flute', notes: [{ step: 4, pitch: 74, length: 2 }, { step: 0, pitch: 72, length: 4 }] },
      { instrument: 'drum', notes: [{ step: 0, pitch: null, length: 1 }, { step: 8, pitch: null, length: 1 }] },
    ],
  }

  it('writes a song and reads it back, notes in order', () => {
    const text = serializeSong(song)
    expect(text).toContain('[0, "C5", 4], [4, "D5", 2]')
    expect(text).toContain('[[0], [8]]')
    expect(parseSong(text)).toEqual(parseSong(serializeSong(parseSong(text))))
    expect(parseSong(text).tracks[0].notes.map((n) => n.step)).toEqual([0, 4])
  })

  it('leaves the default tempo out of the file', () => {
    expect(serializeSong({ tempo: DEFAULT_TEMPO, tracks: [] })).not.toContain('tempo')
    expect(parseSong('{"tracks": []}').tempo).toBe(DEFAULT_TEMPO)
  })

  it('rejects broken files with the reason', () => {
    expect(() => parseSong('{"tracks": [{"notes": []}]}')).toThrow(/instrument/)
    expect(() => parseSong('{"tracks": [{"instrument": "a", "notes": [[0, "X9", 1]]}]}')).toThrow(/pitch/)
    expect(() => parseSong('{"tempo": 5}')).toThrow(/tempo/)
  })

  it('ends with the bar of its last note', () => {
    expect(songSteps({ tempo: 120, tracks: [] })).toBe(16)
    expect(songSteps(song)).toBe(16)
    expect(songSteps({ tempo: 120, tracks: [{ instrument: 'a', notes: [{ step: 15, pitch: 60, length: 2 }] }] })).toBe(32)
  })
})

describe('wav files', () => {
  it('stores 8-bit mono and reads it back', () => {
    const d = Float32Array.from([0, 0.5, -0.5, 1, -1].map((v) => Math.round(v * 127) / 127))
    const { data, rate } = decodeWav(encodeWav(d))
    expect(rate).toBe(RATE)
    data.forEach((v, i) => expect(v).toBeCloseTo(d[i], 1))
  })
})

describe('instruments', () => {
  const C5 = 72
  // A real player is rarely exactly on the note: 8 cents sharp.
  const f = frequency(C5) * Math.pow(2, 8 / 1200)
  const flute = instrument(tone(f, 1.5), C5)

  it('repeats the last 5 waves of the recording', () => {
    const waves = ((flute.loopEnd - flute.loopStart) * f) / RATE
    expect(flute.loopEnd).toBe(flute.data.length)
    expect(waves).toBeGreaterThan(4.95)
    expect(waves).toBeLessThan(5.05)
  })

  it('holds a note past the recording, steady and in tune', () => {
    const out = renderNote(flute, 76, 4, OUT)
    expect(out.length).toBe(Math.round(4.1 * OUT))
    const levels = [1, 2, 3, 3.8].map((t) => rms(out, Math.round(t * OUT), Math.round((t + 0.1) * OUT)))
    for (const l of levels) expect(l).toBeCloseTo(levels[0], 2)
    const heard = detectPitch(resample(out.subarray(2 * OUT, 3 * OUT), OUT, RATE), RATE, frequency(76))
    expect(Math.abs(cents(heard, frequency(76) * Math.pow(2, 8 / 1200)))).toBeLessThan(5)
  })

  it('fades out a tenth of a second after the note ends', () => {
    const out = renderNote(flute, 72, 0.5, OUT)
    expect(rms(out, Math.round(0.4 * OUT), Math.round(0.5 * OUT))).toBeGreaterThan(0.1)
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01)
  })

  it('plays a drum as recorded, whatever the pitch and length', () => {
    const hit = instrument(tone(200, 0.25, RATE, (t) => Math.exp(-t * 20)), null)
    expect(hit.loopStart).toBe(hit.loopEnd)
    const out = renderNote(hit, 90, 2, OUT)
    expect(out.length).toBe(Math.ceil((hit.data.length * OUT) / RATE))
  })
})

describe('rendering a song', () => {
  const flute = instrument(tone(frequency(72), 1), 72)
  // The last beat of the bar: the song is one bar, two seconds.
  const song: Song = { tempo: 120, tracks: [{ instrument: 'flute', notes: [{ step: 12, pitch: 72, length: 4 }] }] }

  it('lasts its whole bars, and what still sounds at the end goes on at the start', () => {
    const out = renderSong(song, () => flute, OUT)
    expect(out.length).toBe(Math.round(songSteps(song) * stepSeconds(120) * OUT))
    expect(out.length).toBe(2 * OUT)
    // The note's fade, after the end of the bar, is at the start of the loop.
    expect(rms(out, 0, Math.round(0.02 * OUT))).toBeGreaterThan(0.05)
    expect(rms(out, Math.round(0.2 * OUT), Math.round(1.4 * OUT))).toBe(0)
    expect(rms(out, Math.round(1.6 * OUT), Math.round(1.9 * OUT))).toBeGreaterThan(0.1)
  })

  it('is silent for a track whose instrument is missing', () => {
    const out = renderSong(song, () => undefined, OUT)
    expect(rms(out, 0, out.length)).toBe(0)
  })
})

describe('importing a recording', () => {
  const rate = 44100
  // A flute-like note: silence, a short attack, a held tone, the player stops, silence.
  const held = tone(523, 2.4, rate, (t) => (t < 0.2 ? 0 : t < 0.3 ? (t - 0.2) * 8 : t < 2 ? 0.8 : t < 2.1 ? 0.8 * (1 - (t - 2) * 10) : 0))
  // A marimba-like note: a strike that dies out.
  const struck = tone(523, 2, rate, (t) => (t < 0.1 ? 0 : 0.9 * Math.exp(-(t - 0.1) * 6)))

  it('starts at the note, ends before the player stops, at 16 kHz in 8 bits', () => {
    const d = prepareRecording(held, rate)
    expect(d.length / RATE).toBeGreaterThan(1.3)
    expect(d.length / RATE).toBeLessThan(1.75)
    expect(Math.abs(d[0])).toBeLessThan(0.1)
    for (const v of d.subarray(0, 200)) expect(Math.round(v * 127) / 127).toBeCloseTo(v, 6)
    expect(Math.max(...d)).toBeCloseTo(0.95, 1)
  })

  it('keeps a struck sound until it has died out', () => {
    const d = prepareRecording(struck, rate)
    expect(d.length / RATE).toBeGreaterThan(1)
    expect(rms(d, d.length - 400, d.length)).toBeLessThan(0.01)
  })

  it('tunes a recording exactly to its note', () => {
    const sharp = prepareRecording(tone(frequency(72) * Math.pow(2, 30 / 1200), 2, rate), rate)
    const { data, note } = tuneRecording(sharp)
    expect(note).toBe(72)
    expect(Math.abs(cents(detectPitch(data, RATE), frequency(72)))).toBeLessThan(2)
    expect(tuneRecording(new Float32Array(4000).map(() => Math.random() - 0.5)).note).toBeNull()
  })

  it('finds the note it was recorded at', () => {
    const d = prepareRecording(held, rate)
    expect(noteName(Math.round(69 + 12 * Math.log2(detectPitch(d, RATE) / 440)))).toBe('C5')
  })
})

describe('a track never covers itself', () => {
  it('cuts a note where the same pitch starts again, and keeps one of two on the same step', () => {
    const song = parseSong(JSON.stringify({ tracks: [{ instrument: 'harp', notes: [[0, 'G2', 7], [6, 'G2', 7], [6, 'D3', 4], [12, 'G2', 2], [12, 'G2', 5], [3], [3]] }] }))
    expect(song.tracks[0].notes.map((n) => [n.step, n.pitch, n.length])).toEqual([[0, 43, 6], [3, null, 1], [6, 43, 6], [6, 50, 4], [12, 43, 5]])
  })
})

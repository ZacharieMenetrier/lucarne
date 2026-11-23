import { describe, expect, it } from 'vitest'
import { HOP, PitchTracker, transcribe, type TakeFrame } from '../editor/src/sing'
import { frequency } from '../runtime/sound'

const RATE = 48000
/** Seconds per step at 120 quarter notes per minute. */
const STEP = 0.125

/** A voice-like sound: a few harmonics, falling off, at a pitch that may glide. */
function sing(parts: { pitch: number | null; seconds: number; to?: number; level?: number }[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.seconds, 0)
  const out = new Float32Array(Math.round(total * RATE))
  let i = 0
  let phase = 0
  for (const p of parts) {
    const n = Math.round(p.seconds * RATE)
    for (let k = 0; k < n; k++, i++) {
      if (p.pitch === null) continue
      const pitch = p.to === undefined ? p.pitch : p.pitch + ((p.to - p.pitch) * k) / n
      phase += (2 * Math.PI * frequency(pitch)) / RATE
      const v = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)
      out[i] = 0.2 * (p.level ?? 1) * v
    }
  }
  return out
}

/** The frames of a sound, given in chunks as a microphone would, placed on the song from step 0. */
function frames(sound: Float32Array): TakeFrame[] {
  const tracker = new PitchTracker(RATE)
  const out: TakeFrame[] = []
  for (let i = 0; i < sound.length; i += 1024) {
    for (const f of tracker.push(sound.subarray(i, i + 1024), i / RATE)) out.push({ step: f.time / STEP, pitch: f.pitch, level: f.level })
  }
  return out
}

const take = (sound: Float32Array, drum = false) => transcribe(frames(sound), drum, HOP / STEP)
const plain = (notes: { step: number; pitch: number | null; length: number }[]) => notes.map((n) => [n.step, n.pitch, n.length])

describe('singing a melody', () => {
  it('hears the pitch of a voice', () => {
    const f = frames(sing([{ pitch: 57, seconds: 0.3 }])).filter((x) => x.pitch !== null)
    expect(f.length).toBeGreaterThan(20)
    for (const x of f) expect(Math.abs((x.pitch as number) - 57)).toBeLessThan(0.1)
  })

  it('turns a phrase into notes on the grid', () => {
    // C4 for a quarter, E4 for a quarter, a rest, G4 for a half (at 120: a step is 1/8 s).
    const t = take(sing([{ pitch: 60, seconds: 0.5 }, { pitch: 64, seconds: 0.5 }, { pitch: null, seconds: 0.375 }, { pitch: 67, seconds: 1 }]))
    expect(plain(t)).toEqual([[0, 60, 4], [4, 64, 4], [11, 67, 8]])
  })

  it('holds a note over a breath before the next', () => {
    const t = take(sing([{ pitch: 60, seconds: 0.3 }, { pitch: null, seconds: 0.2 }, { pitch: 64, seconds: 0.5 }]))
    expect(plain(t)).toEqual([[0, 60, 4], [4, 64, 4]])
  })

  it('hears a voice caught an octave off as the voice', () => {
    const t = take(sing([{ pitch: 57, seconds: 0.25 }, { pitch: 69, seconds: 0.05 }, { pitch: 57, seconds: 0.2 }]))
    expect(plain(t)).toEqual([[0, 57, 4]])
  })

  it('moves a take sung late onto the grid', () => {
    const t = take(sing([{ pitch: null, seconds: 0.2 }, { pitch: 60, seconds: 0.5 }, { pitch: 62, seconds: 0.5 }, { pitch: 64, seconds: 0.25 }, { pitch: 65, seconds: 0.25 }, { pitch: 67, seconds: 1 }]))
    expect(plain(t)).toEqual([[0, 60, 4], [4, 62, 4], [8, 64, 2], [10, 65, 2], [12, 67, 8]])
  })

  it('takes a slide into a note as that note', () => {
    const t = take(sing([{ pitch: 58, to: 62, seconds: 0.04 }, { pitch: 62, seconds: 0.5 }]))
    expect(plain(t)).toEqual([[0, 62, 4]])
  })

  it('splits one pitch sung twice, on the dip between', () => {
    const t = take(sing([{ pitch: 60, seconds: 0.45 }, { pitch: 60, seconds: 0.05, level: 0.1 }, { pitch: 60, seconds: 0.5 }]))
    expect(t.map((n) => n.pitch)).toEqual([60, 60])
  })

  it('forgives a singer flat all along', () => {
    const t = take(sing([{ pitch: 59.6, seconds: 0.5 }, { pitch: 61.6, seconds: 0.5 }, { pitch: 63.6, seconds: 0.5 }]))
    expect(t.map((n) => n.pitch)).toEqual([60, 62, 64])
  })

  it('hears nothing in silence', () => {
    expect(take(sing([{ pitch: null, seconds: 1 }]))).toEqual([])
  })
})

describe('clapping a drum', () => {
  it('turns each attack into a hit', () => {
    const clap = (): { pitch: number | null; seconds: number }[] => [{ pitch: 70, seconds: 0.05 }, { pitch: null, seconds: 0.2 }]
    const t = take(sing([...clap(), ...clap(), ...clap(), ...clap()]), true)
    expect(plain(t)).toEqual([[0, null, 1], [2, null, 1], [4, null, 1], [6, null, 1]])
  })
})

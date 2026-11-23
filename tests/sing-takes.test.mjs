// The singing transcription scored on recorded takes (tests/sing-takes): each one is a voice
// singing "Frère Jacques" over the click, with the melody it should give. The singer picks
// the key, so a take is scored after moving it to the melody's key. It reads files, so it is
// plain JavaScript run by node, as the build's test is.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOP, listen, transcribe } from '../editor/src/sing.ts'

/** The samples of a 16-bit WAV file, its first channel. */
function wav(path) {
  const b = readFileSync(path)
  let channels = 1
  for (let o = 12; o < b.length; ) {
    const id = b.toString('ascii', o, o + 4)
    const n = b.readUInt32LE(o + 4)
    if (id === 'fmt ') channels = b.readUInt16LE(o + 10)
    if (id === 'data') {
      const out = new Float32Array(n / 2 / channels)
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(o + 8 + i * 2 * channels) / 32768
      return out
    }
    o += 8 + n + (n & 1)
  }
  throw new Error(`${path}: no sound`)
}

/** The notes of a take, as the sing popup makes them (singdialog.ts). */
function sung(id) {
  const take = JSON.parse(readFileSync(`tests/sing-takes/${id}.json`, 'utf8'))
  const sound = wav(`tests/sing-takes/${id}.wav`)
  const rate = take.sampleRate
  const step = 15 / take.tempo
  const delay = (take.latency.microphone ?? 0) + (take.latency.output ?? 0) + (take.latency.base ?? 0)
  const start = take.songStartSeconds
  const from = Math.max(0, Math.round((start + delay - step) * rate))
  const frames = listen(sound.subarray(from), rate).map((f) => ({ step: (from / rate + f.time - delay - start) / step, pitch: f.pitch, level: f.level }))
  const notes = transcribe(frames, false, HOP / step).filter((n) => n.step >= 0)
  return { notes, melody: take.melody.map((n) => ({ step: n.step, pitch: n.pitch, length: n.length })) }
}

/** How many notes of the melody the take has exactly (start, pitch and length), in its best key. */
function score(notes, melody) {
  const key = (n, shift) => `${n.step}:${n.pitch - shift}:${n.length}`
  let best = 0
  for (let shift = -24; shift <= 24; shift++) {
    const got = new Set(notes.map((n) => key(n, shift)))
    best = Math.max(best, melody.filter((n) => got.has(key(n, 0))).length)
  }
  return best
}

describe('singing recorded takes', () => {
  // you-1 is left out: its singer came in two beats late and sang a note in the count-in.
  // The least each must get right: what it gets now, so a change can only make them better.
  for (const [id, least] of [['you-2', 25], ['other-1', 16], ['other-2', 18]]) {
    it(`transcribes ${id}`, () => {
      const { notes, melody } = sung(id)
      const s = score(notes, melody)
      expect(s).toBeGreaterThanOrEqual(least)
    })
  }
})

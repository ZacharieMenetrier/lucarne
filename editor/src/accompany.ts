// Accompany: writes chords for one instrument under what the song's other instruments play,
// the way a musician finds them by ear. No DOM, no settings: the instrument decides how the
// chords are played, the song's notes decide which ones.
//
// 1. The key: how long each note name (C, D, E… any octave) sounds, matched against the
//    fingerprint of every major and minor key (Krumhansl and Kessler's profiles).
// 2. A chord every half bar (every bar in 3/4, whose three beats don't halve), among the
//    key's chords: the one whose notes get the most of the half bar's weight. A note weighs
//    the steps it sounds, a beat more, the half bar's first step more still, so runs and
//    passing notes between beats hardly count. Each instrument has one vote, shared by its
//    notes: a busy arpeggio counts as much as the melody, and an accompaniment written
//    before, which agrees with the melody, reinforces it without drowning a melody changed
//    since. A chord whose root is heard wins a tie (A and C are Am more than F). A near
//    tie keeps the chord before (chords that jump around sound like guesses),
//    then prefers the home chord and the one leading home. A half bar where nothing plays keeps the chord.
// 3. The notes, by the kind of instrument (no setting: a harp is plucked, a cello is low):
//    - held (a bow, a breath), high: the chord held, in the octave under the melody;
//    - held, low: its root held, an octave lower;
//    - struck or plucked, high: an arpeggio in eighths, root, fifth, octave, tenth and back;
//    - struck or plucked, low: the root on the chord's first beat, the fifth on the others.
//    The melody is the instrument that plays highest on average; everything is placed
//    under it.

import { HIGHEST, LOWEST, TIMES, noteEnd, type Note, type Song } from '../../runtime/sound'

/** What kind of instrument plays the accompaniment. */
export interface Voice {
  /** Its sound lasts while the note is held (a bow, a breath), rather than dying out. */
  held: boolean
  /** Recorded under C4: a bass. */
  low: boolean
}

export interface Chord {
  /** Its root, a note name number (0 is C). */
  root: number
  minor: boolean
}

export interface Key {
  tonic: number
  minor: boolean
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const chordName = (c: Chord) => NAMES[c.root] + (c.minor ? 'm' : '')
const tones = (c: Chord) => [c.root, (c.root + (c.minor ? 3 : 4)) % 12, (c.root + 7) % 12]
const same = (a: Chord, b: Chord) => a.root === b.root && a.minor === b.minor
const pc = (pitch: number) => ((pitch % 12) + 12) % 12

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** The chords of a key and how much each is preferred on a near tie: the home chord, then the
 *  one that leads home (V: G in C). The diminished one is left out: it rarely carries a half bar.
 *  In minor, V is major (E in A minor), the chord that leads home. */
function keyChords(k: Key): { chord: Chord; prior: number }[] {
  const t = k.tonic
  const c = (step: number, minor: boolean, prior = 0) => ({ chord: { root: (t + step) % 12, minor }, prior })
  return k.minor
    ? [c(0, true, 0.03), c(3, false), c(5, true), c(7, false, 0.02), c(8, false), c(10, false)]
    : [c(0, false, 0.03), c(2, true), c(4, true), c(5, false), c(7, false, 0.02), c(9, true)]
}

/** Whose notes the chords are found from: every instrument but this one and the drums. */
function sources(song: Song, part: number, isDrum: (name: string) => boolean): Note[][] {
  return song.instruments.filter((p, i) => i !== part && !isDrum(p.instrument) && p.notes.some((n) => n.pitch !== null)).map((p) => p.notes)
}

/** How long each note name sounds, one vote per instrument. */
export function findKey(parts: Note[][]): Key {
  const weight = new Array(12).fill(0)
  for (const notes of parts) {
    const total = notes.reduce((s, n) => s + n.length, 0)
    for (const n of notes) if (n.pitch !== null) weight[pc(n.pitch)] += n.length / total
  }
  let best: Key = { tonic: 0, minor: false }
  let bestScore = -Infinity
  for (const minor of [false, true]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const profile = (minor ? MINOR_PROFILE : MAJOR_PROFILE).map((_, i, p) => p[(i - tonic + 12) % 12])
      const score = correlation(weight, profile)
      if (score > bestScore) [best, bestScore] = [{ tonic, minor }, score]
    }
  }
  return best
}

function correlation(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** Steps a chord lasts at most: half a bar, a whole one in 3/4. */
export const chordSteps = (song: Song) => (song.time === '3/4' ? TIMES[song.time].bar : TIMES[song.time].bar / 2)

/** A chord for every half bar from the start of the song to the end of the bar of the parts' last note. */
export function findChords(song: Song, parts: Note[][], key = findKey(parts)): Chord[] {
  const seg = chordSteps(song)
  const { bar, beat } = TIMES[song.time]
  const last = Math.max(0, ...parts.flat().map(noteEnd))
  const segments = (Math.ceil(last / bar) * bar) / seg
  const choices = keyChords(key)
  const chords: Chord[] = []
  let prev: Chord | null = null
  for (let s = 0; s < segments; s++) {
    const from = s * seg
    // Each instrument's weight on each note name, summing to its one vote.
    const weight = new Array(12).fill(0)
    let heard = false
    for (const notes of parts) {
      const w = new Array(12).fill(0)
      let total = 0
      for (const n of notes) {
        if (n.pitch === null) continue
        for (let step = Math.max(from, n.step); step < Math.min(from + seg, noteEnd(n)); step++) {
          const x = step === from ? 3 : (step - from) % beat === 0 ? 2 : 1
          w[pc(n.pitch)] += x
          total += x
        }
      }
      if (!total) continue
      heard = true
      for (let i = 0; i < 12; i++) weight[i] += w[i] / total
    }
    let chord: Chord
    if (!heard) chord = prev ?? choices[0].chord
    else {
      let best = choices[0].chord
      let bestScore = -Infinity
      for (const { chord: c, prior } of choices) {
        // Its root heard counts a little more: A and C under Am rather than F.
        const score = tones(c).reduce((sum, t) => sum + weight[t], 0) + weight[c.root] * 0.03 + prior + (prev && same(prev, c) ? 0.05 : 0)
        if (score > bestScore) [best, bestScore] = [c, score]
      }
      chord = best
    }
    chords.push(chord)
    prev = chord
  }
  return chords
}

/** The notes the instrument at `part` plays under the others; empty if nothing else plays notes. */
export function accompany(song: Song, part: number, voice: Voice, isDrum: (name: string) => boolean): Note[] {
  const parts = sources(song, part, isDrum)
  if (!parts.length) return []
  const chords = findChords(song, parts)
  // The melody: the instrument that plays highest, on average over its notes' lengths.
  const melody = Math.max(...parts.map((notes) => {
    const pitched = notes.filter((n) => n.pitch !== null)
    const total = pitched.reduce((s, n) => s + n.length, 0)
    return pitched.reduce((s, n) => s + n.pitch! * n.length, 0) / total
  }))
  const top = Math.round(melody)
  // The chord in the octave under the melody; the root of the bass and of an arpeggio an
  // octave under that.
  const inOctave = (tone: number, low: number) => clamp(low + pc(tone - low))
  const chordLow = top - 12
  const rootLow = top - 24
  const seg = chordSteps(song)
  const beat = TIMES[song.time].beat
  const out: Note[] = []
  if (voice.held) {
    // Held: a chord lasts until the next different one.
    for (let s = 0; s < chords.length; ) {
      let e = s + 1
      while (e < chords.length && same(chords[e], chords[s])) e++
      const step = s * seg
      const length = (e - s) * seg
      const c = chords[s]
      if (voice.low) out.push({ step, pitch: inOctave(c.root, rootLow), length })
      else for (const t of tones(c)) out.push({ step, pitch: inOctave(t, chordLow), length })
      s = e
    }
  } else {
    chords.forEach((c, s) => {
      const from = s * seg
      const root = inOctave(c.root, rootLow)
      if (voice.low) {
        // The root on the chord's first beat, the fifth on its others.
        for (let step = from; step < from + seg; step += beat) out.push({ step, pitch: clamp(step === from ? root : root + 7), length: beat })
      } else {
        // Up through the chord and back, in eighths, each note ringing to the chord's end.
        const up = [0, 7, 12, 12 + (c.minor ? 3 : 4)]
        const cycle = [...up, ...up.slice(1, -1).reverse()]
        for (let i = 0, step = from; step < from + seg; i++, step += 2) out.push({ step, pitch: clamp(root + cycle[i % cycle.length]), length: from + seg - step })
      }
    })
  }
  return out
}

const clamp = (p: number) => Math.max(LOWEST, Math.min(HIGHEST, p))

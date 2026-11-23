import { describe, expect, it } from 'vitest'
import { accompany, chordName, findChords, findKey } from '../editor/src/accompany'
import { MusicEditor } from '../editor/src/music'
import { noteName, noteNumber, type Note, type Song } from '../runtime/sound'

const isDrum = (i: string) => i === 'snare'
const notes = (list: [number, string, number][]): Note[] => list.map(([step, name, length]) => ({ step, pitch: noteNumber(name), length }))

// Maggie's first eight bars: C | G C | C | G C | Am | Dm G | Am | Dm G.
const MELODY = notes([[0, 'C4', 2], [2, 'C4', 2], [4, 'G4', 4], [8, 'E4', 4], [12, 'F4', 4], [16, 'D4', 4], [20, 'E4', 4], [24, 'C4', 2], [26, 'C4', 2], [28, 'G3', 4], [32, 'C4', 2], [34, 'C4', 2], [36, 'G4', 4], [40, 'E4', 4], [44, 'F4', 4], [48, 'D4', 4], [52, 'E4', 4], [56, 'C4', 2], [58, 'C4', 2], [60, 'G3', 4], [64, 'C4', 2], [66, 'B3', 2], [68, 'A3', 4], [72, 'C4', 4], [76, 'E4', 4], [80, 'D4', 2], [82, 'E4', 2], [84, 'F4', 2], [86, 'E4', 2], [88, 'D4', 2], [90, 'C4', 2], [92, 'B3', 4], [96, 'C4', 2], [98, 'B3', 2], [100, 'A3', 4], [104, 'C4', 4], [108, 'E4', 4], [112, 'D4', 2], [114, 'E4', 2], [116, 'F4', 2], [118, 'E4', 2], [120, 'D4', 2], [122, 'C4', 2], [124, 'B3', 4]])
const MAGGIE = 'C C G C C C G C Am Am Dm G Am Am Dm G'

const song = (time: Song['time'] = '4/4'): Song => ({ tempo: 70, time, instruments: [{ instrument: 'flute', notes: MELODY.map((n) => ({ ...n })) }, { instrument: 'harp', notes: [] }, { instrument: 'snare', notes: [{ step: 0, pitch: null, length: 1 }] }] })
const show = (ns: Note[]) => ns.map((n) => `${n.step} ${noteName(n.pitch!)} ${n.length}`)

const accompanyCount = () => accompany(song(), 1, { held: true, low: false }, isDrum).length

describe('accompany', () => {
  it('finds the key and a chord every half bar', () => {
    expect(findKey([MELODY])).toEqual({ tonic: 0, minor: false })
    expect(findChords(song(), [MELODY]).map(chordName).join(' ')).toBe(MAGGIE)
  })

  it('finds a minor key, and its major V', () => {
    // A minor: A C E, then E G# B, then A.
    const m = notes([[0, 'A4', 4], [4, 'C5', 4], [8, 'E5', 4], [12, 'C5', 4], [16, 'B4', 4], [20, 'G#4', 4], [24, 'E4', 8], [32, 'A4', 16]])
    expect(findKey([m])).toEqual({ tonic: 9, minor: true })
    expect(findChords(song(), [m]).map(chordName).join(' ')).toBe('Am Am E E Am Am')
  })

  it('gives each instrument one vote: a busy part counts as much as the melody, not more', () => {
    // The melody says G over bar 1's second half; another part plays C E C E… there: a tie,
    // which keeps the chord before.
    const melody = notes([[0, 'C5', 8], [8, 'B4', 4], [12, 'D5', 4]])
    const busy = notes([[0, 'C4', 1], ...Array.from({ length: 8 }, (_, i): [number, string, number] => [8 + i, ['C4', 'E4'][i % 2], 1])])
    expect(findChords(song(), [melody, busy]).map(chordName)).toEqual(['C', 'C'])
    expect(findChords(song(), [melody]).map(chordName)).toEqual(['C', 'G'])
    // With a third part agreeing with the melody, G wins again.
    expect(findChords(song(), [melody, busy, notes([[8, 'D3', 8]])]).map(chordName)).toEqual(['C', 'G'])
  })

  it('arpeggiates a plucked instrument, under the melody', () => {
    const out = accompany(song(), 1, { held: false, low: false }, isDrum)
    expect(show(out.slice(0, 8))).toEqual(['0 C3 8', '2 G3 6', '4 C4 4', '6 E4 2', '8 C3 8', '10 G3 6', '12 C4 4', '14 E4 2'])
    // Bar 5, Am.
    expect(show(out.slice(32, 36))).toEqual(['64 A2 8', '66 E3 6', '68 A3 4', '70 C4 2'])
    expect(out.length).toBe(64)
  })

  it('holds a bowed chord until it changes, and a low one plays its root', () => {
    const held = accompany(song(), 1, { held: true, low: false }, isDrum)
    expect(show(held.slice(0, 6))).toEqual(['0 C4 16', '0 E3 16', '0 G3 16', '16 G3 8', '16 B3 8', '16 D3 8'])
    const bass = accompany(song(), 1, { held: true, low: true }, isDrum)
    expect(show(bass.slice(0, 3))).toEqual(['0 C3 16', '16 G2 8', '24 C3 24'])
    const plucked = accompany(song(), 1, { held: false, low: true }, isDrum)
    expect(show(plucked.slice(0, 4))).toEqual(['0 C3 4', '4 G3 4', '8 C3 4', '12 G3 4'])
  })

  it('plays one chord a bar in 3/4, the arpeggio going back down', () => {
    const s = song('3/4')
    s.instruments[0].notes = notes([[0, 'C4', 4], [4, 'E4', 4], [8, 'G4', 4], [12, 'B3', 4], [16, 'D4', 4], [20, 'G4', 4], [24, 'C4', 12]])
    expect(findChords(s, [s.instruments[0].notes]).map(chordName)).toEqual(['C', 'G', 'C'])
    expect(show(accompany(s, 1, { held: false, low: false }, isDrum).slice(0, 6)).map((x) => x.split(' ')[1])).toEqual(['C3', 'G3', 'C4', 'E4', 'C4', 'G3'])
  })

  it('replaces the notes in one undo, and needs something to accompany', () => {
    const ed = new MusicEditor()
    ed.isDrum = isDrum
    ed.open('maggie', song())
    expect(ed.accompany(1, { held: true, low: false })).toBe(true)
    expect(ed.selected).toBe(1)
    expect(ed.song!.instruments[1].notes.length).toBe(accompanyCount())
    ed.undo()
    expect(ed.song!.instruments[1].notes).toEqual([])
    expect(ed.accompany(2, { held: true, low: false })).toBe(false)
    const empty = new MusicEditor()
    empty.isDrum = isDrum
    empty.open('x', { tempo: 120, time: '4/4', instruments: [{ instrument: 'flute', notes: [] }, { instrument: 'harp', notes: [] }] })
    expect(empty.accompany(1, { held: true, low: false })).toBe(false)
  })
})

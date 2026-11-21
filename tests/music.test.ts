import { describe, expect, it } from 'vitest'
import { MusicEditor } from '../editor/src/music'
import { emptySong, serializeSong, songSteps, type Song } from '../runtime/sound'

function editor(song: Song = { tempo: 120, tracks: [{ instrument: 'flute', notes: [] }, { instrument: 'snare', notes: [] }] }) {
  const ed = new MusicEditor()
  ed.isDrum = (i) => i === 'snare'
  const saved: string[] = []
  ed.onEdit = (n) => saved.push(n)
  ed.open('town', song)
  return { ed, song, saved }
}

describe('music editor', () => {
  it('places notes of the length last used, on the selected track', () => {
    const { ed, song, saved } = editor()
    ed.place(0, 72)
    const n = ed.place(4, 74)!
    ed.resize(n, 2)
    ed.place(8, 76)
    expect(song.tracks[0].notes.map((x) => [x.step, x.pitch, x.length])).toEqual([[0, 72, 4], [4, 74, 2], [8, 76, 2]])
    expect(saved.length).toBe(4)
    expect(ed.noteAt(5, 74)).toBe(n)
    expect(ed.noteAt(6, 74)).toBeNull()
  })

  it('gives a drum hits on one row, a click toggling them', () => {
    const { ed, song } = editor()
    ed.toggleHit(1, 4)
    ed.toggleHit(1, 8)
    ed.toggleHit(1, 4)
    expect(song.tracks[1].notes).toEqual([{ step: 8, pitch: null, length: 1 }])
    expect(serializeSong(song)).toContain('"notes": [[8]]')
  })

  it('undoes a whole drag at once, and redoes it', () => {
    const { ed, song } = editor()
    const n = ed.place(0, 72)!
    ed.begin()
    const from = new Map([[n, { step: 0, pitch: 72 }]])
    ed.move([n], from, 1, 0)
    ed.move([n], from, 2, 3)
    ed.end()
    expect([n.step, n.pitch]).toEqual([2, 75])
    ed.undo()
    expect(song.tracks[0].notes.map((x) => [x.step, x.pitch])).toEqual([[0, 72]])
    ed.undo()
    expect(song.tracks[0].notes).toEqual([])
    ed.redo()
    ed.redo()
    expect(song.tracks[0].notes.map((x) => [x.step, x.pitch])).toEqual([[2, 75]])
  })

  it('keeps moved notes on the grid', () => {
    const { ed } = editor()
    const n = ed.place(2, 105)!
    ed.move([n], new Map([[n, { step: 2, pitch: 105 }]]), -5, 10)
    expect([n.step, n.pitch]).toEqual([0, 108])
  })

  it('selects, copies, pastes where playing starts, and duplicates', () => {
    const { ed, song } = editor()
    ed.place(0, 72, 2)
    ed.place(2, 76, 2)
    ed.place(8, 79, 2)
    ed.setTool('select')
    ed.selectRange(0, 3, 70, 80)
    expect(ed.selection.size).toBe(2)
    ed.copy()
    ed.start = 16
    ed.paste()
    expect(song.tracks[0].notes.map((x) => x.step)).toEqual([0, 2, 8, 16, 18])
    expect([...ed.selection].map((x) => x.step)).toEqual([16, 18])
    ed.duplicate()
    expect(song.tracks[0].notes.map((x) => x.step)).toEqual([0, 2, 8, 16, 18, 20, 22])
    expect(songSteps(song)).toBe(32)
  })

  it('turns notes into hits when a track becomes a drum, and back', () => {
    const { ed, song } = editor()
    ed.place(0, 60, 3)
    ed.setInstrument(0, 'snare')
    expect(song.tracks[0].notes).toEqual([{ step: 0, pitch: null, length: 1 }])
    ed.setInstrument(0, 'flute')
    expect(song.tracks[0].notes[0].pitch).toBe(72)
  })

  it('removes a track and keeps one selected', () => {
    const { ed, song } = editor()
    ed.selectTrack(1)
    ed.removeTrack(1)
    expect(song.tracks.length).toBe(1)
    expect(ed.track).toBe(0)
  })

  it('keeps an undo per song', () => {
    const { ed } = editor()
    ed.place(0, 72)
    const other = emptySong()
    other.tracks.push({ instrument: 'flute', notes: [] })
    ed.open('cave', other)
    ed.undo()
    expect(other.tracks.length).toBe(1)
  })
})

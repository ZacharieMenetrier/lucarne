import { describe, expect, it } from 'vitest'
import { MusicEditor } from '../editor/src/music'
import { emptySong, serializeSong, songSteps, type Song } from '../runtime/sound'

function editor(song: Song = { tempo: 120, time: '4/4', instruments: [{ instrument: 'flute', notes: [] }, { instrument: 'snare', notes: [] }] }) {
  const ed = new MusicEditor()
  ed.isDrum = (i) => i === 'snare' || i === 'tambourine'
  const saved: string[] = []
  ed.onEdit = (n) => saved.push(n)
  ed.open('town', song)
  return { ed, song, saved }
}

describe('music editor', () => {
  it('places notes of the length last used, on the selected instrument', () => {
    const { ed, song, saved } = editor()
    ed.place(0, 72)
    const n = ed.place(4, 74)!
    ed.resize(n, 2)
    ed.place(8, 76)
    expect(song.instruments[0].notes.map((x) => [x.step, x.pitch, x.length])).toEqual([[0, 72, 4], [4, 74, 2], [8, 76, 2]])
    expect(saved.length).toBe(4)
    expect(ed.noteAt(5, 74)).toBe(n)
    expect(ed.noteAt(6, 74)).toBeNull()
  })

  it('gives a drum hits on one row, a click toggling them', () => {
    const { ed, song } = editor()
    ed.toggleHit(1, 4)
    ed.toggleHit(1, 8)
    ed.toggleHit(1, 4)
    expect(song.instruments[1].notes).toEqual([{ step: 8, pitch: null, length: 1 }])
    expect(serializeSong(song)).toContain('"snare": [[8]]')
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
    expect(song.instruments[0].notes.map((x) => [x.step, x.pitch])).toEqual([[0, 72]])
    ed.undo()
    expect(song.instruments[0].notes).toEqual([])
    ed.redo()
    ed.redo()
    expect(song.instruments[0].notes.map((x) => [x.step, x.pitch])).toEqual([[2, 75]])
  })

  it('keeps moved notes on the grid', () => {
    const { ed } = editor()
    const n = ed.place(2, 105)!
    ed.move([n], new Map([[n, { step: 2, pitch: 105 }]]), -5, 10)
    expect([n.step, n.pitch]).toEqual([0, 108])
  })

  it('picks notes with a click, ⇧ adding or taking one away, and the pencil keeps them', () => {
    const { ed } = editor()
    const a = ed.place(0, 72, 2)!
    const b = ed.place(2, 76, 2)!
    const c = ed.place(8, 79, 2)!
    expect(ed.tool).toBe('pencil')
    expect(ed.pick(a)).toBe(true)
    expect([...ed.selection]).toEqual([a])
    ed.pick(b, true)
    ed.pick(c, true)
    expect(ed.selection.size).toBe(3)
    // A click on a note already selected keeps the others, to drag them all.
    ed.pick(b)
    expect(ed.selection.size).toBe(3)
    expect(ed.pick(b, true)).toBe(false)
    expect([...ed.selection]).toEqual([a, c])
    ed.pick(b)
    expect([...ed.selection]).toEqual([b])
    ed.setTool('select')
    expect([...ed.selection]).toEqual([b])
    ed.setTool('eraser')
    expect(ed.selection.size).toBe(0)
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
    expect(song.instruments[0].notes.map((x) => x.step)).toEqual([0, 2, 8, 16, 18])
    expect([...ed.selection].map((x) => x.step)).toEqual([16, 18])
    ed.duplicate()
    expect(song.instruments[0].notes.map((x) => x.step)).toEqual([0, 2, 8, 16, 18, 20, 22])
    expect(songSteps(song)).toBe(32)
  })

  it('selects bars across every instrument: copies, pastes, duplicates, moves and deletes them', () => {
    const { ed, song } = editor()
    ed.place(0, 72, 2)
    ed.place(18, 76, 2)
    ed.toggleHit(1, 4)
    ed.toggleHit(1, 20)
    const steps = () => song.instruments.map((t) => t.notes.map((n) => n.step).sort((a, b) => a - b))
    // Bar 2, dragged either way; never past the song's end.
    ed.selectBars(30, 17)
    expect(ed.bars).toEqual({ from: 16, to: 32 })
    ed.selectBars(0, 200)
    expect(ed.bars).toEqual({ from: 0, to: 32 })
    ed.selectBars(0, 15)
    ed.duplicate()
    expect(ed.bars).toEqual({ from: 16, to: 32 })
    // The copy replaces what was in bar 2, in every instrument.
    expect(steps()).toEqual([[0, 16], [4, 20]])
    ed.copy()
    ed.start = 32
    ed.paste()
    expect(steps()).toEqual([[0, 16, 32], [4, 20, 36]])
    expect(ed.bars).toEqual({ from: 32, to: 48 })
    // Moved onto bar 1: it replaces it, and leaves its own bar empty.
    ed.begin()
    ed.moveBars(ed.bars!, -16)
    ed.moveBars({ from: 32, to: 48 }, -32)
    ed.end()
    expect(steps()).toEqual([[0, 16], [4, 20]])
    expect(ed.bars).toEqual({ from: 0, to: 16 })
    ed.undo()
    expect(steps()).toEqual([[0, 16, 32], [4, 20, 36]])
    ed.selectBars(16, 16)
    ed.deleteSelection()
    expect(steps()).toEqual([[0, 32], [4, 36]])
    // Picking a note goes back to the notes.
    ed.select(0)
    ed.pick(song.instruments[0].notes[0])
    expect(ed.bars).toBeNull()
  })

  it('adds a bar after the bar of the flag, pushing the rest right, and removes bars, pulling it left', () => {
    const { ed, song } = editor()
    ed.place(0, 72, 20)
    ed.place(18, 76, 2)
    ed.toggleHit(1, 20)
    const steps = () => song.instruments.map((t) => t.notes.map((n) => n.step).sort((a, b) => a - b))
    // The flag on bar 1: + is a new bar 2.
    ed.addBar()
    expect(steps()).toEqual([[0, 34], [36]])
    // A note held over it keeps its length.
    expect(song.instruments[0].notes.find((n) => n.step === 0)!.length).toBe(20)
    // − on the flag's bar (bar 3 now).
    ed.start = 32
    ed.removeBars()
    expect(steps()).toEqual([[0], []])
    expect(ed.start).toBe(16)
    // Bars selected: + after the last one, − takes them all.
    ed.undo()
    ed.selectBars(16, 40)
    expect(ed.start).toBe(16)
    ed.addBar()
    expect(steps()).toEqual([[0, 34], [36]])
    ed.selectBars(16, 40)
    ed.removeBars()
    expect(steps()).toEqual([[0], []])
    expect(ed.bars).toBeNull()
  })

  it('turns notes into hits when an instrument is replaced by a drum, and back', () => {
    const { ed, song } = editor()
    ed.place(0, 60, 3)
    ed.replaceInstrument(0, 'tambourine')
    expect(song.instruments[0].notes).toEqual([{ step: 0, pitch: null, length: 1 }])
    ed.replaceInstrument(0, 'flute')
    expect(song.instruments[0].notes[0].pitch).toBe(72)
  })

  it('has each instrument once', () => {
    const { ed, song } = editor()
    ed.addInstrument('flute')
    expect(song.instruments.map((p) => p.instrument)).toEqual(['flute', 'snare'])
    // Adding one it has selects it.
    ed.addInstrument('snare')
    expect([song.instruments.length, ed.selected]).toEqual([2, 1])
    ed.replaceInstrument(0, 'snare')
    expect(song.instruments[0].instrument).toBe('flute')
    ed.addInstrument('harp')
    expect([song.instruments.length, ed.selected]).toEqual([3, 2])
  })

  it('mutes an instrument without changing the song, until another song opens', () => {
    const { ed, saved } = editor()
    ed.toggleMute('snare')
    expect([...ed.muted]).toEqual(['snare'])
    expect(saved).toEqual([])
    ed.toggleMute('snare')
    expect(ed.muted.size).toBe(0)
    ed.toggleMute('flute')
    ed.open('cave', emptySong())
    expect(ed.muted.size).toBe(0)
  })

  it('removes an instrument and keeps one selected', () => {
    const { ed, song } = editor()
    ed.select(1)
    ed.removeInstrument(1)
    expect(song.instruments.length).toBe(1)
    expect(ed.selected).toBe(0)
  })

  it('changes the time, undoably, without moving notes', () => {
    const { ed, song } = editor()
    ed.place(4, 72)
    ed.setTime('3/4')
    expect([song.time, song.instruments[0].notes[0].step]).toEqual(['3/4', 4])
    ed.undo()
    expect(song.time).toBe('4/4')
  })

  it('replaces the part sung over with the take, undone at once', () => {
    const { ed, song } = editor()
    ed.place(0, 60, 6)
    ed.place(8, 62, 2)
    ed.place(16, 64, 2)
    ed.sing([{ step: 4, pitch: 67, length: 2 }, { step: 6, pitch: 69, length: 4 }], 4, 10)
    expect(ed.selection.size).toBe(2)
    expect(song.instruments[0].notes.map((n) => [n.step, n.pitch, n.length])).toEqual([[0, 60, 4], [4, 67, 2], [6, 69, 4], [16, 64, 2]])
    ed.undo()
    expect(song.instruments[0].notes.map((n) => [n.step, n.pitch, n.length])).toEqual([[0, 60, 6], [8, 62, 2], [16, 64, 2]])
  })

  it('keeps an undo per song', () => {
    const { ed } = editor()
    ed.place(0, 72)
    const other = emptySong()
    other.instruments.push({ instrument: 'flute', notes: [] })
    ed.open('cave', other)
    ed.undo()
    expect(other.instruments.length).toBe(1)
  })
})

describe('notes of one instrument never overlap', () => {
  it('cuts the earlier note when one is placed over it, once the gesture ends', () => {
    const { ed, song } = editor()
    ed.place(0, 72, 8)
    ed.begin()
    const n = ed.place(4, 72, 2)!
    expect(song.instruments[0].notes[0].length).toBe(8)
    ed.resize(n, 3)
    ed.end()
    expect(song.instruments[0].notes.map((x) => [x.step, x.length])).toEqual([[0, 4], [4, 3]])
  })

  it('keeps the note moved onto another', () => {
    const { ed, song } = editor()
    ed.place(0, 72, 2)
    const moved = ed.place(4, 74, 3)!
    ed.move([moved], new Map([[moved, { step: 4, pitch: 74 }]]), -4, -2)
    expect(song.instruments[0].notes.map((x) => [x.step, x.pitch, x.length])).toEqual([[0, 72, 3]])
  })
})

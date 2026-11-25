// The Music page's logic, without the DOM: the song open, its instruments, the tool, the
// notes selected, and every edit, undoable. The page draws it and turns pointers into these
// calls.
//
// A song has each instrument once (runtime/sound.ts). The notes of the selected instrument
// are the ones edited; the others are only shown. A drum (an instrument without a note) has
// no pitch: it is one row of hits, under the notes.
//
// Bars can be selected instead (dragged across in the ruler): a section of the song, every
// instrument at once. Copy, cut, paste, duplicate, delete and moves act on the whole section,
// and the song plays it in a loop. A section pasted or moved replaces what was there: the
// bars it lands on are its own, in every instrument.

import { accompany, type Voice } from './accompany'
import { History } from './history'
import { barSteps, HIGHEST, LOWEST, noteEnd, parseSong, songSteps, serializeSong, untangle, type Note, type Song, type Time } from '../../runtime/sound'

export type MusicTool = 'pencil' | 'eraser' | 'select'

/** The pitch a note gets when a drum's hits go to an instrument with notes. */
const MIDDLE = 72

export class MusicEditor {
  song: Song | null = null
  /** The song's name (songs/<name>.json). */
  name: string | null = null
  /** The selected instrument, by its place in the song: the one edited. */
  selected = 0
  tool: MusicTool = 'pencil'
  /** How long a note placed with the pencil lasts: the length last placed or set. */
  length = 4
  /** Notes of the selected instrument. */
  selection = new Set<Note>()
  /**
   * Bars selected, every instrument at once: from the first one's first step to the step after
   * the last one. The notes that start there are in it. Null: the notes of `selection` instead.
   */
  bars: Bars | null = null
  /**
   * What was copied: notes, their steps from the first one's, and whether they were a drum's;
   * or bars, each instrument's notes that started there, their steps from the first bar's.
   */
  clipboard: { drum: boolean; notes: Note[] } | { length: number; parts: { instrument: string; notes: Note[] }[] } | null = null
  /**
   * The flag: where playing starts, and where a paste goes, in steps. Always the start of a bar
   * (the first of the bars selected, if any): + and − at the right of its bar (of the bars
   * selected) add a bar after it and take them out.
   */
  start = 0
  /**
   * The instruments not heard when the song plays, to hear the others. Only for listening
   * while editing: not in the song, not undone, forgotten when another song opens.
   */
  muted = new Set<string>()
  /** Whether an instrument is a drum (it has no note). */
  isDrum: (instrument: string) => boolean = () => false
  /** The song changed: to save it. */
  onEdit: (name: string) => void = () => {}
  /** Each song's own undo: an undo never changes a song that is not shown. */
  private readonly histories = new Map<string, History<{ before: string; after: string }>>()
  /** The song before the gesture in progress (a drag is one change). */
  private before: string | null = null
  private listeners = new Set<() => void>()

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn()
  }

  open(name: string | null, song: Song | null) {
    this.name = name
    this.song = song
    this.selected = 0
    this.selection.clear()
    this.bars = null
    this.start = 0
    this.muted.clear()
    this.before = null
    this.emit()
  }

  get current() {
    return this.song?.instruments[this.selected] ?? null
  }

  /** Is the selected instrument a drum? */
  get drum() {
    const t = this.current
    return !!t && this.isDrum(t.instrument)
  }

  select(i: number) {
    if (!this.song || i < 0 || i >= this.song.instruments.length || i === this.selected) return
    this.selected = i
    this.selection.clear()
    this.emit()
  }

  setTool(tool: MusicTool) {
    this.tool = tool
    // The pencil selects too (a click on a note): only the eraser has nothing to do with a selection.
    if (tool === 'eraser') this.selection.clear()
    this.emit()
  }

  // --- Changes --------------------------------------------------------------

  /** Starts a change made of several steps (a drag): undone at once. */
  begin() {
    if (this.song && this.before === null) this.before = serializeSong(this.song)
  }

  /** Ends it: one step of undo, saved, if the song changed. */
  end() {
    const before = this.before
    this.before = null
    if (!this.song || !this.name || before === null) return
    // An instrument never covers itself (runtime/sound.ts): settled once the change is done,
    // so a note dragged over another does not cut it on the way.
    for (const p of this.song.instruments) untangle(p.notes)
    for (const n of [...this.selection]) if (!this.current?.notes.includes(n)) this.selection.delete(n)
    const after = serializeSong(this.song)
    if (after !== before) {
      if (!this.histories.has(this.name)) this.histories.set(this.name, new History())
      this.histories.get(this.name)!.push({ before, after })
      this.onEdit(this.name)
    }
    this.emit()
  }

  /** A change in one go. */
  edit(fn: (song: Song) => void) {
    if (!this.song) return
    const open = this.before !== null
    this.begin()
    fn(this.song)
    if (!open) this.end()
    else this.emit()
  }

  undo() {
    if (this.name) this.travel(this.histories.get(this.name)?.undo() ?? null, 'before')
  }

  redo() {
    if (this.name) this.travel(this.histories.get(this.name)?.redo() ?? null, 'after')
  }

  private travel(change: { before: string; after: string } | null, side: 'before' | 'after') {
    if (!change || !this.song || !this.name) return
    const restored = parseSong(change[side])
    this.song.tempo = restored.tempo
    this.song.time = restored.time
    this.song.instruments = restored.instruments
    this.selected = Math.min(this.selected, Math.max(0, this.song.instruments.length - 1))
    this.selection.clear()
    this.onEdit(this.name)
    this.emit()
  }

  /** Forgets the undo of a deleted song. */
  forget(name: string) {
    this.histories.delete(name)
  }

  renamed(from: string, to: string) {
    const h = this.histories.get(from)
    this.histories.delete(from)
    if (h) this.histories.set(to, h)
    if (this.name === from) this.name = to
  }

  // --- Instruments ----------------------------------------------------------

  /** Whether the song has this instrument already: it can't have it twice. */
  has(instrument: string) {
    return !!this.song?.instruments.some((p) => p.instrument === instrument)
  }

  toggleMute(instrument: string) {
    if (!this.muted.delete(instrument)) this.muted.add(instrument)
    this.emit()
  }

  /** Adds an instrument to the song, selected; one it has already is only selected. */
  addInstrument(instrument: string) {
    if (!this.song) return
    if (!this.has(instrument)) this.edit((s) => s.instruments.push({ instrument, notes: [] }))
    this.select(this.song.instruments.findIndex((p) => p.instrument === instrument))
  }

  removeInstrument(i: number) {
    // Muted no more: added back, it is heard.
    const name = this.song?.instruments[i]?.instrument
    if (name) this.muted.delete(name)
    this.edit((s) => s.instruments.splice(i, 1))
    if (!this.song) return
    if (this.selected >= this.song.instruments.length) this.selected = Math.max(0, this.song.instruments.length - 1)
    this.selection.clear()
    this.emit()
  }

  /** Plays the notes of an instrument with another one, that the song doesn't have yet. Going
   *  from a drum to notes or back, they become hits on one row, or notes on the middle of the
   *  grid. */
  replaceInstrument(i: number, instrument: string) {
    if (this.has(instrument)) return
    this.edit((s) => {
      const t = s.instruments[i]
      if (!t) return
      const wasDrum = this.isDrum(t.instrument)
      const drum = this.isDrum(instrument)
      t.instrument = instrument
      if (wasDrum === drum) return
      for (const n of t.notes) {
        n.pitch = drum ? null : MIDDLE
        n.length = drum ? 1 : Math.max(1, this.length)
      }
    })
    this.selection.clear()
  }

  setTempo(tempo: number) {
    this.edit((s) => (s.tempo = tempo))
  }

  /** Changes how the song is counted: its bars and beats. The notes stay where they are. */
  setTime(time: Time) {
    this.edit((s) => (s.time = time))
  }

  /**
   * Writes chords for the instrument at `i` under what the others play (accompany.ts): its
   * notes are replaced, one undo, and it is selected. Says whether there was anything to accompany.
   */
  accompany(i: number, voice: Voice) {
    const song = this.song
    if (!song || !song.instruments[i] || this.isDrum(song.instruments[i].instrument)) return false
    const notes = accompany(song, i, voice, this.isDrum)
    if (!notes.length) return false
    this.edit((s) => (s.instruments[i].notes = notes))
    this.selected = i
    this.selection.clear()
    this.emit()
    return true
  }

  // --- Singing --------------------------------------------------------------

  /**
   * A take sung into the selected instrument over the steps from..to: it replaces what was there
   * (singing a passage again is how it is fixed), and a note that started earlier and still
   * sounds at `from` stops there. One undo. The notes sung come selected, to be moved as one
   * if they landed a little off.
   */
  sing(notes: Note[], from: number, to: number) {
    const t = this.current
    if (!t) return
    this.begin()
    const kept: Note[] = []
    for (const n of t.notes) {
      if (n.step >= from && n.step < to) continue
      const copy = { ...n }
      if (copy.step < from && noteEnd(copy) > from) copy.length = from - copy.step
      kept.push(copy)
    }
    const sung = notes.map((n) => ({ ...n }))
    t.notes = [...kept, ...sung]
    this.tool = 'select'
    this.selection = new Set(sung)
    this.end()
  }

  // --- Notes ----------------------------------------------------------------

  /** The note of an instrument (the selected one) over a cell (a drum: its hit at that step). */
  noteAt(step: number, pitch: number | null, part = this.selected): Note | null {
    const t = this.song?.instruments[part]
    if (!t) return null
    const drum = this.isDrum(t.instrument)
    // The last one drawn is on top.
    for (let i = t.notes.length - 1; i >= 0; i--) {
      const n = t.notes[i]
      if (drum ? n.step === step : n.pitch === pitch && n.step <= step && step < noteEnd(n)) return n
    }
    return null
  }

  /** Places a note of the selected instrument (a hit, on a drum) and returns it. */
  place(step: number, pitch: number | null, length = this.length): Note | null {
    const t = this.current
    if (!t || step < 0) return null
    const note: Note = this.drum ? { step, pitch: null, length: 1 } : { step, pitch: clampPitch(pitch ?? MIDDLE), length: Math.max(1, length) }
    this.edit(() => t.notes.push(note))
    return note
  }

  /** A hit on a drum's row: placed, or taken away if there is one. */
  toggleHit(part: number, step: number) {
    const t = this.song?.instruments[part]
    if (!t || step < 0) return
    const hit = this.noteAt(step, null, part)
    this.edit(() => {
      if (hit) t.notes.splice(t.notes.indexOf(hit), 1)
      else t.notes.push({ step, pitch: null, length: 1 })
    })
  }

  remove(notes: Iterable<Note>, part = this.selected) {
    const t = this.song?.instruments[part]
    if (!t) return
    const gone = new Set(notes)
    if (!gone.size) return
    this.edit(() => (t.notes = t.notes.filter((n) => !gone.has(n))))
    for (const n of gone) this.selection.delete(n)
  }

  /** Moves notes, kept on the grid: from step 0, between the lowest and highest pitch. */
  move(notes: Note[], from: Map<Note, { step: number; pitch: number | null }>, dStep: number, dPitch: number) {
    let ds = dStep
    let dp = dPitch
    for (const n of notes) {
      const f = from.get(n)!
      ds = Math.max(ds, -f.step)
      if (f.pitch !== null) dp = Math.max(LOWEST - f.pitch, Math.min(HIGHEST - f.pitch, dp))
    }
    this.edit(() => {
      for (const n of notes) {
        const f = from.get(n)!
        n.step = f.step + ds
        if (f.pitch !== null) n.pitch = f.pitch + dp
      }
      // Last in the list: dropped on another note, the one moved is the one kept.
      const t = this.current
      if (t) {
        const moved = new Set(notes)
        t.notes = [...t.notes.filter((n) => !moved.has(n)), ...t.notes.filter((n) => moved.has(n))]
      }
    })
  }

  resize(note: Note, length: number) {
    const l = Math.max(1, Math.round(length))
    this.length = l
    if (note.length !== l) this.edit(() => (note.length = l))
  }

  /** Selects the notes of the selected instrument in a range of steps and pitches (any pitch on a drum). */
  selectRange(s0: number, s1: number, p0: number | null, p1: number | null) {
    const t = this.current
    this.selection.clear()
    this.bars = null
    if (!t) return this.emit()
    const [a, b] = [Math.min(s0, s1), Math.max(s0, s1)]
    for (const n of t.notes) {
      const inTime = n.step <= b && noteEnd(n) > a
      const inPitch = n.pitch === null || p0 === null || p1 === null || (n.pitch >= Math.min(p0, p1) && n.pitch <= Math.max(p0, p1))
      if (inTime && inPitch) this.selection.add(n)
    }
    this.emit()
  }

  /**
   * A click on a note: it becomes the selection, unless it is already in it (to drag them all);
   * with add (⇧), it joins the selection or leaves it. Says whether it ends up selected.
   */
  pick(note: Note, add = false) {
    this.bars = null
    if (add) {
      if (this.selection.has(note)) this.selection.delete(note)
      else this.selection.add(note)
    } else if (!this.selection.has(note)) this.selection = new Set([note])
    this.emit()
    return this.selection.has(note)
  }

  selectAll() {
    this.bars = null
    this.selection = new Set(this.current?.notes ?? [])
    this.emit()
  }

  deselect() {
    if (!this.selection.size && !this.bars) return
    this.selection.clear()
    this.bars = null
    this.emit()
  }

  deleteSelection() {
    const b = this.bars
    if (b) return this.edit((s) => s.instruments.forEach((t) => (t.notes = t.notes.filter((n) => !within(n, b)))))
    this.remove([...this.selection])
  }

  copy() {
    const b = this.bars
    if (b && this.song) {
      this.clipboard = {
        length: b.to - b.from,
        parts: this.song.instruments.map((t) => ({ instrument: t.instrument, notes: t.notes.filter((n) => within(n, b)).map((n) => ({ ...n, step: n.step - b.from })) })),
      }
      this.emit()
      return true
    }
    if (!this.selection.size) return false
    const notes = [...this.selection]
    const first = Math.min(...notes.map((n) => n.step))
    this.clipboard = { drum: this.drum, notes: notes.map((n) => ({ ...n, step: n.step - first })) }
    this.emit()
    return true
  }

  cut() {
    if (this.copy()) this.deleteSelection()
  }

  /** Pastes at `at` (where playing starts), into the selected instrument: the pasted notes are selected. */
  paste(at = this.start) {
    const t = this.current
    const c = this.clipboard
    if (!t || !c) return
    if ('parts' in c) return this.pasteBars(c, at)
    this.bars = null
    const drum = this.drum
    const notes = c.notes.map((n) => ({ step: n.step + at, pitch: drum ? null : (n.pitch ?? MIDDLE), length: drum ? 1 : n.length }))
    this.edit(() => t.notes.push(...notes))
    this.selection = new Set(notes)
    this.tool = 'select'
    this.emit()
  }

  /** Copies the selection right after itself. */
  duplicate() {
    const b = this.bars
    if (b) {
      this.begin()
      this.moveBars(b, b.to - b.from, true)
      return this.end()
    }
    if (!this.selection.size) return
    const notes = [...this.selection]
    const first = Math.min(...notes.map((n) => n.step))
    const end = Math.max(...notes.map(noteEnd))
    this.copy()
    this.paste(first + (end - first))
  }

  // --- Bars -----------------------------------------------------------------

  /** Selects the bars from the one at step a to the one at step b (either way), up to the song's end. */
  selectBars(a: number, b: number) {
    const song = this.song
    if (!song) return
    const bar = barSteps(song)
    const last = songSteps(song) / bar - 1
    const first = Math.max(0, Math.min(last, Math.floor(Math.min(a, b) / bar)))
    const end = Math.max(first, Math.min(last, Math.floor(Math.max(a, b) / bar)))
    this.selection.clear()
    this.bars = { from: first * bar, to: (end + 1) * bar }
    this.start = this.bars.from
    this.emit()
  }

  /**
   * Moves the bars `from` by `by` steps (a copy of them, with copy), in every instrument: the
   * bars they land on are replaced. Inside a gesture (begin), it starts again from the song as
   * it was then, so a drag can go back and forth. They stay selected where they land.
   */
  moveBars(from: Bars, by: number, copy = false) {
    if (!this.song) return
    const d = Math.max(-from.from, by)
    const to: Bars = { from: from.from + d, to: from.to + d }
    this.edit((s) => {
      if (this.before !== null) s.instruments = parseSong(this.before).instruments
      for (const t of s.instruments) {
        const moved = t.notes.filter((n) => within(n, from)).map((n) => ({ ...n, step: n.step + d }))
        t.notes = t.notes.filter((n) => !within(n, to) && (copy || !within(n, from))).concat(moved)
      }
    })
    this.bars = to
    this.start = to.from
    this.emit()
  }

  /** The bars + and − act on: the ones selected, or the flag's. */
  private get barsAt(): Bars | null {
    if (!this.song) return null
    if (this.bars) return this.bars
    const bar = barSteps(this.song)
    const from = Math.floor(this.start / bar) * bar
    return { from, to: from + bar }
  }

  /**
   * + : one empty bar right after the flag's bar (after the bars selected): everything from
   * there moves right, in every instrument. A note still sounding there keeps its length.
   */
  addBar() {
    const b = this.barsAt
    if (!b || !this.song) return
    const by = barSteps(this.song)
    this.edit((s) => s.instruments.forEach((t) => t.notes.forEach((n) => n.step >= b.to && (n.step += by))))
    this.emit()
  }

  /** − : takes the flag's bar (the bars selected) out of the song: what came after moves left, into its place. */
  removeBars() {
    const b = this.barsAt
    if (!b || !this.song) return
    const by = b.to - b.from
    this.edit((s) => {
      for (const t of s.instruments) {
        t.notes = t.notes.filter((n) => !within(n, b))
        for (const n of t.notes) if (n.step >= b.to) n.step -= by
      }
    })
    this.bars = null
    // The flag stays where it was (on the bar that came next), within the song.
    this.start = Math.min(b.from, Math.max(0, songSteps(this.song) - barSteps(this.song)))
    this.emit()
  }

  /** Bars copied, at `at`: in each instrument of the song they were copied from, replacing what was there. */
  private pasteBars(c: { length: number; parts: { instrument: string; notes: Note[] }[] }, at: number) {
    const to: Bars = { from: at, to: at + c.length }
    this.edit((s) => {
      for (const t of s.instruments) {
        const part = c.parts.find((p) => p.instrument === t.instrument)
        if (!part) continue
        t.notes = t.notes.filter((n) => !within(n, to)).concat(part.notes.map((n) => ({ ...n, step: n.step + at })))
      }
    })
    this.selection.clear()
    this.bars = to
    this.start = to.from
    this.emit()
  }
}

/** Bars, in steps: from the first one's first step to the step after the last one. */
export type Bars = { from: number; to: number }

const within = (n: Note, b: Bars) => n.step >= b.from && n.step < b.to

const clampPitch = (p: number) => Math.max(LOWEST, Math.min(HIGHEST, Math.round(p)))

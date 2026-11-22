// The Music page's logic, without the DOM: the song open, its tracks, the tool, the notes
// selected, and every edit, undoable. The page draws it and turns pointers into these calls.
//
// A track is one instrument. The notes of the selected track are the ones edited; the
// others are only shown. A drum (an instrument without a note) has no pitch: its track is
// one row of hits, under the notes.

import { History } from './history'
import { HIGHEST, LOWEST, noteEnd, parseSong, serializeSong, untangle, type Note, type Song, type Time } from '../../runtime/sound'

export type MusicTool = 'pencil' | 'eraser' | 'select'

/** The pitch a note gets when its track changes from a drum to an instrument with notes. */
const MIDDLE = 72

export class MusicEditor {
  song: Song | null = null
  /** The song's name (songs/<name>.json). */
  name: string | null = null
  /** The selected track: the one edited. */
  track = 0
  tool: MusicTool = 'pencil'
  /** How long a note placed with the pencil lasts: the length last placed or set. */
  length = 4
  /** Notes of the selected track. */
  selection = new Set<Note>()
  /** Copied notes, their steps from the first one's, with the track they came from. */
  clipboard: { drum: boolean; notes: Note[] } | null = null
  /** Where playing starts, and where a paste goes, in steps. */
  start = 0
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
    this.track = 0
    this.selection.clear()
    this.start = 0
    this.before = null
    this.emit()
  }

  get current() {
    return this.song?.tracks[this.track] ?? null
  }

  /** Is the selected track a drum? */
  get drum() {
    const t = this.current
    return !!t && this.isDrum(t.instrument)
  }

  selectTrack(i: number) {
    if (!this.song || i < 0 || i >= this.song.tracks.length || i === this.track) return
    this.track = i
    this.selection.clear()
    this.emit()
  }

  setTool(tool: MusicTool) {
    this.tool = tool
    if (tool !== 'select') this.selection.clear()
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
    // A track never covers itself (runtime/sound.ts): settled once the change is done, so a
    // note dragged over another does not cut it on the way.
    for (const t of this.song.tracks) untangle(t.notes)
    for (const n of [...this.selection]) if (!this.song.tracks[this.track]?.notes.includes(n)) this.selection.delete(n)
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
    this.song.tracks = restored.tracks
    this.track = Math.min(this.track, Math.max(0, this.song.tracks.length - 1))
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

  // --- Tracks ---------------------------------------------------------------

  addTrack(instrument: string) {
    this.edit((s) => s.tracks.push({ instrument, notes: [] }))
    if (this.song) this.selectTrack(this.song.tracks.length - 1)
  }

  removeTrack(i: number) {
    this.edit((s) => s.tracks.splice(i, 1))
    if (!this.song) return
    if (this.track >= this.song.tracks.length) this.track = Math.max(0, this.song.tracks.length - 1)
    this.selection.clear()
    this.emit()
  }

  /** Plays the track with another instrument. Going from a drum to notes or back, its notes
   *  become hits on one row, or notes on the middle of the grid. */
  setInstrument(i: number, instrument: string) {
    this.edit((s) => {
      const t = s.tracks[i]
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

  // --- Singing --------------------------------------------------------------

  /**
   * A take sung into the selected track over the steps from..to: it replaces what was there
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

  /** The note of the selected track over a cell (a drum: its hit at that step). */
  noteAt(step: number, pitch: number | null, track = this.track): Note | null {
    const t = this.song?.tracks[track]
    if (!t) return null
    const drum = this.isDrum(t.instrument)
    // The last one drawn is on top.
    for (let i = t.notes.length - 1; i >= 0; i--) {
      const n = t.notes[i]
      if (drum ? n.step === step : n.pitch === pitch && n.step <= step && step < noteEnd(n)) return n
    }
    return null
  }

  /** Places a note on the selected track (a hit, on a drum) and returns it. */
  place(step: number, pitch: number | null, length = this.length): Note | null {
    const t = this.current
    if (!t || step < 0) return null
    const note: Note = this.drum ? { step, pitch: null, length: 1 } : { step, pitch: clampPitch(pitch ?? MIDDLE), length: Math.max(1, length) }
    this.edit(() => t.notes.push(note))
    return note
  }

  /** A hit on a drum track's row: placed, or taken away if there is one. */
  toggleHit(track: number, step: number) {
    const t = this.song?.tracks[track]
    if (!t || step < 0) return
    const hit = this.noteAt(step, null, track)
    this.edit(() => {
      if (hit) t.notes.splice(t.notes.indexOf(hit), 1)
      else t.notes.push({ step, pitch: null, length: 1 })
    })
  }

  remove(notes: Iterable<Note>, track = this.track) {
    const t = this.song?.tracks[track]
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
      // Last in the track: dropped on another note, the one moved is the one kept.
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

  /** Selects the notes of the selected track in a range of steps and pitches (any pitch on a drum). */
  selectRange(s0: number, s1: number, p0: number | null, p1: number | null) {
    const t = this.current
    this.selection.clear()
    if (!t) return this.emit()
    const [a, b] = [Math.min(s0, s1), Math.max(s0, s1)]
    for (const n of t.notes) {
      const inTime = n.step <= b && noteEnd(n) > a
      const inPitch = n.pitch === null || p0 === null || p1 === null || (n.pitch >= Math.min(p0, p1) && n.pitch <= Math.max(p0, p1))
      if (inTime && inPitch) this.selection.add(n)
    }
    this.emit()
  }

  selectAll() {
    this.selection = new Set(this.current?.notes ?? [])
    this.emit()
  }

  deselect() {
    if (!this.selection.size) return
    this.selection.clear()
    this.emit()
  }

  deleteSelection() {
    this.remove([...this.selection])
  }

  copy() {
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

  /** Pastes at `at` (where playing starts), into the selected track: the pasted notes are selected. */
  paste(at = this.start) {
    const t = this.current
    const c = this.clipboard
    if (!t || !c) return
    const drum = this.drum
    const notes = c.notes.map((n) => ({ step: n.step + at, pitch: drum ? null : (n.pitch ?? MIDDLE), length: drum ? 1 : n.length }))
    this.edit(() => t.notes.push(...notes))
    this.selection = new Set(notes)
    this.tool = 'select'
    this.emit()
  }

  /** Copies the selection right after itself. */
  duplicate() {
    if (!this.selection.size) return
    const notes = [...this.selection]
    const first = Math.min(...notes.map((n) => n.step))
    const end = Math.max(...notes.map(noteEnd))
    this.copy()
    this.paste(first + (end - first))
  }
}

const clampPitch = (p: number) => Math.max(LOWEST, Math.min(HIGHEST, Math.round(p)))

// The Sounds page's logic, without the DOM: the sound open, the tool, strokes on its grid,
// its settings, and every edit, undoable. The page draws it and turns
// pointers into these calls.
//
// A game has only its own sounds (sounds/<name>.json). The presets (editor/sounds/) are
// starting points: a new sound is a copy of one, or empty.

import { History } from './history'
import {
  COLUMNS,
  ECHOES,
  GRITS,
  LOUDEST,
  RINGS,
  ROWS,
  SPEEDS,
  TEXTURES,
  emptySound,
  parseSound,
  serializeSound,
  type Sound,
} from '../../runtime/sfx'

/** Pencil places pitch pixels, volume sets how loud each column is, eraser removes pixels. */
export type SoundTool = 'pencil' | 'volume' | 'eraser'

/** The settings, which apply to the whole sound. */
export type Setting = 'texture' | 'speed' | 'grit' | 'glide' | 'echo' | 'ring' | 'level'

/** A random sound: a short run going up or down, an arpeggio or a zigzag, fading out. */
export function randomSound(random = Math.random): Sound {
  const R = (n: number) => Math.floor(random() * n)
  const s = emptySound()
  const L = 2 + R(12), type = R(4), dir = random() < 0.5 ? 1 : -1
  const start = dir > 0 ? 3 + R(10) : 10 + R(14), stp = 1 + R(2), hold = R(Math.ceil(L / 2)), gap = type === 2 && random() < 0.5
  for (let i = 0; i < L; i++) {
    let r: number
    if (type < 2) r = start + dir * i * stp
    else if (type === 2) r = start + (i % 3) * 2 + Math.floor(i / 3) * (dir > 0 ? 2 : 0)
    else r = start + (i % 2 ? 3 : 0) + dir * i
    const c = gap ? i * 2 : i
    if (c >= COLUMNS) break
    s.pitch[c] = Math.max(0, Math.min(ROWS - 1, r))
    s.volume[c] = i < hold ? LOUDEST : Math.max(3, Math.round(LOUDEST - ((i - hold + 1) * 18) / Math.max(1, L - hold)))
  }
  s.texture = TEXTURES[R(TEXTURES.length)]
  s.speed = SPEEDS[[0, 1, 1, 2, 3][R(5)]]
  s.glide = random() < 0.45
  s.echo = random() < 0.4 ? ECHOES[1 + R(4)] : 'off'
  s.grit = GRITS[R(3)]
  s.ring = RINGS[R(5)]
  return s
}

export class SoundEditor {
  /** The sound open, and its name (sounds/<name>.json). */
  sound: Sound | null = null
  name: string | null = null
  tool: SoundTool = 'pencil'
  /** The sound changed: to save it. */
  onEdit: (name: string) => void = () => {}
  /** A pixel was placed, or its volume set: to hear it. */
  onPlace: (row: number, volume: number) => void = () => {}
  private readonly histories = new Map<string, History<{ before: string; after: string }>>()
  /** The sound before the change in progress (a stroke is one change). */
  private before: string | null = null
  /** The stroke in progress: erasing or not, and the last cell it went through. */
  private stroke: { erase: boolean; volume: boolean; col: number; row: number } | null = null
  private listeners = new Set<() => void>()

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn()
  }

  open(name: string | null, sound: Sound | null) {
    this.name = name
    this.sound = sound
    this.before = null
    this.stroke = null
    this.emit()
  }

  setTool(tool: SoundTool) {
    this.tool = tool
    this.emit()
  }

  // --- Changes --------------------------------------------------------------

  private begin() {
    if (this.sound && this.before === null) this.before = serializeSound(this.sound)
  }

  /** Ends a change: one step of undo, saved, if the sound changed. */
  private end() {
    const before = this.before
    this.before = null
    if (!this.sound || !this.name || before === null) return this.emit()
    const after = serializeSound(this.sound)
    if (after !== before) {
      if (!this.histories.has(this.name)) this.histories.set(this.name, new History())
      this.histories.get(this.name)!.push({ before, after })
      this.onEdit(this.name)
    }
    this.emit()
  }

  private edit(fn: (s: Sound) => void) {
    if (!this.sound) return
    this.begin()
    fn(this.sound)
    this.end()
  }

  undo() {
    if (this.name) this.travel(this.histories.get(this.name)?.undo() ?? null, 'before')
  }

  redo() {
    if (this.name) this.travel(this.histories.get(this.name)?.redo() ?? null, 'after')
  }

  private travel(change: { before: string; after: string } | null, side: 'before' | 'after') {
    if (!change || !this.sound || !this.name) return
    Object.assign(this.sound, parseSound(change[side]))
    this.onEdit(this.name)
    this.emit()
  }

  forget(name: string) {
    this.histories.delete(name)
  }

  renamed(from: string, to: string) {
    const h = this.histories.get(from)
    this.histories.delete(from)
    if (h) this.histories.set(to, h)
    if (this.name === from) this.name = to
  }

  // --- Strokes --------------------------------------------------------------

  /**
   * A pointer goes down on a cell (row 0 at the bottom). With the pencil, on a pixel already
   * there (or with `erase`, the right button) the stroke erases; with volume, the column's
   * volume goes to the row.
   */
  down(col: number, row: number, erase = false) {
    const s = this.sound
    if (!s) return
    this.begin()
    const volume = this.tool === 'volume'
    this.stroke = { erase: !volume && (erase || this.tool === 'eraser' || s.pitch[col] === row), volume, col, row }
    this.apply(col, row)
    this.emit()
  }

  /** The pointer moves to a cell: every column between the last one and it, on a line. */
  move(col: number, row: number) {
    const st = this.stroke
    if (!st || (col === st.col && row === st.row)) return
    const n = Math.abs(col - st.col)
    if (!n) this.apply(col, row)
    else for (let k = 1; k <= n; k++) this.apply(st.col + Math.sign(col - st.col) * k, Math.round(st.row + ((row - st.row) * k) / n))
    st.col = col
    st.row = row
    this.emit()
  }

  up() {
    if (!this.stroke) return
    this.stroke = null
    this.end()
  }

  private apply(col: number, row: number) {
    const s = this.sound!, st = this.stroke!
    col = Math.max(0, Math.min(COLUMNS - 1, col))
    row = Math.max(0, Math.min(ROWS - 1, row))
    if (st.volume) {
      if (s.volume[col] === row) return
      s.volume[col] = row
      if (s.pitch[col] !== null) this.onPlace(s.pitch[col]!, row)
    } else if (st.erase) s.pitch[col] = null
    else if (s.pitch[col] !== row) {
      s.pitch[col] = row
      this.onPlace(row, s.volume[col])
    }
  }

  // --- The whole sound ------------------------------------------------------

  set<K extends Setting>(key: K, value: Sound[K]) {
    if (this.sound?.[key] === value) return
    this.edit((s) => (s[key] = value))
  }

  /** Takes the pixels away, keeping the settings. */
  clear() {
    this.edit((s) => {
      s.pitch.fill(null)
      s.volume.fill(LOUDEST)
    })
  }

  /** Replaces the sound with another (a random one). */
  replace(next: Sound) {
    this.edit((s) => Object.assign(s, structuredClone(next)))
  }

}

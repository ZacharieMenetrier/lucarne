// Editor state and tool behavior, with no knowledge of the DOM.
// Incoming coordinates are in sprite pixels.

import {
  Bitmap,
  blit,
  clearRect,
  clipRect,
  constrainLine,
  drawRect,
  extract,
  flipH,
  flipV,
  floodFill,
  linePoints,
  rectContains,
  rectFromCorners,
  replaceColor,
  resized,
  type Point,
  type Rect,
} from './bitmap'
import { TRANSPARENT, colorToHex, hexToColor, type Color } from './color'
import { History } from './history'
import type { Sprite } from './sprite'

export type ToolId = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'rectFill' | 'select'

export interface PointerInput extends Point {
  shift: boolean
  alt: boolean
}

interface Floating {
  bmp: Bitmap
  x: number
  y: number
  /** Image before the selection was lifted, for undo. */
  before: Bitmap
}

type Drag =
  | { kind: 'paint'; before: Bitmap; last: Point }
  | { kind: 'shape'; start: Point }
  | { kind: 'select'; start: Point; moved: boolean }
  | { kind: 'move'; start: Point; origin: Point }
  | { kind: 'pick' }

export class Editor {
  sprite: Sprite | null = null
  tool: ToolId = 'pencil'
  color: Color
  /** Preview of a line or rectangle in progress. */
  overlay: Bitmap | null = null
  selection: Rect | null = null
  floating: Floating | null = null
  clipboard: Bitmap | null = null
  hover: Point | null = null

  /** Called when pixels changed (for saving). */
  onEdit: () => void = () => {}
  onMessage: (text: string) => void = () => {}

  private drag: Drag | null = null
  private histories = new Map<string, History>()
  private listeners = new Set<() => void>()

  constructor(public palette: string[]) {
    this.color = hexToColor(palette[0] ?? '#000000')
  }

  // -------------------------------------------------------------------------
  // Subscriptions

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn()
  }

  private edited() {
    this.onEdit()
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Current image

  get bmp(): Bitmap | null {
    return this.sprite?.frames[0][0] ?? null
  }

  private setBmp(bmp: Bitmap) {
    if (!this.sprite) return
    this.sprite.frames[0][0] = bmp
    this.sprite.meta.frameWidth = bmp.width
    this.sprite.meta.frameHeight = bmp.height
  }

  get history(): History | null {
    if (!this.sprite) return null
    let h = this.histories.get(this.sprite.name)
    if (!h) this.histories.set(this.sprite.name, (h = new History()))
    return h
  }

  renameHistory(from: string, to: string) {
    const h = this.histories.get(from)
    this.histories.delete(from)
    if (h) this.histories.set(to, h)
  }

  forgetHistory(name: string) {
    this.histories.delete(name)
  }

  setSprite(sprite: Sprite | null) {
    this.commitFloating()
    this.drag = null
    this.overlay = null
    this.selection = null
    this.sprite = sprite
    this.emit()
  }

  /** Copy of the sprite as it should be saved (floating selection included). */
  snapshot(): Sprite | null {
    if (!this.sprite) return null
    const frames = this.sprite.frames.map((row) => row.map((b) => b.clone()))
    if (this.floating) blit(frames[0][0], this.floating.bmp, this.floating.x, this.floating.y)
    return { name: this.sprite.name, meta: structuredClone(this.sprite.meta), frames }
  }

  // -------------------------------------------------------------------------
  // Tools and color

  setTool(tool: ToolId) {
    if (tool !== 'select') this.deselect()
    this.tool = tool
    this.emit()
  }

  setColor(color: Color) {
    this.color = color
    if (this.tool === 'eraser' || this.tool === 'picker' || this.tool === 'select') this.tool = 'pencil'
    this.emit()
  }

  setPalette(palette: string[]) {
    this.palette = palette
    this.emit()
  }

  private inPalette(c: Color) {
    const hex = colorToHex(c)
    return this.palette.some((p) => p === hex)
  }

  // -------------------------------------------------------------------------
  // Pointer

  down(p: PointerInput) {
    const bmp = this.bmp
    if (!bmp || this.drag) return
    switch (this.tool) {
      case 'pencil':
      case 'eraser':
        this.drag = { kind: 'paint', before: bmp.clone(), last: p }
        this.plot(p)
        break
      case 'fill': {
        const before = bmp.clone()
        if (floodFill(bmp, p.x, p.y, this.color)) this.commit(before)
        break
      }
      case 'picker':
        this.drag = { kind: 'pick' }
        this.pick(p)
        break
      case 'line':
      case 'rect':
      case 'rectFill':
        this.drag = { kind: 'shape', start: p }
        this.updateShape(p)
        break
      case 'select':
        this.selectDown(p)
        break
    }
    this.emit()
  }

  move(p: PointerInput) {
    this.hover = p
    const d = this.drag
    if (!d) return this.emit()
    switch (d.kind) {
      case 'paint':
        this.plot(p, d.last)
        d.last = p
        break
      case 'pick':
        this.pick(p)
        break
      case 'shape':
        this.updateShape(p)
        break
      case 'select':
        if (p.x !== d.start.x || p.y !== d.start.y) d.moved = true
        this.selection = this.clipToImage(rectFromCorners(d.start, p))
        break
      case 'move':
        if (this.floating) {
          this.floating.x = d.origin.x + p.x - d.start.x
          this.floating.y = d.origin.y + p.y - d.start.y
          this.selection = { x: this.floating.x, y: this.floating.y, w: this.floating.bmp.width, h: this.floating.bmp.height }
        }
        break
    }
    this.emit()
  }

  up(p: PointerInput) {
    const d = this.drag
    const bmp = this.bmp
    this.drag = null
    if (!d || !bmp) return
    switch (d.kind) {
      case 'paint':
        this.commit(d.before)
        break
      case 'shape':
        this.updateShape(p)
        if (this.overlay) {
          const before = bmp.clone()
          blit(bmp, this.overlay, 0, 0)
          this.overlay = null
          this.commit(before)
        }
        break
      case 'select':
        if (!d.moved) this.selection = null
        break
      case 'move':
        // Saving includes the floating selection at its new position.
        this.onEdit()
        break
    }
    this.emit()
  }

  leave() {
    this.hover = null
    this.emit()
  }

  private plot(p: Point, from?: Point) {
    const bmp = this.bmp!
    const c = this.tool === 'eraser' ? TRANSPARENT : this.color
    for (const q of from ? linePoints(from.x, from.y, p.x, p.y) : [p]) bmp.set(q.x, q.y, c)
  }

  private pick(p: Point) {
    const c = this.bmp!.get(p.x, p.y)
    if (c === TRANSPARENT || c === this.color) return
    if (this.inPalette(c)) this.color = c
    else this.onMessage(`${colorToHex(c)} is not in the palette`)
  }

  private updateShape(p: PointerInput) {
    const d = this.drag
    const bmp = this.bmp
    if (d?.kind !== 'shape' || !bmp) return
    const overlay = new Bitmap(bmp.width, bmp.height)
    if (this.tool === 'line') {
      const end = p.shift ? constrainLine(d.start.x, d.start.y, p.x, p.y) : p
      for (const q of linePoints(d.start.x, d.start.y, end.x, end.y)) overlay.set(q.x, q.y, this.color)
    } else {
      let end: Point = p
      if (p.shift) {
        // Square
        const s = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y))
        end = { x: d.start.x + Math.sign(p.x - d.start.x || 1) * s, y: d.start.y + Math.sign(p.y - d.start.y || 1) * s }
      }
      drawRect(overlay, rectFromCorners(d.start, end), this.color, this.tool === 'rectFill')
    }
    this.overlay = overlay
  }

  /** Records a change in the history. */
  private commit(before: Bitmap) {
    const bmp = this.bmp
    if (!bmp || before.equals(bmp)) return
    this.history!.push(before, bmp)
    this.edited()
  }

  // -------------------------------------------------------------------------
  // Selection

  private clipToImage(r: Rect) {
    const bmp = this.bmp!
    return clipRect(r, bmp.width, bmp.height)
  }

  private selectDown(p: PointerInput) {
    const f = this.floating
    if (f && rectContains({ x: f.x, y: f.y, w: f.bmp.width, h: f.bmp.height }, p)) {
      if (p.alt) this.stamp()
      this.drag = { kind: 'move', start: p, origin: { x: f.x, y: f.y } }
      return
    }
    if (!f && this.selection && rectContains(this.selection, p)) {
      this.lift(!p.alt)
      this.drag = { kind: 'move', start: p, origin: { x: this.floating!.x, y: this.floating!.y } }
      return
    }
    this.commitFloating()
    this.drag = { kind: 'select', start: p, moved: false }
    this.selection = this.clipToImage(rectFromCorners(p, p))
  }

  /** Lifts the selected pixels so they can be moved. */
  private lift(cut: boolean) {
    const bmp = this.bmp
    if (!bmp || !this.selection || this.floating) return
    const before = bmp.clone()
    const r = this.selection
    this.floating = { bmp: extract(bmp, r), x: r.x, y: r.y, before }
    if (cut) clearRect(bmp, r)
  }

  /** Stamps the floating selection in place without dropping it. */
  private stamp() {
    const bmp = this.bmp
    if (bmp && this.floating) blit(bmp, this.floating.bmp, this.floating.x, this.floating.y)
  }

  /** Drops the floating selection into the image. */
  commitFloating() {
    const bmp = this.bmp
    const f = this.floating
    if (!bmp || !f) return
    this.floating = null
    blit(bmp, f.bmp, f.x, f.y)
    this.selection = this.clipToImage({ x: f.x, y: f.y, w: f.bmp.width, h: f.bmp.height })
    this.commit(f.before)
  }

  deselect() {
    this.commitFloating()
    this.selection = null
    this.emit()
  }

  selectAll() {
    const bmp = this.bmp
    if (!bmp) return
    this.commitFloating()
    this.tool = 'select'
    this.selection = { x: 0, y: 0, w: bmp.width, h: bmp.height }
    this.emit()
  }

  duplicate() {
    if (!this.selection) return
    if (this.floating) this.stamp()
    else this.lift(false)
    this.emit()
  }

  flip(axis: 'h' | 'v') {
    const bmp = this.bmp
    if (!bmp) return
    if (!this.selection) {
      // No selection: the whole image.
      const before = bmp.clone()
      this.setBmp(axis === 'h' ? flipH(bmp) : flipV(bmp))
      return this.commit(before)
    }
    this.lift(true)
    const f = this.floating!
    f.bmp = axis === 'h' ? flipH(f.bmp) : flipV(f.bmp)
    this.edited()
  }

  deleteSelection() {
    const bmp = this.bmp
    if (!bmp) return
    if (this.floating) {
      const before = this.floating.before
      this.floating = null
      this.commit(before)
    } else if (this.selection) {
      const before = bmp.clone()
      clearRect(bmp, this.selection)
      this.commit(before)
    }
    this.emit()
  }

  copy() {
    const bmp = this.bmp
    if (!bmp) return
    if (this.floating) this.clipboard = this.floating.bmp.clone()
    else this.clipboard = extract(bmp, this.selection ?? { x: 0, y: 0, w: bmp.width, h: bmp.height })
    this.onMessage('Copied')
  }

  cut() {
    this.copy()
    if (!this.selection) this.selectAll()
    this.deleteSelection()
  }

  paste() {
    const bmp = this.bmp
    if (!bmp || !this.clipboard) return
    this.commitFloating()
    const x = this.selection?.x ?? 0
    const y = this.selection?.y ?? 0
    this.floating = { bmp: this.clipboard.clone(), x, y, before: bmp.clone() }
    this.selection = { x, y, w: this.clipboard.width, h: this.clipboard.height }
    this.tool = 'select'
    this.edited()
  }

  // -------------------------------------------------------------------------
  // History and transforms

  undo() {
    if (this.drag) return
    this.commitFloating()
    const bmp = this.history?.undo()
    if (bmp) this.restore(bmp)
  }

  redo() {
    if (this.drag) return
    this.commitFloating()
    const bmp = this.history?.redo()
    if (bmp) this.restore(bmp)
  }

  private restore(bmp: Bitmap) {
    this.selection = null
    this.setBmp(bmp)
    this.edited()
  }

  /** Resizes the image; the old image is placed at (ox, oy). */
  resize(w: number, h: number, ox: number, oy: number) {
    const bmp = this.bmp
    if (!bmp) return
    this.commitFloating()
    this.selection = null
    const before = bmp.clone()
    this.setBmp(resized(bmp, w, h, ox, oy))
    this.commit(before)
  }

  /** Replaces a color in the current image (undoable). */
  replaceColor(from: Color, to: Color) {
    const bmp = this.bmp
    if (!bmp) return
    this.commitFloating()
    const before = bmp.clone()
    if (replaceColor(bmp, from, to)) this.commit(before)
  }
}

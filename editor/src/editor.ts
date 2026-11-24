// Editor state and tool behavior, with no knowledge of the DOM.
//
// Every sprite of the game sits on one board. Pointer coordinates are board
// coordinates, in sprite pixels; a press acts on the sprite under it, which
// becomes the active one. Undo covers the whole board.

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
import { boundsOf, findFreeSpot, overlaps, resizeRect, resolveOverlaps, type BoardFile, type Corner, type Placements } from './board'
import { TRANSPARENT, colorToHex, hexToColor, type Color } from './color'
import { History } from './history'
import { MAX_SIZE, isFont, isStill, isTileset, sortTileBoxes, type Sprite, type TileBox } from './sprite'
import { FONT_COLUMNS, FONT_ROWS } from '../../runtime/fonts'
import { relayoutFont } from './font'

export const MIN_FPS = 2
export const MAX_FPS = 24

export type ToolId = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'rectFill' | 'select' | 'move' | 'origin' | 'box'

export type { Corner }

export interface PointerInput extends Point {
  shift: boolean
  alt: boolean
}

/** A sprite and its position on the board. */
export interface Placed {
  sprite: Sprite
  x: number
  y: number
  /** Animation frame being edited. */
  frame: number
}

/** Frame list of a sprite, for undoing changes to its structure. */
interface FrameState {
  frames: Bitmap[]
  durations: number[]
  frame: number
}

interface Floating {
  bmp: Bitmap
  x: number
  y: number
  /** Image before the selection was lifted, for undo. */
  before: Bitmap
}

/** One undoable change. Pixel changes are for frame f of a sprite. */
type Change =
  | { kind: 'pixels'; name: string; f: number; before: Bitmap; after: Bitmap }
  | { kind: 'place'; name: string; from: Point; to: Point }
  | { kind: 'frames'; name: string; before: FrameState; after: FrameState }
  | { kind: 'origin'; name: string; before: Point | null; after: Point | null }
  | { kind: 'solid'; name: string; before: TileBox[]; after: TileBox[] }
  | { kind: 'group'; items: Change[] }

// Drag points are local to the active sprite, except 'place' (board).
type Drag =
  | { kind: 'paint'; before: Bitmap; last: Point }
  | { kind: 'shape'; start: Point }
  | { kind: 'select'; start: Point; moved: boolean }
  | { kind: 'float'; start: Point; origin: Point }
  | { kind: 'pick' }
  | { kind: 'origin'; before: Point | null }
  | { kind: 'box'; before: TileBox[]; column: number; row: number; start: Point; moved: boolean }
  | { kind: 'place'; name: string; start: Point; origin: Point }
  | { kind: 'resize'; name: string; corner: Corner; start: Point; origin: Rect; frames: Bitmap[]; rect: Rect }

export class Editor {
  readonly sprites = new Map<string, Placed>()
  active: string | null = null
  tool: ToolId = 'pencil'
  color: Color
  /** Preview of a line or rectangle in progress (active sprite). */
  overlay: Bitmap | null = null
  selection: Rect | null = null
  floating: Floating | null = null
  clipboard: Bitmap | null = null
  /** Pointer position on the board. */
  hover: Point | null = null
  /** Board color for this game, "#rrggbb", or null for the default. */
  background: string | null = null
  /** Rows the palette is laid out in (saved in board.json), null: default. */
  paletteRows: number | null = null
  /** The game's tile size: tilesets are whole tiles of it. */
  tileSize = 16
  /** The active sprite is playing its animation on the board. */
  playing = false
  playIndex = 0

  /** A sprite's pixels changed (to save it). */
  onEdit: (name: string) => void = () => {}
  /** A sprite moved, or the board color changed (to save board.json). */
  onMoved: () => void = () => {}
  /** Undo touched a sprite that may be off screen. */
  onReveal: (name: string) => void = () => {}
  onMessage: (text: string) => void = () => {}

  private drag: Drag | null = null
  private playTimer: ReturnType<typeof setTimeout> | undefined
  private history = new History<Change>()
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

  // -------------------------------------------------------------------------
  // Board

  get placed(): Placed | null {
    return (this.active && this.sprites.get(this.active)) || null
  }

  get sprite(): Sprite | null {
    return this.placed?.sprite ?? null
  }

  /** Image being edited: the current frame of the active sprite. */
  get bmp(): Bitmap | null {
    const pl = this.placed
    return pl?.sprite.frames[pl.frame] ?? null
  }

  /** Index of the frame being edited. */
  get frame(): number {
    return this.placed?.frame ?? 0
  }

  /** Image to show for a sprite: the playing frame, else the one being edited. */
  shownFrame(name: string): Bitmap {
    const pl = this.sprites.get(name)!
    const f = this.playing && name === this.active ? this.playIndex : pl.frame
    return pl.sprite.frames[f] ?? pl.sprite.frames[0]
  }

  get dragging() {
    return this.drag !== null
  }

  get canUndo() {
    return this.history.canUndo || this.floating !== null
  }

  get canRedo() {
    return this.history.canRedo
  }

  rectOf(name: string): Rect | null {
    const pl = this.sprites.get(name)
    if (!pl) return null
    const b = pl.sprite.frames[0]
    return { x: pl.x, y: pl.y, w: b.width, h: b.height }
  }

  bounds(): Rect | null {
    return boundsOf([...this.sprites.keys()].map((n) => this.rectOf(n)!))
  }

  /** Names in drawing order: alphabetical, active sprite last (on top). */
  drawOrder(): string[] {
    const names = [...this.sprites.keys()].sort()
    if (this.active) {
      names.splice(names.indexOf(this.active), 1)
      names.push(this.active)
    }
    return names
  }

  /** Sprite under a board point (the topmost one). */
  hitTest(p: Point): string | null {
    const order = this.drawOrder()
    for (let i = order.length - 1; i >= 0; i--) {
      if (rectContains(this.rectOf(order[i])!, p)) return order[i]
    }
    return null
  }

  /** Footprints of every sprite but one. */
  private othersThan(name: string): Rect[] {
    return [...this.sprites.keys()].filter((n) => n !== name).map((n) => this.rectOf(n)!)
  }

  /** Corner being dragged to resize a sprite, if any. */
  get resizeCorner(): Corner | null {
    return this.drag?.kind === 'resize' ? this.drag.corner : null
  }

  /** True while a sprite being moved sits on another one (it will be pushed aside). */
  get placeBlocked(): boolean {
    const d = this.drag
    if (d?.kind !== 'place') return false
    const r = this.rectOf(d.name)!
    return this.othersThan(d.name).some((o) => overlaps(r, o))
  }

  /** Separates sprites that overlap (board.json edited by hand, older boards).
   * Not undoable. Returns true if anything moved. */
  untangle(): boolean {
    const names = [...this.sprites.keys()].sort()
    const moved = resolveOverlaps([], names.map((name) => ({ name, rect: this.rectOf(name)! })))
    for (const [name, p] of moved) this.sprites.get(name)!.x = p.x, this.sprites.get(name)!.y = p.y
    if (moved.size) this.emit()
    return moved.size > 0
  }

  /** Changes the board color (not undoable: it is a display setting). */
  setBackground(hex: string | null) {
    if (hex === this.background) return
    this.background = hex
    this.onMoved()
    this.emit()
  }

  /** What board.json should contain. */
  boardFile(): BoardFile {
    return { placements: this.placements(), background: this.background, paletteRows: this.paletteRows }
  }

  placements(): Placements {
    return new Map([...this.sprites].map(([name, pl]) => [name, { x: pl.x, y: pl.y }]))
  }

  addSprite(sprite: Sprite, x: number, y: number) {
    this.sprites.set(sprite.name, { sprite, x, y, frame: 0 })
    this.emit()
  }

  removeSprite(name: string) {
    if (this.active === name) {
      this.stop()
      this.drag = null
      this.overlay = null
      this.selection = null
      this.floating = null
      this.active = null
    }
    this.sprites.delete(name)
    this.history.rewrite((c) => renameChange(c, (n) => (n === name ? null : n)))
    this.emit()
  }

  renameSprite(from: string, to: string) {
    const pl = this.sprites.get(from)
    if (!pl) return
    this.sprites.delete(from)
    pl.sprite.name = to
    this.sprites.set(to, pl)
    if (this.active === from) this.active = to
    this.history.rewrite((c) => renameChange(c, (n) => (n === from ? to : n)))
    this.emit()
  }

  /** Makes a sprite the one being edited (drops any floating selection first). */
  activate(name: string | null) {
    if (name === this.active) return
    this.stop()
    this.commitFloating()
    this.drag = null
    this.overlay = null
    this.selection = null
    this.active = name && this.sprites.has(name) ? name : null
    this.emit()
  }

  /** Copy of a sprite as it should be saved (floating selection included). */
  snapshot(name = this.active): Sprite | null {
    const sprite = name ? this.sprites.get(name)?.sprite : null
    if (!sprite) return null
    const frames = sprite.frames.map((b) => b.clone())
    if (name === this.active && this.floating) blit(frames[sprite === this.placed?.sprite ? this.placed.frame : 0], this.floating.bmp, this.floating.x, this.floating.y)
    return { name: sprite.name, meta: structuredClone(sprite.meta), frames }
  }

  private setFrame(pl: Placed, f: number, bmp: Bitmap) {
    pl.sprite.frames[f] = bmp
    if (f === 0) {
      pl.sprite.meta.frameWidth = bmp.width
      pl.sprite.meta.frameHeight = bmp.height
    }
  }

  private toLocal(p: PointerInput): PointerInput {
    const pl = this.placed!
    return { ...p, x: p.x - pl.x, y: p.y - pl.y }
  }

  // -------------------------------------------------------------------------
  // Tools and color

  /**
   * Can this tool work on the image being edited? The origin is a sprite's (not a
   * tileset's or a font's), walls are a tileset's: on the other kind (or with nothing to edit), the tool stays where it is,
   * greyed out, and a click says why instead of doing nothing.
   */
  toolApplies(tool: ToolId, name = this.active): boolean {
    if (tool === 'origin') return name !== null && !isStill(name)
    if (tool === 'box') return name !== null && isTileset(name)
    return true
  }

  /** Why a tool cannot work on the image being edited (see `toolApplies`). */
  whyNot(tool: ToolId): string {
    return tool === 'origin' ? 'The origin is for sprites: a tileset or a font has none' : 'Walls are for tilesets: pick one to set its solid tiles'
  }

  setTool(tool: ToolId) {
    if (tool !== 'select') this.deselect()
    this.tool = tool
    this.emit()
  }

  setColor(color: Color) {
    this.color = color
    if (this.tool === 'eraser' || this.tool === 'picker' || this.tool === 'select' || this.tool === 'move') {
      this.tool = 'pencil'
    }
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
  // Pointer (board coordinates)

  down(p: PointerInput) {
    if (this.drag) return
    if (this.tool === 'move') {
      const name = this.hitTest(p)
      if (name) this.grab(name, p)
      return
    }
    this.stop()
    // The first press on another sprite only focuses it; it does not draw.
    const hit = this.hitTest(p)
    if (hit && hit !== this.active && !this.insideSelection(p)) {
      this.activate(hit)
      return
    }
    if (!this.target(p)) {
      if (this.tool === 'select') this.deselect()
      return
    }
    const q = this.toLocal(p)
    const bmp = this.bmp!
    switch (this.tool) {
      case 'pencil':
      case 'eraser':
        this.drag = { kind: 'paint', before: bmp.clone(), last: q }
        this.plot(q)
        break
      case 'fill': {
        const before = bmp.clone()
        if (floodFill(bmp, q.x, q.y, this.color)) this.commit(before)
        break
      }
      case 'origin': {
        if (!this.toolApplies('origin')) {
          this.onMessage(this.whyNot('origin'))
          break
        }
        const before = this.origin
        if (before && before.x === q.x && before.y === q.y) {
          this.setOrigin(null, before)
        } else {
          this.drag = { kind: 'origin', before }
          this.setOriginRaw(q)
        }
        break
      }
      case 'box': {
        // Tilesets only, for now: on a sprite, a box will be its frame's hitbox.
        if (!this.toolApplies('box')) {
          this.onMessage(this.whyNot('box'))
          break
        }
        const ts = this.tileSize
        const column = Math.floor(q.x / ts)
        const row = Math.floor(q.y / ts)
        this.drag = { kind: 'box', before: this.solid.map((b) => ({ ...b })), column, row, start: q, moved: false }
        break
      }
      case 'picker':
        this.drag = { kind: 'pick' }
        this.pick(q)
        break
      case 'line':
      case 'rect':
      case 'rectFill':
        this.drag = { kind: 'shape', start: q }
        this.updateShape(q)
        break
      case 'select':
        this.selectDown(q)
        break
    }
    this.emit()
  }

  /** Starts moving a sprite on the board (Move tool, or dragging its name). */
  grab(name: string, p: Point) {
    if (this.drag || !this.sprites.has(name)) return
    this.activate(name)
    const pl = this.sprites.get(name)!
    this.drag = { kind: 'place', name, start: { x: p.x, y: p.y }, origin: { x: pl.x, y: pl.y } }
    this.emit()
  }

  /** Starts resizing a sprite by one of its corners (Move tool). The
   * opposite corner stays in place; drawn pixels stay where they are. */
  startResize(name: string, corner: Corner, p: Point) {
    if (this.drag || !this.sprites.has(name)) return
    this.activate(name)
    const pl = this.sprites.get(name)!
    const origin = this.rectOf(name)!
    this.drag = {
      kind: 'resize',
      name,
      corner,
      start: { x: p.x, y: p.y },
      origin,
      frames: pl.sprite.frames.slice(),
      rect: origin,
    }
    this.emit()
  }

  /** New footprint while dragging a corner: at least 1×1 (a tile, for a tileset; a cell,
   * for a font), at most MAX_SIZE, and stopped by the other sprites (they may touch). A
   * tileset keeps its width (TILESET_COLUMNS tiles): only its rows change. A font keeps its
   * grid of characters: its cells change, a pixel at a time. */
  private resizeRect(d: Extract<Drag, { kind: 'resize' }>, p: Point): Rect {
    if (isFont(d.name)) {
      const step = { w: FONT_COLUMNS, h: FONT_ROWS }
      const max = { w: Math.floor(MAX_SIZE / FONT_COLUMNS) * FONT_COLUMNS, h: Math.floor(MAX_SIZE / FONT_ROWS) * FONT_ROWS }
      return resizeRect(d.origin, d.corner, p.x - d.start.x, p.y - d.start.y, this.othersThan(d.name), { step, min: step, max })
    }
    // A tileset is whole tiles: its edges move a tile at a time.
    const tileset = isTileset(d.name)
    const step = tileset ? this.tileSize : 1
    const most = Math.floor(MAX_SIZE / step) * step
    return resizeRect(d.origin, d.corner, p.x - d.start.x, p.y - d.start.y, this.othersThan(d.name), {
      step,
      min: { w: tileset ? d.origin.w : step, h: step },
      max: { w: tileset ? d.origin.w : most, h: most },
    })
  }

  /** Shows a sprite at a new footprint (preview while dragging a corner). */
  private previewResize(d: Extract<Drag, { kind: 'resize' }>, r: Rect) {
    const pl = this.sprites.get(d.name)
    if (!pl) return
    d.rect = r
    const ox = d.origin.x - r.x
    const oy = d.origin.y - r.y
    d.frames.forEach((b, f) => this.setFrame(pl, f, r.w === b.width && r.h === b.height && !ox && !oy ? b : this.resizedImage(d.name, b, r.w, r.h, ox, oy)))
    pl.x = r.x
    pl.y = r.y
  }

  private insideSelection(p: PointerInput): boolean {
    if (this.tool !== 'select' || !this.placed) return false
    const q = this.toLocal(p)
    const f = this.floating
    if (f) return rectContains({ x: f.x, y: f.y, w: f.bmp.width, h: f.bmp.height }, q)
    return !!this.selection && rectContains(this.selection, q)
  }

  /** Chooses the sprite a press acts on and activates it. */
  private target(p: PointerInput): boolean {
    if (this.tool === 'select' && this.placed) {
      // Moving the current selection may start outside the sprite.
      const q = this.toLocal(p)
      const f = this.floating
      if (f && rectContains({ x: f.x, y: f.y, w: f.bmp.width, h: f.bmp.height }, q)) return true
      if (!f && this.selection && rectContains(this.selection, q)) return true
    }
    const name = this.hitTest(p)
    if (!name) return false
    this.activate(name)
    return true
  }

  move(p: PointerInput) {
    this.hover = { x: p.x, y: p.y }
    const d = this.drag
    if (!d) return this.emit()
    if (d.kind === 'place') {
      const pl = this.sprites.get(d.name)
      if (pl) {
        pl.x = d.origin.x + p.x - d.start.x
        pl.y = d.origin.y + p.y - d.start.y
      }
      return this.emit()
    }
    if (d.kind === 'resize') {
      const r = this.resizeRect(d, p)
      if (r.x !== d.rect.x || r.y !== d.rect.y || r.w !== d.rect.w || r.h !== d.rect.h) this.previewResize(d, r)
      return this.emit()
    }
    const q = this.toLocal(p)
    switch (d.kind) {
      case 'paint':
        this.plot(q, d.last)
        d.last = q
        break
      case 'pick':
        this.pick(q)
        break
      case 'origin':
        this.setOriginRaw(q)
        break
      case 'box':
        if (q.x !== d.start.x || q.y !== d.start.y) d.moved = true
        if (d.moved) this.dragBox(d, q)
        break
      case 'shape':
        this.updateShape(q)
        break
      case 'select':
        if (q.x !== d.start.x || q.y !== d.start.y) d.moved = true
        this.selection = this.clipToImage(rectFromCorners(d.start, q))
        break
      case 'float':
        if (this.floating) {
          this.floating.x = d.origin.x + q.x - d.start.x
          this.floating.y = d.origin.y + q.y - d.start.y
          this.selection = { x: this.floating.x, y: this.floating.y, w: this.floating.bmp.width, h: this.floating.bmp.height }
        }
        break
    }
    this.emit()
  }

  up(p: PointerInput) {
    const d = this.drag
    this.drag = null
    if (!d) return
    if (d.kind === 'place') {
      const pl = this.sprites.get(d.name)
      const others = this.othersThan(d.name)
      const mine = this.rectOf(d.name)
      if (pl && mine && others.some((o) => overlaps(mine, o))) {
        // Sprites never overlap (they may touch): closest free spot.
        Object.assign(pl, findFreeSpot(mine.w, mine.h, mine, others, 0))
      }
      if (pl && (pl.x !== d.origin.x || pl.y !== d.origin.y)) {
        this.history.push({ kind: 'place', name: d.name, from: d.origin, to: { x: pl.x, y: pl.y } })
        this.onMoved()
      }
      return this.emit()
    }
    if (d.kind === 'resize') {
      // Back to the original, then resize for real (one undo step).
      const r = d.rect
      this.previewResize(d, d.origin)
      if (r.w !== d.origin.w || r.h !== d.origin.h) this.resize(r.w, r.h, d.origin.x - r.x, d.origin.y - r.y)
      return this.emit()
    }
    const bmp = this.bmp
    if (!bmp) return
    const q = this.toLocal(p)
    switch (d.kind) {
      case 'paint':
        this.commit(d.before)
        break
      case 'shape':
        this.updateShape(q)
        if (this.overlay) {
          const before = bmp.clone()
          blit(bmp, this.overlay, 0, 0)
          this.overlay = null
          this.commit(before)
        }
        break
      case 'origin': {
        const after = this.origin
        if (after && (!d.before || d.before.x !== after.x || d.before.y !== after.y)) this.setOrigin(after, d.before)
        break
      }
      case 'box': {
        if (d.moved) this.dragBox(d, q)
        else {
          // A click: a tile without a box becomes solid on its whole area; one with a
          // box loses it. Walls take one click; the drag is for half tiles.
          const had = d.before.some((b) => b.column === d.column && b.row === d.row)
          const ts = this.tileSize
          this.setTileBox(d.column, d.row, had ? null : { x: 0, y: 0, width: ts, height: ts })
        }
        const after = this.solid
        if (JSON.stringify(after) !== JSON.stringify(d.before)) {
          this.history.push({ kind: 'solid', name: this.active!, before: d.before, after: after.map((b) => ({ ...b })) })
          this.onEdit(this.active!)
        }
        break
      }
      case 'select':
        if (!d.moved) this.selection = null
        break
      case 'float':
        // Saving includes the floating selection at its new position.
        this.onEdit(this.active!)
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

  /** Long press: takes the color shown at a board point, from any sprite,
   * or the board color where no pixel is drawn. `boardHex` is the board
   * color as shown (the game's or the editor's default). Returns the color
   * found and whether it could be taken (only palette colors can). */
  pickAt(p: Point, boardHex: string): { color: Color; ok: boolean } {
    const hit = this.hitTest(p)
    let c: Color = TRANSPARENT
    if (hit) {
      const pl = this.sprites.get(hit)!
      c = this.shownFrame(hit).get(p.x - pl.x, p.y - pl.y)
    }
    if (c === TRANSPARENT) c = hexToColor(boardHex)
    const ok = this.inPalette(c)
    if (c === this.color) return { color: c, ok }
    if (ok) this.setColor(c)
    else this.onMessage(`${colorToHex(c)} is not in the palette`)
    return { color: c, ok }
  }

  /** Origin of the active sprite (local pixel), or null. */
  get origin(): Point | null {
    return this.sprite?.meta.origin ?? null
  }

  /** Moves the origin to a pixel of the active image, with no history. */
  private setOriginRaw(p: Point | null) {
    const sprite = this.sprite
    if (!sprite) return
    if (p) {
      const bmp = this.bmp!
      sprite.meta.origin = { x: Math.max(0, Math.min(bmp.width - 1, p.x)), y: Math.max(0, Math.min(bmp.height - 1, p.y)) }
    } else delete sprite.meta.origin
  }

  /** Sets (or clears, with null) the origin as one undo step. */
  private setOrigin(after: Point | null, before: Point | null) {
    const name = this.active
    if (!name) return
    this.setOriginRaw(after)
    this.history.push({ kind: 'origin', name, before, after: this.origin })
    this.onEdit(name)
  }

  /** The solid tiles of the active tileset (empty for a sprite). */
  get solid(): TileBox[] {
    return this.sprite?.meta.solid ?? []
  }

  /** Sets (or clears, with null) the box of a tile of the active tileset, with no history. */
  private setTileBox(column: number, row: number, r: { x: number; y: number; width: number; height: number } | null) {
    const sprite = this.sprite
    if (!sprite) return
    const rest = this.solid.filter((b) => b.column !== column || b.row !== row)
    const all = r ? sortTileBoxes([...rest, { column, row, ...r }]) : rest
    if (all.length) sprite.meta.solid = all
    else delete sprite.meta.solid
  }

  /** The box being dragged: from the pixel pressed to the one under the pointer, kept
   * inside the tile pressed (one box per tile, never across two). */
  private dragBox(d: Extract<Drag, { kind: 'box' }>, q: Point) {
    const ts = this.tileSize
    const x0 = d.column * ts
    const y0 = d.row * ts
    const inTile = (p: Point) => ({ x: Math.max(x0, Math.min(x0 + ts - 1, p.x)), y: Math.max(y0, Math.min(y0 + ts - 1, p.y)) })
    const r = rectFromCorners(inTile(d.start), inTile(q))
    this.setTileBox(d.column, d.row, { x: r.x - x0, y: r.y - y0, width: r.w, height: r.h })
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

  /** Records a change of the active image in the history. */
  private commit(before: Bitmap) {
    const bmp = this.bmp
    const name = this.active
    if (!bmp || !name || before.equals(bmp)) return
    this.history.push({ kind: 'pixels', name, f: this.frame, before, after: bmp.clone() })
    this.onEdit(name)
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Selection (active sprite, local coordinates)

  private clipToImage(r: Rect) {
    const bmp = this.bmp!
    return clipRect(r, bmp.width, bmp.height)
  }

  private selectDown(p: PointerInput) {
    const f = this.floating
    if (f && rectContains({ x: f.x, y: f.y, w: f.bmp.width, h: f.bmp.height }, p)) {
      if (p.alt) this.stamp()
      this.drag = { kind: 'float', start: p, origin: { x: f.x, y: f.y } }
      return
    }
    if (!f && this.selection && rectContains(this.selection, p)) {
      this.lift(!p.alt)
      this.drag = { kind: 'float', start: p, origin: { x: this.floating!.x, y: this.floating!.y } }
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
    const pl = this.placed
    if (!bmp || !pl) return
    if (!this.selection) {
      // No selection: the whole image.
      const before = bmp.clone()
      this.setFrame(pl, pl.frame, axis === 'h' ? flipH(bmp) : flipV(bmp))
      return this.commit(before)
    }
    this.lift(true)
    const f = this.floating!
    f.bmp = axis === 'h' ? flipH(f.bmp) : flipV(f.bmp)
    this.onEdit(this.active!)
    this.emit()
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

  /** Pastes into the active sprite (which may differ from the one copied from). */
  paste() {
    const bmp = this.bmp
    if (!bmp || !this.clipboard) return
    this.commitFloating()
    const x = this.selection?.x ?? 0
    const y = this.selection?.y ?? 0
    this.floating = { bmp: this.clipboard.clone(), x, y, before: bmp.clone() }
    this.selection = { x, y, w: this.clipboard.width, h: this.clipboard.height }
    this.tool = 'select'
    this.onEdit(this.active!)
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Animation frames

  setFrameIndex(i: number) {
    const pl = this.placed
    if (!pl) return
    const f = Math.min(Math.max(0, i), pl.sprite.frames.length - 1)
    this.stop()
    if (f === pl.frame) return
    this.commitFloating()
    this.drag = null
    this.overlay = null
    this.selection = null
    pl.frame = f
    this.emit()
  }

  addFrame() {
    this.editFrames((s) => {
      const { width, height } = s.frames[s.frame]
      s.frames.splice(s.frame + 1, 0, new Bitmap(width, height))
      s.durations.splice(s.frame + 1, 0, s.durations[s.frame])
      s.frame++
    })
  }

  duplicateFrame() {
    this.editFrames((s) => {
      s.frames.splice(s.frame + 1, 0, s.frames[s.frame].clone())
      s.durations.splice(s.frame + 1, 0, s.durations[s.frame])
      s.frame++
    })
  }

  deleteFrame() {
    if ((this.sprite?.frames.length ?? 0) < 2) return
    this.editFrames((s) => {
      s.frames.splice(s.frame, 1)
      s.durations.splice(s.frame, 1)
      s.frame = Math.min(s.frame, s.durations.length - 1)
    })
  }

  /** Moves the current frame one place earlier (-1) or later (+1). */
  moveFrame(delta: -1 | 1) {
    this.moveFrameTo(this.frame, this.frame + delta)
  }

  /** Moves a frame to another place in the list; it becomes the current frame. */
  moveFrameTo(from: number, to: number) {
    const n = this.sprite?.frames.length ?? 0
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return
    this.editFrames((s) => {
      s.frames.splice(to, 0, ...s.frames.splice(from, 1))
      s.durations.splice(to, 0, ...s.durations.splice(from, 1))
      s.frame = to
    })
  }

  /** Frames per second of the whole animation (every frame gets the same duration). */
  get fps(): number {
    return Math.round(1000 / (this.sprite?.meta.frames[0]?.duration ?? 100))
  }

  setFps(fps: number) {
    const pl = this.placed
    if (!pl || !Number.isFinite(fps)) return
    const duration = Math.round(1000 / Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps))))
    if (pl.sprite.meta.frames.every((f) => f.duration === duration)) return
    this.editFrames((s) => s.durations.fill(duration))
  }

  private frameState(pl: Placed): FrameState {
    return {
      frames: pl.sprite.frames.map((b) => b.clone()),
      durations: pl.sprite.meta.frames.map((f) => f.duration),
      frame: pl.frame,
    }
  }

  private restore(pl: Placed, s: FrameState) {
    const { sprite } = pl
    sprite.frames = s.frames.map((b) => b.clone())
    sprite.meta.frames = s.durations.map((duration) => ({ duration }))
    sprite.meta.frameWidth = sprite.frames[0].width
    sprite.meta.frameHeight = sprite.frames[0].height
    pl.frame = Math.min(s.frame, s.durations.length - 1)
  }

  /** Changes the frame list of the active sprite, as one undo step. A tileset has one frame. */
  private editFrames(change: (state: FrameState) => void) {
    const pl = this.placed
    const name = this.active
    if (!pl || !name || isStill(name)) return
    this.stop()
    this.commitFloating()
    this.drag = null
    this.overlay = null
    this.selection = null
    const before = this.frameState(pl)
    const after = this.frameState(pl)
    change(after)
    this.restore(pl, after)
    this.history.push({ kind: 'frames', name, before, after: this.frameState(pl) })
    this.onEdit(name)
    this.emit()
  }

  // --- Playback (the active sprite, on the board) ---

  play() {
    const pl = this.placed
    if (!pl || this.playing || pl.sprite.frames.length < 2) return
    this.commitFloating()
    this.selection = null
    this.playing = true
    this.playIndex = pl.frame
    this.tick()
    this.emit()
  }

  stop() {
    if (!this.playing) return
    clearTimeout(this.playTimer)
    this.playing = false
    this.emit()
  }

  private tick() {
    const pl = this.placed
    if (!pl) return this.stop()
    this.playTimer = setTimeout(() => {
      this.playIndex = (this.playIndex + 1) % pl.sprite.frames.length
      this.tick()
      this.emit()
    }, pl.sprite.meta.frames[this.playIndex]?.duration ?? 100)
  }

  // -------------------------------------------------------------------------
  // History and transforms

  undo() {
    if (this.drag) return
    this.stop()
    this.commitFloating()
    const c = this.history.undo()
    if (c) this.apply(c, true)
  }

  redo() {
    if (this.drag) return
    this.stop()
    this.commitFloating()
    const c = this.history.redo()
    if (c) this.apply(c, false)
  }

  private apply(c: Change, undo: boolean, single = true) {
    if (c.kind === 'group') {
      const items = undo ? [...c.items].reverse() : c.items
      for (const item of items) this.apply(item, undo, false)
      return this.emit()
    }
    const pl = this.sprites.get(c.name)
    if (!pl) return
    if (c.kind === 'pixels') {
      this.setFrame(pl, c.f, (undo ? c.before : c.after).clone())
      this.onEdit(c.name)
    } else if (c.kind === 'origin') {
      const o = undo ? c.before : c.after
      if (o) pl.sprite.meta.origin = { ...o }
      else delete pl.sprite.meta.origin
      this.onEdit(c.name)
    } else if (c.kind === 'solid') {
      const boxes = (undo ? c.before : c.after).map((b) => ({ ...b }))
      if (boxes.length) pl.sprite.meta.solid = boxes
      else delete pl.sprite.meta.solid
      this.onEdit(c.name)
    } else if (c.kind === 'frames') {
      this.restore(pl, undo ? c.before : c.after)
      this.onEdit(c.name)
    } else {
      const to = undo ? c.from : c.to
      pl.x = to.x
      pl.y = to.y
      this.onMoved()
    }
    if (single) {
      // Show what was undone: make that sprite active, and visible.
      this.activate(c.name)
      if (c.kind === 'pixels') pl.frame = Math.min(c.f, pl.sprite.frames.length - 1)
      this.selection = null
      this.onReveal(c.name)
      this.emit()
    }
  }

  /** An image at a new size: the old one at (ox, oy), or for a font, each character
   * in its cell, now of the new size. */
  private resizedImage(name: string, b: Bitmap, w: number, h: number, ox: number, oy: number) {
    if (isFont(name)) return relayoutFont(b, Math.max(1, Math.floor(w / FONT_COLUMNS)), Math.max(1, Math.floor(h / FONT_ROWS)))
    return resized(b, w, h, ox, oy)
  }

  /** Resizes the active image; the old image goes at (ox, oy), and the sprite
   * moves on the board so the drawing stays where it was. */
  resize(w: number, h: number, ox: number, oy: number) {
    const bmp = this.bmp
    const pl = this.placed
    const name = this.active
    if (!bmp || !pl || !name) return
    this.commitFloating()
    this.selection = null
    // Every frame gets the new size.
    const items: Change[] = []
    pl.sprite.frames.forEach((b, f) => {
      const before = b.clone()
      this.setFrame(pl, f, this.resizedImage(name, b, w, h, ox, oy))
      items.push({ kind: 'pixels', name, f, before, after: pl.sprite.frames[f].clone() })
    })
    // A tileset's solid tiles stay with their pixels; those cut off go with them.
    const solid = pl.sprite.meta.solid
    if (solid) {
      const shift = Math.round(oy / this.tileSize)
      const rows = Math.floor(h / this.tileSize)
      const moved = solid.map((b) => ({ ...b, row: b.row + shift })).filter((b) => b.row >= 0 && b.row < rows)
      if (JSON.stringify(moved) !== JSON.stringify(solid)) {
        if (moved.length) pl.sprite.meta.solid = moved
        else delete pl.sprite.meta.solid
        items.push({ kind: 'solid', name, before: solid, after: moved.map((b) => ({ ...b })) })
      }
    }
    const o = pl.sprite.meta.origin
    if (o && (ox || oy)) {
      pl.sprite.meta.origin = { x: o.x + ox, y: o.y + oy }
      items.push({ kind: 'origin', name, before: o, after: { ...pl.sprite.meta.origin } })
    }
    if (ox || oy) {
      const from = { x: pl.x, y: pl.y }
      pl.x -= ox
      pl.y -= oy
      items.push({ kind: 'place', name, from, to: { x: pl.x, y: pl.y } })
    }
    // A bigger sprite pushes aside the neighbours it now covers.
    const mine = this.rectOf(name)!
    const others = [...this.sprites.keys()].filter((n) => n !== name).sort()
    const covered = others.filter((n) => overlaps(mine, this.rectOf(n)!))
    const pushed = resolveOverlaps(
      [mine, ...others.filter((n) => !covered.includes(n)).map((n) => this.rectOf(n)!)],
      covered.map((n) => ({ name: n, rect: this.rectOf(n)! })),
    )
    for (const [n, p] of pushed) {
      const other = this.sprites.get(n)!
      const from = { x: other.x, y: other.y }
      Object.assign(other, p)
      items.push({ kind: 'place', name: n, from, to: { x: other.x, y: other.y } })
    }
    if (items.length > 1) this.onMoved()
    this.history.push({ kind: 'group', items })
    this.onEdit(name)
    this.emit()
  }

  /** Replaces a color in every sprite, as a single undo step. Returns the sprites changed. */
  replaceColorEverywhere(from: Color, to: Color): string[] {
    this.commitFloating()
    const items: Change[] = []
    const changed: string[] = []
    for (const [name, pl] of this.sprites) {
      let any = false
      pl.sprite.frames.forEach((b, f) => {
        const after = b.clone()
        if (!replaceColor(after, from, to)) return
        items.push({ kind: 'pixels', name, f, before: b, after: after.clone() })
        pl.sprite.frames[f] = after
        any = true
      })
      if (any) changed.push(name)
    }
    if (items.length) this.history.push({ kind: 'group', items })
    for (const name of changed) this.onEdit(name)
    this.emit()
    return changed
  }
}

function renameChange(c: Change, rename: (name: string) => string | null): Change | null {
  if (c.kind === 'group') {
    const items = c.items.map((i) => renameChange(i, rename)).filter((i): i is Change => i !== null)
    return items.length ? { kind: 'group', items } : null
  }
  const name = rename(c.name)
  return name === null ? null : { ...c, name }
}

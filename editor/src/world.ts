// The world editor's state and tools, with no knowledge of the DOM.
//
// The whole game sits in one world: every map at its place, like every sprite on the
// board. Pointer coordinates are world pixels (what the view shows); maps are stored in
// cells of the game's tile size. Maps are moved and resized like sprites on the board, and
// never overlap. Undo covers every map.
//
// (runtime/world.ts is the game's world of things: a different file in a different folder.)

import { rectContains, linePoints, type Point, type Rect } from './bitmap'
import { boundsOf, findFreeSpot, overlaps, resizeRect, type Corner } from './board'
import { History } from './history'
import { cellAt, cloneMap, reframe, renameTileset, setCell, tilesetsOf, type GameMap, type Tile } from './map'

export type WorldTool = 'tile' | 'eraser' | 'picker' | 'move'

/** Tiles picked in a tileset, stamped as a block: its top left corner and size, in tiles. */
export interface Brush {
  tileset: string
  col: number
  row: number
  w: number
  h: number
}

/** The largest map, in cells on each side. */
export const MAX_MAP_CELLS = 1024

/** One undoable change: a map as it was and as it became. */
interface Change {
  name: string
  before: GameMap
  after: GameMap
}

type Drag =
  | { kind: 'paint'; name: string; before: GameMap; start: Point; last: Point }
  | { kind: 'place'; name: string; start: Point; origin: Point; before: GameMap }
  | { kind: 'resize'; name: string; corner: Corner; start: Point; origin: Rect; rect: Rect; before: GameMap }

export class World {
  readonly maps = new Map<string, GameMap>()
  tool: WorldTool = 'tile'
  brush: Brush | null = null
  /** The game's tile size and resolution (game.json). */
  tileSize = 16
  screen = { width: 320, height: 180 }
  /** The map last touched: drawn on top, its corners highlighted. */
  active: string | null = null
  /** Pointer position, in world pixels. */
  hover: Point | null = null

  /** A map changed (to save it). */
  onEdit: (name: string) => void = () => {}
  onMessage: (text: string) => void = () => {}

  private drag: Drag | null = null
  private history = new History<Change>()
  private listeners = new Set<() => void>()

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn()
  }

  // -------------------------------------------------------------------------
  // Geometry

  /** The smallest map: one screen, in whole cells. Smaller, the maps around would show. */
  get minCells() {
    return { w: Math.ceil(this.screen.width / this.tileSize), h: Math.ceil(this.screen.height / this.tileSize) }
  }

  /** A map's place and size, in cells. */
  cellRect(name: string): Rect | null {
    const m = this.maps.get(name)
    return m ? { x: m.x, y: m.y, w: m.width, h: m.height } : null
  }

  /** A map's place and size, in world pixels. */
  rectOf(name: string): Rect | null {
    const r = this.cellRect(name)
    const t = this.tileSize
    return r && { x: r.x * t, y: r.y * t, w: r.w * t, h: r.h * t }
  }

  bounds(): Rect | null {
    return boundsOf([...this.maps.keys()].map((n) => this.rectOf(n)!))
  }

  /** Names in drawing order: alphabetical, the active map last. */
  drawOrder(): string[] {
    const names = [...this.maps.keys()].sort()
    if (this.active && this.maps.has(this.active)) {
      names.splice(names.indexOf(this.active), 1)
      names.push(this.active)
    }
    return names
  }

  /** The map under a world point. */
  hitTest(p: Point): string | null {
    const order = this.drawOrder()
    for (let i = order.length - 1; i >= 0; i--) if (rectContains(this.rectOf(order[i])!, p)) return order[i]
    return null
  }

  /** The cell under a world point. */
  cellOf(p: Point): Point {
    return { x: Math.floor(p.x / this.tileSize), y: Math.floor(p.y / this.tileSize) }
  }

  private othersThan(name: string): Rect[] {
    return [...this.maps.keys()].filter((n) => n !== name).map((n) => this.cellRect(n)!)
  }

  /** Corner being dragged to resize a map, if any. */
  get resizeCorner(): Corner | null {
    return this.drag?.kind === 'resize' ? this.drag.corner : null
  }

  /** True while a map being moved sits on another one (it will be pushed aside). */
  get placeBlocked(): boolean {
    const d = this.drag
    if (d?.kind !== 'place') return false
    const r = this.cellRect(d.name)!
    return this.othersThan(d.name).some((o) => overlaps(r, o))
  }

  get dragging() {
    return this.drag !== null
  }

  /** The maps that use a tileset (it cannot be deleted then). */
  mapsUsing(tileset: string): string[] {
    return [...this.maps.values()].filter((m) => tilesetsOf(m).includes(tileset)).map((m) => m.name).sort()
  }

  /** A free place for a new map of w × h cells, near a world point. */
  freeSpot(w: number, h: number, near: Point): Point {
    const c = this.cellOf(near)
    const taken = [...this.maps.keys()].map((n) => this.cellRect(n)!)
    return findFreeSpot(w, h, { x: c.x - Math.floor(w / 2), y: c.y - Math.floor(h / 2) }, taken, 0)
  }

  // -------------------------------------------------------------------------
  // Maps (creating, renaming and deleting are not undoable, like sprites)

  addMap(map: GameMap) {
    this.maps.set(map.name, map)
    this.active = map.name
    this.emit()
  }

  removeMap(name: string) {
    if (this.drag && 'name' in this.drag && this.drag.name === name) this.drag = null
    this.maps.delete(name)
    if (this.active === name) this.active = null
    this.history.rewrite((c) => (c.name === name ? null : c))
    this.emit()
  }

  renameMap(from: string, to: string) {
    const m = this.maps.get(from)
    if (!m) return
    this.maps.delete(from)
    m.name = to
    this.maps.set(to, m)
    if (this.active === from) this.active = to
    const rename = (g: GameMap) => ({ ...g, name: to })
    this.history.rewrite((c) => (c.name === from ? { name: to, before: rename(c.before), after: rename(c.after) } : c))
    this.emit()
  }

  /** A tileset was renamed: every map follows (undo keeps working). Returns the maps changed. */
  renameTileset(from: string, to: string): string[] {
    const changed: string[] = []
    for (const m of this.maps.values()) if (renameTileset(m, from, to)) changed.push(m.name)
    this.history.rewrite((c) => {
      renameTileset(c.before, from, to)
      renameTileset(c.after, from, to)
      return c
    })
    this.emit()
    return changed
  }

  // -------------------------------------------------------------------------
  // Tools

  setTool(tool: WorldTool) {
    this.tool = tool
    this.emit()
  }

  /** Picks tiles in a tileset to stamp (the Tile tool). */
  setBrush(brush: Brush | null) {
    this.brush = brush
    if (brush && this.tool !== 'tile') this.tool = 'tile'
    this.emit()
  }

  /** The tiles the brush would stamp at a cell, as [cell, tile] pairs. */
  stampAt(c: Point): [Point, Tile][] {
    const b = this.brush
    if (!b) return []
    const out: [Point, Tile][] = []
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) out.push([{ x: c.x + x, y: c.y + y }, { tileset: b.tileset, col: b.col + x, row: b.row + y }])
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Pointer (world pixels)

  down(p: Point) {
    if (this.drag) return
    const name = this.hitTest(p)
    if (!name) return
    this.active = name
    const map = this.maps.get(name)!
    const c = this.cellOf(p)
    switch (this.tool) {
      case 'move':
        this.drag = { kind: 'place', name, start: { x: p.x, y: p.y }, origin: { x: map.x, y: map.y }, before: cloneMap(map) }
        break
      case 'tile':
      case 'eraser':
        if (this.tool === 'tile' && !this.brush) {
          this.onMessage('Pick a tile in a tileset first')
          break
        }
        this.drag = { kind: 'paint', name, before: cloneMap(map), start: c, last: c }
        this.paint(map, c, c)
        break
      case 'picker': {
        const t = cellAt(map, c.x, c.y)
        if (t) this.setBrush({ tileset: t.tileset, col: t.col, row: t.row, w: 1, h: 1 })
        break
      }
    }
    this.emit()
  }

  /** Starts resizing a map by one of its corners (Move tool): the opposite corner stays,
   * and the tiles stay where they are in the world. */
  startResize(name: string, corner: Corner, p: Point) {
    if (this.drag || !this.maps.has(name)) return
    this.active = name
    const origin = this.cellRect(name)!
    this.drag = { kind: 'resize', name, corner, start: { x: p.x, y: p.y }, origin, rect: origin, before: cloneMap(this.maps.get(name)!) }
    this.emit()
  }

  move(p: Point) {
    this.hover = { x: p.x, y: p.y }
    const d = this.drag
    if (!d) return this.emit()
    const map = this.maps.get(d.name)
    if (!map) return this.emit()
    const t = this.tileSize
    if (d.kind === 'place') {
      map.x = d.origin.x + Math.round((p.x - d.start.x) / t)
      map.y = d.origin.y + Math.round((p.y - d.start.y) / t)
    } else if (d.kind === 'resize') {
      const min = this.minCells
      const r = resizeRect(d.origin, d.corner, Math.round((p.x - d.start.x) / t), Math.round((p.y - d.start.y) / t), this.othersThan(d.name), {
        min,
        max: { w: MAX_MAP_CELLS, h: MAX_MAP_CELLS },
      })
      // Squeezed by a neighbor below one screen: it stays as it was.
      if (r.w >= min.w && r.h >= min.h && (r.x !== d.rect.x || r.y !== d.rect.y || r.w !== d.rect.w || r.h !== d.rect.h)) {
        d.rect = r
        this.maps.set(d.name, reframe(d.before, r.x, r.y, r.w, r.h))
      }
    } else {
      const c = this.cellOf(p)
      for (const q of linePoints(d.last.x, d.last.y, c.x, c.y)) this.paint(map, q, d.start)
      d.last = c
    }
    this.emit()
  }

  up(_p: Point) {
    const d = this.drag
    this.drag = null
    if (!d) return
    const map = this.maps.get(d.name)
    if (!map) return this.emit()
    if (d.kind === 'place') {
      const mine = this.cellRect(d.name)!
      const others = this.othersThan(d.name)
      // Maps never overlap (they may touch): closest free place.
      if (others.some((o) => overlaps(mine, o))) Object.assign(map, findFreeSpot(mine.w, mine.h, mine, others, 0))
    }
    this.record(d.name, d.before)
    this.emit()
  }

  leave() {
    this.hover = null
    this.emit()
  }

  /** Paints at a cell, in a stroke started at `start`: a block of tiles is stamped on a
   * grid of its own size from there, so dragging repeats it whole instead of smearing it. */
  private paint(map: GameMap, c: Point, start: Point) {
    if (this.tool === 'eraser') {
      setCell(map, c.x, c.y, null)
      return
    }
    const b = this.brush
    if (!b) return
    const at = {
      x: start.x + Math.floor((c.x - start.x) / b.w) * b.w,
      y: start.y + Math.floor((c.y - start.y) / b.h) * b.h,
    }
    for (const [cell, tile] of this.stampAt(at)) setCell(map, cell.x, cell.y, tile)
  }

  // -------------------------------------------------------------------------
  // History

  /** Keeps a change of a map, if it changed, and has it saved. */
  private record(name: string, before: GameMap) {
    const after = this.maps.get(name)
    if (!after || sameMap(before, after)) return
    this.history.push({ name, before, after: cloneMap(after) })
    this.onEdit(name)
  }

  get canUndo() {
    return this.history.canUndo
  }

  get canRedo() {
    return this.history.canRedo
  }

  undo() {
    if (this.drag) return
    const c = this.history.undo()
    if (c) this.restore(c.name, c.before)
  }

  redo() {
    if (this.drag) return
    const c = this.history.redo()
    if (c) this.restore(c.name, c.after)
  }

  private restore(name: string, map: GameMap) {
    if (!this.maps.has(name)) return
    this.maps.set(name, cloneMap(map))
    this.active = name
    this.onEdit(name)
    this.emit()
  }
}

function sameMap(a: GameMap, b: GameMap) {
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false
  return a.cells.every((c, i) => {
    const o = b.cells[i]
    return c === o || (!!c && !!o && c.tileset === o.tileset && c.col === o.col && c.row === o.row)
  })
}

// The world editor's state and tools, with no knowledge of the DOM.
//
// The whole game sits in one world: every map at its place, like every sprite on the
// board. Pointer coordinates are world pixels (what the view shows); maps are stored in
// cells of the game's tile size. Maps are moved and resized like sprites on the board, and
// never overlap. Undo covers every map.
//
// The page works in one of three modes, each with its own tools: Tiles (paint the maps),
// Actors (place the game's actors on them) and Maps (move and resize the maps). Only what
// the mode is about reacts to the pointer: painting under a villager never grabs it.
//
// Actors (instances of the game's actor classes) are kept by the map they start in, in
// pixels from its top left, so they move with it. They snap to half tiles by their
// sprite's frame, or go anywhere by the pixel (see `snapActor`), are selected one by one or with a box, and can be
// dragged, nudged, copied and pasted from one map to another.
//
// (runtime/world.ts is the game's world of actors: a different file in a different folder.)

import { rectContains, linePoints, type Point, type Rect } from './bitmap'
import { boundsOf, findFreeSpot, overlaps, resizeRect, type Corner } from './board'
import { History } from './history'
import { cellAt, cloneMap, insideMap, reframe, renameTileset, setCell, tilesetsOf, type GameMap, type Placement, type Tile } from './map'

export type WorldMode = 'tiles' | 'actors' | 'maps'
export type WorldTool = 'tile' | 'eraser' | 'picker' | 'select' | 'place' | 'move'

/** The tools of each mode, in the order the toolbar shows them; the first is its default. */
export const MODE_TOOLS: Record<WorldMode, WorldTool[]> = {
  tiles: ['tile', 'eraser', 'picker'],
  actors: ['select', 'place'],
  maps: ['move'],
}

export function modeOf(tool: WorldTool): WorldMode {
  return (Object.keys(MODE_TOOLS) as WorldMode[]).find((m) => MODE_TOOLS[m].includes(tool))!
}

/** A placed actor, where it is in the world (game pixels), and the map that keeps it. */
export interface PlacedActor {
  actor: Placement
  map: string
  x: number
  y: number
}

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

/** A map as it was and as it became. */
interface MapChange {
  name: string
  before: GameMap
  after: GameMap
}

/** One undoable change: of one map, or two (an actor dragged from one to the other). */
interface Change {
  maps: MapChange[]
}

type Drag =
  | { kind: 'paint'; name: string; before: GameMap; start: Point; last: Point }
  | { kind: 'place'; name: string; start: Point; origin: Point; before: GameMap }
  | { kind: 'resize'; name: string; corner: Corner; start: Point; origin: Rect; rect: Rect; before: GameMap }
  /** The selected actors being dragged, from where each was (world pixels). Every map
   * they have been in keeps its state from before the drag. */
  | { kind: 'actors'; start: Point; from: Map<Placement, Point>; befores: Map<string, GameMap>; held: Placement }
  /** A box drawn to select the actors it touches, added to `base` (Shift held). */
  | { kind: 'box'; start: Point; end: Point; base: Set<Placement> }

export class World {
  readonly maps = new Map<string, GameMap>()
  tool: WorldTool = 'tile'
  brush: Brush | null = null
  /** The game's tile size, and its screen in tiles (game.json). */
  tileSize = 16
  screen = { columns: 20, rows: 11 }
  /** The map last touched: drawn on top, its corners highlighted. */
  active: string | null = null
  /** Pointer position, in world pixels. */
  hover: Point | null = null
  mode: WorldMode = 'tiles'
  /** The tool last used in each mode: coming back to a mode picks it again. */
  private lastTool: Record<WorldMode, WorldTool> = { tiles: 'tile', actors: 'select', maps: 'move' }
  /** The class of actors the Place tool places (by its export name). */
  actorType: string | null = null
  /** The actors selected (Actors mode). The very objects in the maps' lists. */
  selection = new Set<Placement>()
  /** Actors copied (⌘C), from the top left of their feet, in world pixels. */
  private clipboard: { type: string; x: number; y: number }[] = []
  /** Where they were copied from, and how many times pasted there (each paste steps aside). */
  private copiedAt: Point = { x: 0, y: 0 }
  private pastes = 0
  /**
   * A class's picture around its feet, in game pixels (what the view draws and what a
   * click hits), or null when it has none: the world has no knowledge of the game's code.
   */
  actorBounds: (type: string) => Rect | null = () => null
  /** The frame of a class's sprite around its feet, which it snaps by, or null (see `snapActor`). */
  actorFrame: (type: string) => Rect | null = () => null
  /** Actors snap to half tiles (the default), or go anywhere by the pixel (the page's toggle). */
  snap = true

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

  /** The smallest map: exactly one screen, in cells. Smaller, the maps around would show. */
  get minCells() {
    return { w: this.screen.columns, h: this.screen.rows }
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
  // Actors

  /** What a class covers around its feet: its picture, or one tile standing on them. */
  boundsOf(type: string): Rect {
    const t = this.tileSize
    return this.actorBounds(type) ?? { x: -t / 2, y: -t, w: t, h: t }
  }

  /** Every placed actor, from the back to the front (by y, as the game draws them). */
  actorsInDepthOrder(): PlacedActor[] {
    const out: PlacedActor[] = []
    for (const name of [...this.maps.keys()].sort()) {
      const m = this.maps.get(name)!
      for (const actor of m.actors) out.push({ actor, map: name, x: m.x * this.tileSize + actor.x, y: m.y * this.tileSize + actor.y })
    }
    return out.sort((a, b) => a.y - b.y)
  }

  /** A placed actor, found in the maps (null if it is no longer in any). */
  placed(actor: Placement): PlacedActor | null {
    for (const [name, m] of this.maps) {
      if (m.actors.includes(actor)) return { actor, map: name, x: m.x * this.tileSize + actor.x, y: m.y * this.tileSize + actor.y }
    }
    return null
  }

  /** The rectangle a placed actor covers, in world pixels. */
  actorRect(p: PlacedActor): Rect {
    const b = this.boundsOf(p.actor.type)
    return { x: p.x + b.x, y: p.y + b.y, w: b.w, h: b.h }
  }

  /** The actor in front under a world point. */
  actorAt(p: Point): Placement | null {
    const all = this.actorsInDepthOrder()
    for (let i = all.length - 1; i >= 0; i--) if (rectContains(this.actorRect(all[i]), p)) return all[i].actor
    return null
  }

  /** How many actors of a class are placed, in every map. */
  countOf(type: string): number {
    let n = 0
    for (const m of this.maps.values()) for (const t of m.actors) if (t.type === type) n++
    return n
  }

  /** Selects every actor of a class (to find them, or move them all). */
  selectAllOf(type: string) {
    this.setTool('select')
    this.selection = new Set(this.actorsInDepthOrder().filter((p) => p.actor.type === type).map((p) => p.actor))
    this.emit()
  }

  /** Selects every placed actor. */
  selectAll() {
    this.selection = new Set(this.actorsInDepthOrder().map((p) => p.actor))
    this.emit()
  }

  /** The step actors snap to: half a tile (a whole one when the tile size is odd). */
  get actorStep() {
    return this.tileSize % 2 ? this.tileSize : this.tileSize / 2
  }

  /**
   * Where an actor of a class stands, snapped, its feet near `feet`. Neither its feet nor
   * its box say where it sits in a cell: its sprite's frame does. A sprite is drawn in a
   * frame of the tile size (or of whole tiles), where the character stands as it should
   * in its cell, so the frame's top left goes on a half tile and the feet follow, wherever
   * they are in it: a 16 × 16 sprite fills a cell, or stands between two. An actor that
   * draws no sprite has its feet on half tiles. With snapping off, the feet go on the
   * nearest pixel.
   */
  snapActor(type: string, feet: Point): Point {
    if (!this.snap) return { x: Math.round(feet.x), y: Math.round(feet.y) }
    const f = this.actorFrame(type) ?? { x: 0, y: 0 }
    const step = this.actorStep
    return { x: Math.round((feet.x + f.x) / step) * step - f.x, y: Math.round((feet.y + f.y) / step) * step - f.y }
  }

  /**
   * Where a new actor stands with the pointer at `p`: the pointer holds its frame by the
   * middle, so a one-tile sprite fills the cell under the pointer. With no frame, the
   * pointer holds its feet, and it stands on the half tile under the pointer.
   */
  placeAt(type: string, p: Point): Point {
    const f = this.actorFrame(type)
    if (f) return this.snapActor(type, { x: p.x - f.x - f.w / 2, y: p.y - f.y - f.h / 2 })
    if (!this.snap) return { x: Math.round(p.x), y: Math.round(p.y) }
    const step = this.actorStep
    return { x: Math.round(p.x / step) * step, y: Math.ceil(p.y / step) * step }
  }

  /** The map an actor standing at a world point is in (see `insideMap`). */
  mapForActor(p: Point): string | null {
    for (const [name, m] of this.maps) {
      if (insideMap(m, p.x - m.x * this.tileSize, p.y - m.y * this.tileSize, this.tileSize)) return name
    }
    return null
  }

  /** Chooses the class of actors to place: the Place tool takes over. */
  setActorType(type: string | null) {
    this.actorType = type
    if (type) this.setTool('place')
    else this.emit()
  }

  /** Removes the selected actors. */
  deleteSelection() {
    if (this.drag || !this.selection.size) return
    const befores = new Map<string, GameMap>()
    for (const [name, m] of this.maps) {
      if (!m.actors.some((t) => this.selection.has(t))) continue
      befores.set(name, cloneMap(m))
      m.actors = m.actors.filter((t) => !this.selection.has(t))
    }
    this.selection = new Set()
    this.record(befores)
    this.emit()
  }

  /** Moves the selected actors by (dx, dy) world pixels, with arrow keys. */
  nudge(dx: number, dy: number) {
    if (this.drag || !this.selection.size) return
    const from = this.selectedFrom()
    const befores = new Map<string, GameMap>()
    if (this.moveActors(from, { x: dx, y: dy }, befores)) this.record(befores)
    this.emit()
  }

  /** Copies the selected actors. */
  copy() {
    const placed = [...this.selection].map((t) => this.placed(t)).filter((p): p is PlacedActor => p !== null)
    if (!placed.length) return
    const left = Math.min(...placed.map((p) => p.x))
    const top = Math.min(...placed.map((p) => p.y))
    this.clipboard = placed.sort((a, b) => a.y - b.y).map((p) => ({ type: p.actor.type, x: p.x - left, y: p.y - top }))
    this.copiedAt = { x: left, y: top }
    this.pastes = 0
  }

  get canPaste() {
    return this.clipboard.length > 0
  }

  /**
   * Pastes the actors copied: at the pointer when it is on a map (it holds the top one, as
   * when placing it), else next to where they were copied (one step further at each
   * paste). The ones that would fall outside every map are left out. The actors pasted
   * become the selection.
   */
  paste() {
    if (this.drag || !this.clipboard.length) return
    const step = this.actorStep
    let at: Point | null = null
    const hv = this.hover
    if (hv) {
      const top = this.clipboard[0]
      const feet = this.placeAt(top.type, hv)
      if (this.mapForActor(feet)) at = { x: feet.x - top.x, y: feet.y - top.y }
    }
    if (!at) {
      this.pastes++
      at = { x: this.copiedAt.x + this.pastes * step, y: this.copiedAt.y + this.pastes * step }
    }
    this.add(this.clipboard.map((c) => ({ type: c.type, x: at.x + c.x, y: at.y + c.y })))
  }

  /** Copies the selected actors and pastes them one step aside. */
  duplicate() {
    if (this.drag || !this.selection.size) return
    const hover = this.hover
    this.copy()
    this.hover = null
    this.paste()
    this.hover = hover
  }

  /** Adds actors at world positions, in the maps they stand in, and selects them. */
  private add(list: { type: string; x: number; y: number }[]) {
    const befores = new Map<string, GameMap>()
    const added = new Set<Placement>()
    for (const c of list) {
      const name = this.mapForActor(c)
      if (!name) continue
      const m = this.maps.get(name)!
      if (!befores.has(name)) befores.set(name, cloneMap(m))
      const actor = { type: c.type, x: c.x - m.x * this.tileSize, y: c.y - m.y * this.tileSize }
      m.actors.push(actor)
      added.add(actor)
    }
    if (!added.size) {
      this.onMessage('Actors go inside a map')
      return
    }
    this.setTool('actors' === this.mode ? this.tool : 'select')
    this.selection = added
    this.record(befores)
    this.emit()
  }

  /** Where each selected actor is, in world pixels. */
  private selectedFrom(): Map<Placement, Point> {
    const from = new Map<Placement, Point>()
    for (const t of this.selection) {
      const p = this.placed(t)
      if (p) from.set(t, { x: p.x, y: p.y })
    }
    return from
  }

  /**
   * Puts actors at their place in `from` moved by `delta`, each in the map it then stands
   * in (keeping the maps' state in `befores` first). All or nothing: when one would leave
   * every map, none moves, and it returns false.
   */
  private moveActors(from: Map<Placement, Point>, delta: Point, befores: Map<string, GameMap>): boolean {
    const targets: [Placement, string, Point][] = []
    for (const [actor, p] of from) {
      const to = { x: p.x + delta.x, y: p.y + delta.y }
      const name = this.mapForActor(to)
      if (!name) return false
      targets.push([actor, name, to])
    }
    for (const [actor, name, to] of targets) {
      const owner = this.placed(actor)!.map
      const m = this.maps.get(name)!
      for (const n of [owner, name]) if (!befores.has(n)) befores.set(n, cloneMap(this.maps.get(n)!))
      actor.x = to.x - m.x * this.tileSize
      actor.y = to.y - m.y * this.tileSize
      if (owner !== name) {
        const old = this.maps.get(owner)!
        old.actors.splice(old.actors.indexOf(actor), 1)
        m.actors.push(actor)
      }
    }
    return true
  }

  // -------------------------------------------------------------------------
  // Maps (creating, renaming and deleting are not undoable, like sprites)

  addMap(map: GameMap) {
    this.maps.set(map.name, map)
    this.active = map.name
    this.emit()
  }

  removeMap(name: string) {
    if (this.drag) this.drag = null
    this.selection = new Set([...this.selection].filter((t) => !this.maps.get(name)?.actors.includes(t)))
    this.maps.delete(name)
    if (this.active === name) this.active = null
    this.history.rewrite((c) => {
      const maps = c.maps.filter((m) => m.name !== name)
      return maps.length ? { maps } : null
    })
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
    this.history.rewrite((c) => ({
      maps: c.maps.map((m) => (m.name === from ? { name: to, before: rename(m.before), after: rename(m.after) } : m)),
    }))
    this.emit()
  }

  /** A tileset was renamed: every map follows (undo keeps working). Returns the maps changed. */
  renameTileset(from: string, to: string): string[] {
    const changed: string[] = []
    for (const m of this.maps.values()) if (renameTileset(m, from, to)) changed.push(m.name)
    this.history.rewrite((c) => {
      for (const m of c.maps) {
        renameTileset(m.before, from, to)
        renameTileset(m.after, from, to)
      }
      return c
    })
    this.emit()
    return changed
  }

  // -------------------------------------------------------------------------
  // Tools

  setTool(tool: WorldTool) {
    if (this.drag) return
    this.tool = tool
    this.mode = modeOf(tool)
    this.lastTool[this.mode] = tool
    if (this.mode !== 'actors') this.selection = new Set()
    this.emit()
  }

  /** Switches to a mode, with the tool last used in it. */
  setMode(mode: WorldMode) {
    this.setTool(this.lastTool[mode])
  }

  /** Picks tiles in a tileset to stamp (the Tile tool). */
  setBrush(brush: Brush | null) {
    this.brush = brush
    if (brush && this.tool !== 'tile') this.setTool('tile')
    else this.emit()
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
    if (this.mode === 'actors') {
      this.downActors(p)
      this.emit()
      return
    }
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

  /**
   * Actors mode. Place: a click drops the class picked, in the cell under the pointer (see
   * `placeAt`). Select: a click on an actor selects it (Shift: adds or removes it) and
   * dragging moves the whole selection; dragging on the ground draws a box that selects
   * what it touches.
   */
  private downActors(p: Point) {
    if (this.tool === 'place') {
      if (!this.actorType) return this.onMessage('Pick an actor in the Actors panel first')
      const at = this.placeAt(this.actorType, p)
      this.add([{ type: this.actorType, ...at }])
      return
    }
    const hit = this.actorAt(p)
    if (!hit) {
      const base = this.shift ? new Set(this.selection) : new Set<Placement>()
      this.selection = new Set(base)
      this.drag = { kind: 'box', start: { x: p.x, y: p.y }, end: { x: p.x, y: p.y }, base }
      return
    }
    if (this.shift) {
      if (this.selection.has(hit)) this.selection.delete(hit)
      else this.selection.add(hit)
      return
    }
    if (!this.selection.has(hit)) this.selection = new Set([hit])
    this.active = this.placed(hit)!.map
    this.drag = { kind: 'actors', start: { x: p.x, y: p.y }, from: this.selectedFrom(), befores: new Map(), held: hit }
  }

  /** Shift held (set by the page): adds to the selection instead of replacing it. */
  shift = false

  /** The box being drawn to select actors, in world pixels. */
  get selectBox(): Rect | null {
    const d = this.drag
    if (d?.kind !== 'box') return null
    return { x: Math.min(d.start.x, d.end.x), y: Math.min(d.start.y, d.end.y), w: Math.abs(d.end.x - d.start.x), h: Math.abs(d.end.y - d.start.y) }
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
    if (d.kind === 'actors') {
      // The actor held snaps (see `snapActor`); the others keep their places relative to it.
      const from = d.from.get(d.held)!
      const to = this.snapActor(d.held.type, { x: from.x + p.x - d.start.x, y: from.y + p.y - d.start.y })
      const delta = { x: to.x - from.x, y: to.y - from.y }
      // Outside every map: they wait at their last place inside.
      this.moveActors(d.from, delta, d.befores)
      return this.emit()
    }
    if (d.kind === 'box') {
      d.end = { x: p.x, y: p.y }
      const box = this.selectBox!
      this.selection = new Set(d.base)
      for (const t of this.actorsInDepthOrder()) {
        const r = this.actorRect(t)
        if (r.x < box.x + box.w && box.x < r.x + r.w && r.y < box.y + box.h && box.y < r.y + r.h) this.selection.add(t.actor)
      }
      return this.emit()
    }
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
        this.maps.set(d.name, reframe(d.before, r.x, r.y, r.w, r.h, this.tileSize))
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
    if (d.kind === 'actors') {
      this.record(d.befores)
      return this.emit()
    }
    if (d.kind === 'box') return this.emit()
    const map = this.maps.get(d.name)
    if (!map) return this.emit()
    if (d.kind === 'place') {
      const mine = this.cellRect(d.name)!
      const others = this.othersThan(d.name)
      // Maps never overlap (they may touch): closest free place.
      if (others.some((o) => overlaps(mine, o))) Object.assign(map, findFreeSpot(mine.w, mine.h, mine, others, 0))
    }
    this.record(new Map([[d.name, d.before]]))
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

  /** Keeps a change of the maps that changed (from their state before), and has them saved. */
  private record(befores: Map<string, GameMap>) {
    const maps: MapChange[] = []
    for (const [name, before] of befores) {
      const after = this.maps.get(name)
      if (after && !sameMap(before, after)) maps.push({ name, before, after: cloneMap(after) })
    }
    if (!maps.length) return
    this.history.push({ maps })
    for (const m of maps) this.onEdit(m.name)
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
    if (c) this.restore(c.maps.map((m) => [m.name, m.before]))
  }

  redo() {
    if (this.drag) return
    const c = this.history.redo()
    if (c) this.restore(c.maps.map((m) => [m.name, m.after]))
  }

  private restore(states: [string, GameMap][]) {
    for (const [name, map] of states) {
      if (!this.maps.has(name)) continue
      this.maps.set(name, cloneMap(map))
      this.active = name
      this.onEdit(name)
    }
    // The maps are copies now: the actors selected are no longer in them.
    this.selection = new Set()
    this.emit()
  }
}

function sameMap(a: GameMap, b: GameMap) {
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false
  if (a.actors.length !== b.actors.length) return false
  if (a.actors.some((t, i) => t.type !== b.actors[i].type || t.x !== b.actors[i].x || t.y !== b.actors[i].y)) return false
  return a.cells.every((c, i) => {
    const o = b.cells[i]
    return c === o || (!!c && !!o && c.tileset === o.tileset && c.col === o.col && c.row === o.row)
  })
}

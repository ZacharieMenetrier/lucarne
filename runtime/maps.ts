// The game's maps (maps/*.json) and the tilesets they take their tiles from (tiles/*.png).
//
// The whole game sits in one world: each map has its place in it, and every map is there
// from the start. The engine draws them itself, under the actors, and the camera stays
// inside the map that holds the actor it follows (see world.ts). Nothing to write in the
// game's code to see them: a door to another map is `hero.place(x, y)`, and `map(name)` or
// `mapAt(x, y)` say where a map is (to place an actor in it, or keep it inside).
//
// A map also says which actors stand in it when the game starts (see `placeActors` in
// world.ts): actors/villager.ts says what a villager is, the map says where each one
// starts, and what this one does differently (its values).
//
// The editor loads every tileset and map before the game's code runs.

import { drawTile } from './screen'

/** A tile: a cell of a tileset, by its column and row (they stay put when a tileset grows). */
export interface Tile {
  tileset: string
  col: number
  row: number
}

/**
 * An actor placed on a map: its name (its file in actors/), where it starts (its feet), in
 * game pixels from the map's top left corner, and the values set for this one alone (see
 * values.ts). Placed actors move with their map.
 */
export interface Placement {
  actor: string
  x: number
  y: number
  values: Record<string, unknown>
}

/** A map as the editor hands it to the engine. Positions and sizes are in cells. */
export interface MapData {
  name: string
  x: number
  y: number
  width: number
  height: number
  /** Row by row from the top left; null for an empty cell (the background shows). */
  cells: (Tile | null)[]
  /** The actors that start in it, in the order they are created. */
  actors: Placement[]
}

/**
 * The solid part of a tile (tiles/<name>.json): one rectangle, in pixels inside the tile.
 * A tile has at most one; a tile without one is not solid.
 */
export interface TileBox {
  column: number
  row: number
  x: number
  y: number
  width: number
  height: number
}

export interface TilesetData {
  name: string
  /** Its pixels: whole tiles, `tileSize` wide and high. */
  sheet: CanvasImageSource
  /** Its solid tiles (none if left out). */
  solid?: TileBox[]
}

/** A rectangle in the world, in game pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A map's place in the world, in game pixels. */
export interface MapRect {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

let size = 16
let maps: MapData[] = []
let sheets = new Map<string, CanvasImageSource>()
/** Solid tiles by tileset, then by "column,row". */
let solids = new Map<string, Map<string, TileBox>>()

/** Called by the editor before the game's code runs. */
export function setMaps(tileSize: number, tilesets: TilesetData[], list: MapData[]) {
  size = tileSize
  sheets = new Map(tilesets.map((t) => [t.name, t.sheet]))
  solids = new Map(tilesets.map((t) => [t.name, new Map((t.solid ?? []).map((b) => [`${b.column},${b.row}`, b]))]))
  maps = list
}

/** The map holding a cell, if any. */
function mapOfCell(cx: number, cy: number): MapData | undefined {
  return maps.find((m) => cx >= m.x && cy >= m.y && cx < m.x + m.width && cy < m.y + m.height)
}

/**
 * Pushes into `out` the solid rectangles (world pixels) of the cells that a rectangle of
 * the world touches: the solid part of each tile there, and every cell outside the maps,
 * whole. The camera never leaves the maps, so neither does anything that collides: the
 * space between them is a wall. A game with no maps has no walls at all.
 */
export function solidsIn(left: number, top: number, right: number, bottom: number, out: Rect[]) {
  if (!maps.length) return
  const x0 = Math.floor(left / size)
  const y0 = Math.floor(top / size)
  const x1 = Math.ceil(right / size) - 1
  const y1 = Math.ceil(bottom / size) - 1
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const m = mapOfCell(cx, cy)
      if (!m) {
        out.push({ x: cx * size, y: cy * size, width: size, height: size })
        continue
      }
      const t = m.cells[(cy - m.y) * m.width + (cx - m.x)]
      const b = t && solids.get(t.tileset)?.get(`${t.col},${t.row}`)
      if (b) out.push({ x: cx * size + b.x, y: cy * size + b.y, width: b.width, height: b.height })
    }
  }
}

/** The map under a world point (game pixels), or null between maps. Maps never overlap. */
export function mapAt(x: number, y: number): MapRect | null {
  const m = mapOfCell(Math.floor(x / size), Math.floor(y / size))
  return m ? rectOf(m) : null
}

/**
 * A map's place in the world (game pixels), by its name (its file name, without `.json`):
 * where to put the hero, or the edges to keep it in. Throws if the game has no such map.
 */
export function map(name: string): MapRect {
  const m = maps.find((m) => m.name === name)
  if (!m) throw new Error(`No map named "${name}" in maps/`)
  return rectOf(m)
}

/**
 * Every actor placed on the maps, in the world (game pixels): map by map, by name, then in
 * each map's order. The same order every time, so updates run in the same order too.
 */
export function placements(): (Placement & { map: string })[] {
  return [...maps]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((m) => m.actors.map((t) => ({ ...t, map: m.name, x: m.x * size + t.x, y: m.y * size + t.y })))
}

function rectOf(m: MapData): MapRect {
  return { name: m.name, x: m.x * size, y: m.y * size, width: m.width * size, height: m.height * size }
}

/**
 * Draws the tiles seen by a camera at (camX, camY) showing `width` × `height` game pixels.
 * Only the tiles on screen are drawn, from the tilesets themselves (no picture of the map
 * is kept), so a tileset or a map can change at any time.
 */
export function drawMaps(camX: number, camY: number, width: number, height: number) {
  const left = Math.floor(camX / size)
  const top = Math.floor(camY / size)
  const right = Math.floor((camX + width) / size)
  const bottom = Math.floor((camY + height) / size)
  for (const m of maps) {
    const x0 = Math.max(left, m.x)
    const y0 = Math.max(top, m.y)
    const x1 = Math.min(right, m.x + m.width - 1)
    const y1 = Math.min(bottom, m.y + m.height - 1)
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const t = m.cells[(cy - m.y) * m.width + (cx - m.x)]
        const sheet = t && sheets.get(t.tileset)
        if (sheet) drawTile(sheet, t.col * size, t.row * size, size, cx * size, cy * size)
      }
    }
  }
}

// The game's maps (maps/*.json) and the tilesets they take their tiles from (tiles/*.png).
//
// The whole game sits in one world: each map has its place in it, and every map is there
// from the start. The engine draws them itself, under the things, and the camera stays
// inside the map that holds the thing it follows (see world.ts). Nothing to write in the
// game's code: a door to another map is `hero.place(x, y)`.
//
// The editor loads every tileset and map before the game's code runs.

import { drawTile } from './screen'

/** A tile: a cell of a tileset, by its column and row (they stay put when a tileset grows). */
export interface Tile {
  tileset: string
  col: number
  row: number
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
}

export interface TilesetData {
  name: string
  /** Its pixels: whole tiles, `tileSize` wide and high. */
  sheet: CanvasImageSource
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

/** Called by the editor before the game's code runs. */
export function setMaps(tileSize: number, tilesets: TilesetData[], list: MapData[]) {
  size = tileSize
  sheets = new Map(tilesets.map((t) => [t.name, t.sheet]))
  maps = list
}

/** The map under a world point (game pixels), or null between maps. Maps never overlap. */
export function mapAt(x: number, y: number): MapRect | null {
  const cx = Math.floor(x / size)
  const cy = Math.floor(y / size)
  const m = maps.find((m) => cx >= m.x && cy >= m.y && cx < m.x + m.width && cy < m.y + m.height)
  return m ? rectOf(m) : null
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

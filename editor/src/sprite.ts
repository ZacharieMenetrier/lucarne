// A sprite = a PNG sheet + a JSON file, in sprites/.
//
// The sheet is a strip: the animation frames side by side, left to right, all
// the same size.
//
//   sprites/hero.png
//   sprites/hero.json  { "version": 1, "frameWidth": 16, "frameHeight": 16,
//                        "frames": [{ "duration": 100 }] }

import { Bitmap, blit, extract } from './bitmap'
import type { TileBox } from '../../runtime/maps'

export type { TileBox }

export interface SpriteMeta {
  version: 1
  frameWidth: number
  frameHeight: number
  /** One entry per frame; duration in milliseconds. */
  frames: { duration: number }[]
  /** Origin pixel of the sprite (where it is anchored in the game), if set. */
  origin?: { x: number; y: number }
  /** A tileset's solid tiles (tiles/<name>.json), sorted by row then column. */
  solid?: TileBox[]
}

export interface Sprite {
  name: string
  meta: SpriteMeta
  /** The animation frames, in order. */
  frames: Bitmap[]
}

export const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

/**
 * Tilesets (tiles/<name>.png) sit on the board like sprites, under the name "tiles/<name>":
 * a tileset and a sprite may then share a name. A tileset is one image: the game's tile
 * size says how to cut it, so it has no animation and no origin. Its JSON
 * (tiles/<name>.json) only says which tiles are solid, and exists only when some are.
 */
export const TILESET_PREFIX = 'tiles/'

/**
 * A tileset is always this many tiles wide; it grows only in rows. One width for every
 * tileset keeps the panel that picks tiles one picture wide at a readable scale, and a tile
 * keeps its column when rows are added.
 */
export const TILESET_COLUMNS = 8

export function isTileset(name: string) {
  return name.startsWith(TILESET_PREFIX)
}

/** "tiles/outdoor" → "outdoor". */
export function tilesetName(boardName: string) {
  return boardName.slice(TILESET_PREFIX.length)
}

/** "outdoor" → "tiles/outdoor". */
export function tilesetKey(name: string) {
  return TILESET_PREFIX + name
}
export const MAX_SIZE = 512

export function defaultMeta(frameWidth: number, frameHeight: number): SpriteMeta {
  return {
    version: 1,
    frameWidth,
    frameHeight,
    frames: [{ duration: 100 }],
  }
}

export function newSprite(name: string, width: number, height: number): Sprite {
  return { name, meta: defaultMeta(width, height), frames: [new Bitmap(width, height)] }
}

function positiveInt(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback
}

/** Reads a sprite JSON, tolerating missing fields (and ignoring unknown ones). */
export function parseMeta(text: string): SpriteMeta {
  const raw = JSON.parse(text) as Partial<SpriteMeta>
  const frames = Array.isArray(raw.frames) && raw.frames.length
    ? raw.frames.map((f) => ({ duration: positiveInt(f?.duration, 100) }))
    : [{ duration: 100 }]
  const o = raw.origin
  const origin = o && Number.isInteger(o.x) && Number.isInteger(o.y) ? { x: o.x, y: o.y } : undefined
  return {
    version: 1,
    frameWidth: positiveInt(raw.frameWidth, 16),
    frameHeight: positiveInt(raw.frameHeight, 16),
    frames,
    ...(origin && { origin }),
  }
}

/** Readable JSON: one line per frame, for clean Git diffs. */
export function serializeMeta(meta: SpriteMeta): string {
  const obj = (o: object) =>
    `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`
  const list = (items: object[]) =>
    items.length === 1 ? `[${obj(items[0])}]` : `[\n${items.map((i) => `    ${obj(i)}`).join(',\n')}\n  ]`
  return [
    '{',
    `  "version": ${meta.version},`,
    `  "frameWidth": ${meta.frameWidth},`,
    `  "frameHeight": ${meta.frameHeight},`,
    `  "frames": ${list(meta.frames)}${meta.origin ? ',' : ''}`,
    ...(meta.origin ? [`  "origin": ${obj(meta.origin)}`] : []),
    '}',
    '',
  ].join('\n')
}

export function splitSheet(sheet: Bitmap, meta: SpriteMeta): Bitmap[] {
  const { frameWidth: w, frameHeight: h } = meta
  return meta.frames.map((_, i) => extract(sheet, { x: i * w, y: 0, w, h }))
}

export function composeSheet(sprite: Sprite): Bitmap {
  const { frameWidth: w, frameHeight: h, frames } = sprite.meta
  const sheet = new Bitmap(w * frames.length, h)
  sprite.frames.forEach((bmp, i) => blit(sheet, bmp, i * w, 0, false))
  return sheet
}

/**
 * Reads tiles/<name>.json: the solid tiles, each one rectangle inside its tile. Rectangles
 * that do not fit in a tile of `tileSize` are cut to it, empty ones are dropped, and a
 * tile listed twice keeps its last one.
 */
export function parseTileBoxes(text: string, tileSize: number): TileBox[] {
  const raw = JSON.parse(text) as { solid?: unknown }
  const byTile = new Map<string, TileBox>()
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN)
  for (const b of Array.isArray(raw?.solid) ? (raw.solid as Record<string, unknown>[]) : []) {
    const column = int(b?.column)
    const row = int(b?.row)
    const x = Math.max(0, int(b?.x))
    const y = Math.max(0, int(b?.y))
    const width = Math.min(tileSize - x, int(b?.width) - (x - int(b?.x)))
    const height = Math.min(tileSize - y, int(b?.height) - (y - int(b?.y)))
    if (!(column >= 0 && column < TILESET_COLUMNS && row >= 0 && width > 0 && height > 0)) continue
    byTile.set(`${column},${row}`, { column, row, x, y, width, height })
  }
  return sortTileBoxes([...byTile.values()])
}

export function sortTileBoxes(boxes: TileBox[]): TileBox[] {
  return boxes.sort((a, b) => a.row - b.row || a.column - b.column)
}

/** tiles/<name>.json: one line per solid tile, for clean Git diffs. */
export function serializeTileBoxes(boxes: TileBox[]): string {
  const line = (b: TileBox) =>
    `    { "column": ${b.column}, "row": ${b.row}, "x": ${b.x}, "y": ${b.y}, "width": ${b.width}, "height": ${b.height} }`
  return ['{', '  "version": 1,', '  "solid": [', sortTileBoxes([...boxes]).map(line).join(',\n'), '  ]', '}', ''].join('\n')
}

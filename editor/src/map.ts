// A map = maps/<name>.json: its place in the world, its size, and its cells, all in cells.
//
//   {
//     "version": 1,
//     "x": 0, "y": 0, "width": 24, "height": 14,
//     "tilesets": ["outdoor", "house"],
//     "cells": [
//       [0, 3, 1], [0, 3, 1], null, …,      one line per row of the map
//       …
//     ],
//     "actors": [
//       { "type": "Villager", "x": 40, "y": 96 },  one line per actor
//       …
//     ]
//   }
//
// A cell is [tileset, column, row]: the tileset by its place in "tilesets", then the tile
// by its column and row in that tileset. null is an empty cell. "tilesets" lists only the
// tilesets the map uses.
//
// An actor is the name its class is exported under from code/main.ts, and where its feet
// are, in game pixels from the map's top left corner: actors move with their map. A map
// without actors has no "actors".

import type { MapData, Placement, Tile } from '../../runtime/maps'

export type { Placement, Tile }
export type GameMap = MapData

export function newMap(name: string, x: number, y: number, width: number, height: number): GameMap {
  return { name, x, y, width, height, cells: new Array<Tile | null>(width * height).fill(null), actors: [] }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Reads a map file, tolerating what it can: a broken cell is an empty one. */
export function parseMap(name: string, text: string): GameMap {
  const raw = JSON.parse(text) as Record<string, unknown>
  const size = (v: unknown) => (isInt(v) && v > 0 ? v : 1)
  const map = newMap(name, isInt(raw.x) ? raw.x : 0, isInt(raw.y) ? raw.y : 0, size(raw.width), size(raw.height))
  const tilesets = Array.isArray(raw.tilesets) ? raw.tilesets.map(String) : []
  const cells = Array.isArray(raw.cells) ? raw.cells : []
  for (let i = 0; i < map.cells.length; i++) {
    const c = cells[i] as unknown
    if (!Array.isArray(c) || c.length !== 3 || !c.every(isInt)) continue
    const [t, col, row] = c as number[]
    if (tilesets[t] === undefined || col < 0 || row < 0) continue
    map.cells[i] = { tileset: tilesets[t], col, row }
  }
  // A broken actor is left out; one outside the map too (it could never be selected).
  const actors = Array.isArray(raw.actors) ? raw.actors : []
  for (const t of actors as Record<string, unknown>[]) {
    if (!t || typeof t.type !== 'string' || !t.type || typeof t.x !== 'number' || typeof t.y !== 'number') continue
    if (!insideMap(map, t.x, t.y)) continue
    map.actors.push({ type: t.type, x: t.x, y: t.y })
  }
  return map
}

/**
 * Is an actor at (x, y), in pixels from the map's top left, in the map? Its feet stand on
 * the pixel just above y: an actor at the bottom edge stands on the map's last row.
 */
export function insideMap(map: GameMap, x: number, y: number, tileSize = 0) {
  const w = tileSize ? map.width * tileSize : Infinity
  const h = tileSize ? map.height * tileSize : Infinity
  return x >= 0 && y > 0 && x < w && y <= h
}

/** Readable JSON, one line per row, for clean Git diffs. */
export function serializeMap(map: GameMap): string {
  const tilesets = tilesetsOf(map)
  const index = new Map(tilesets.map((t, i) => [t, i]))
  const cell = (t: Tile | null) => (t ? `[${index.get(t.tileset)}, ${t.col}, ${t.row}]` : 'null')
  const rows: string[] = []
  for (let y = 0; y < map.height; y++) {
    rows.push(`    ${map.cells.slice(y * map.width, (y + 1) * map.width).map(cell).join(', ')}`)
  }
  return [
    '{',
    '  "version": 1,',
    `  "x": ${map.x}, "y": ${map.y}, "width": ${map.width}, "height": ${map.height},`,
    `  "tilesets": ${JSON.stringify(tilesets)},`,
    '  "cells": [',
    rows.join(',\n'),
    map.actors.length ? '  ],' : '  ]',
    ...(map.actors.length
      ? ['  "actors": [', map.actors.map((t) => `    { "type": ${JSON.stringify(t.type)}, "x": ${t.x}, "y": ${t.y} }`).join(',\n'), '  ]']
      : []),
    '}',
    '',
  ].join('\n')
}

/** The tilesets a map uses, sorted. */
export function tilesetsOf(map: GameMap): string[] {
  const names = new Set<string>()
  for (const c of map.cells) if (c) names.add(c.tileset)
  return [...names].sort()
}

export function cloneMap(map: GameMap): GameMap {
  return { ...map, cells: map.cells.map((c) => (c ? { ...c } : null)), actors: map.actors.map((t) => ({ ...t })) }
}

/** The cell at a world cell, or undefined outside the map. */
export function cellAt(map: GameMap, cx: number, cy: number): Tile | null | undefined {
  const x = cx - map.x
  const y = cy - map.y
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined
  return map.cells[y * map.width + x]
}

/** Sets the cell at a world cell; false if it is outside the map or unchanged. */
export function setCell(map: GameMap, cx: number, cy: number, tile: Tile | null): boolean {
  const before = cellAt(map, cx, cy)
  if (before === undefined) return false
  if (before === tile || (before && tile && sameTile(before, tile))) return false
  map.cells[(cy - map.y) * map.width + (cx - map.x)] = tile && { ...tile }
  return true
}

export function sameTile(a: Tile | null, b: Tile | null) {
  return a === b || (!!a && !!b && a.tileset === b.tileset && a.col === b.col && a.row === b.row)
}

/**
 * The map moved to a new place and size in the world (in cells): its tiles and actors stay
 * where they are in the world, cells are added or dropped at the edges, and the actors
 * left outside are dropped.
 */
export function reframe(map: GameMap, x: number, y: number, width: number, height: number, tileSize: number): GameMap {
  const out = newMap(map.name, x, y, width, height)
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      const t = cellAt(map, cx, cy)
      if (t) out.cells[(cy - y) * width + (cx - x)] = { ...t }
    }
  }
  const dx = (map.x - x) * tileSize
  const dy = (map.y - y) * tileSize
  for (const t of map.actors) {
    const moved = { type: t.type, x: t.x + dx, y: t.y + dy }
    if (insideMap(out, moved.x, moved.y, tileSize)) out.actors.push(moved)
  }
  return out
}

/** Renames a tileset in a map's cells. Returns whether the map changed. */
export function renameTileset(map: GameMap, from: string, to: string): boolean {
  let changed = false
  for (const c of map.cells) {
    if (c?.tileset === from) {
      c.tileset = to
      changed = true
    }
  }
  return changed
}

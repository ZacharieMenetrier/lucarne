// A map = maps/<name>.json: its place in the world, its size, and its cells, all in cells.
//
//   {
//     "version": 1,
//     "x": 0, "y": 0, "width": 24, "height": 14,
//     "tilesets": ["outdoor", "house"],
//     "cells": [
//       [0, 3, 1], [0, 3, 1], null, …,      one line per row of the map
//       …
//     ]
//   }
//
// A cell is [tileset, column, row]: the tileset by its place in "tilesets", then the tile
// by its column and row in that tileset. null is an empty cell. "tilesets" lists only the
// tilesets the map uses.

import type { MapData, Tile } from '../../runtime/maps'

export type { Tile }
export type GameMap = MapData

export function newMap(name: string, x: number, y: number, width: number, height: number): GameMap {
  return { name, x, y, width, height, cells: new Array<Tile | null>(width * height).fill(null) }
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
  return map
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
    '  ]',
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
  return { ...map, cells: map.cells.map((c) => (c ? { ...c } : null)) }
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
 * The map moved to a new place and size in the world (in cells): its tiles stay where they
 * are in the world, cells are added or dropped at the edges.
 */
export function reframe(map: GameMap, x: number, y: number, width: number, height: number): GameMap {
  const out = newMap(map.name, x, y, width, height)
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      const t = cellAt(map, cx, cy)
      if (t) out.cells[(cy - y) * width + (cx - x)] = { ...t }
    }
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

// The board: where each sprite sits, so they can all be seen side by side.
// Saved in board.json, one line per sprite for clean Git diffs:
//
//   {
//     "version": 1,
//     "background": "#2a2a33",
//     "sprites": {
//       "hero": { "x": 0, "y": 0 },
//       "slime": { "x": 24, "y": 0 }
//     }
//   }
//
// Coordinates are in sprite pixels. "background" is the board color chosen
// for this game (absent: the editor's default). Only the editor reads this file.

import type { Point, Rect } from './bitmap'
import { isHex } from './color'

export type Placements = Map<string, Point>

export interface BoardFile {
  placements: Placements
  /** Board color, "#rrggbb", or null for the editor's default. */
  background: string | null
}

/** Space kept between sprites placed automatically, in sprite pixels. */
export const BOARD_GAP = 8

export function parseBoard(text: string): BoardFile {
  const raw = JSON.parse(text) as { background?: unknown; sprites?: Record<string, { x?: unknown; y?: unknown }> }
  const placements: Placements = new Map()
  const sprites = raw?.sprites
  if (sprites && typeof sprites === 'object') {
    for (const [name, p] of Object.entries(sprites)) {
      if (Number.isInteger(p?.x) && Number.isInteger(p?.y)) placements.set(name, { x: p.x as number, y: p.y as number })
    }
  }
  const bg = raw?.background
  const background = typeof bg === 'string' && isHex(bg) ? `#${bg.trim().replace('#', '').slice(0, 6).toLowerCase()}` : null
  return { placements, background }
}

export function serializeBoard({ placements, background }: BoardFile): string {
  const lines = [...placements.keys()]
    .sort()
    .map((name) => {
      const p = placements.get(name)!
      return `    ${JSON.stringify(name)}: { "x": ${p.x}, "y": ${p.y} }`
    })
  const body = lines.length ? `\n${lines.join(',\n')}\n  ` : ''
  const bg = background ? `\n  "background": ${JSON.stringify(background)},` : ''
  return `{\n  "version": 1,${bg}\n  "sprites": {${body}}\n}\n`
}

export function overlaps(a: Rect, b: Rect, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Closest spot to `near` (desired top-left) where a w×h sprite overlaps
 * nothing, keeping `gap` pixels from the others. The closest spot is either
 * `near` itself or flush against an edge of another sprite, so only those
 * positions are tried.
 */
export function findFreeSpot(w: number, h: number, near: Point, taken: Rect[], gap = BOARD_GAP): Point {
  const nx = Math.round(near.x)
  const ny = Math.round(near.y)
  const xs = new Set([nx])
  const ys = new Set([ny])
  for (const r of taken) {
    xs.add(r.x - w - gap).add(r.x + r.w + gap)
    ys.add(r.y - h - gap).add(r.y + r.h + gap)
  }
  const candidates: { x: number; y: number; d: number }[] = []
  for (const x of xs) for (const y of ys) candidates.push({ x, y, d: Math.hypot(x - nx, y - ny) })
  candidates.sort((a, b) => a.d - b.d)
  for (const { x, y } of candidates) {
    if (!taken.some((r) => overlaps({ x, y, w, h }, r, gap))) return { x, y }
  }
  return { x: nx, y: ny }
}

/**
 * Lays sprites out in rows, left to right, starting at `origin`.
 * Used for sprites that have no position yet (first opening, files added by hand).
 */
export function shelfLayout(items: { name: string; w: number; h: number }[], origin: Point, gap = BOARD_GAP): Placements {
  const out: Placements = new Map()
  if (!items.length) return out
  const area = items.reduce((sum, i) => sum + (i.w + gap) * (i.h + gap), 0)
  const maxWidth = Math.max(Math.ceil(Math.sqrt(area) * 1.6), ...items.map((i) => i.w))
  let x = origin.x
  let y = origin.y
  let rowHeight = 0
  for (const item of items) {
    if (x > origin.x && x - origin.x + item.w > maxWidth) {
      x = origin.x
      y += rowHeight + gap
      rowHeight = 0
    }
    out.set(item.name, { x, y })
    x += item.w + gap
    rowHeight = Math.max(rowHeight, item.h)
  }
  return out
}

/**
 * Moves sprites out of each other's way. `fixed` sprites stay put; each of
 * `movers` that overlaps something goes to the closest free spot (touching is
 * allowed). Returns the new positions of the sprites that moved.
 */
export function resolveOverlaps(fixed: Rect[], movers: { name: string; rect: Rect }[]): Placements {
  const out: Placements = new Map()
  const taken = [...fixed]
  for (const { name, rect } of movers) {
    if (taken.some((r) => overlaps(rect, r))) {
      const p = findFreeSpot(rect.w, rect.h, rect, taken, 0)
      out.set(name, p)
      taken.push({ ...rect, ...p })
    } else {
      taken.push(rect)
    }
  }
  return out
}

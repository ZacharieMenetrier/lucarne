// Walls: how an actor with a box moves among the solid things of the world.
//
//   class Hero extends Actor {
//     update() { this.move(input.x, input.y) }   // slides along walls by itself
//   }
//
// An actor's box is drawn on the Actors page and saved in actors.json, by class name: the
// code writes nothing. It is a rectangle placed around the actor's feet (its position, the
// origin of its sprite), the same on every frame: a box that changed with the animation
// would push the actor into walls.
//
// The walls are given by the caller (see `move` in world.ts): the solid parts of tiles,
// everything outside the maps, and the boxes of the other actors. A move goes along x,
// then along y, each stopping at the nearest wall on its way: what the wall stops on one
// axis, the other keeps, so an actor slides along walls. The way is swept, not stepped, so
// no speed goes through a wall, however thin.

import type { Rect } from './maps'

/** An actor's box: a rectangle in game pixels, (x, y) its top left relative to the feet. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Pushes into `out` the walls that touch a rectangle of the world (left, top, right, bottom). */
export type Walls = (left: number, top: number, right: number, bottom: number, out: Rect[]) => void

/** The walls of the move under way (set by `collide`). */
let solidsIn: Walls = () => {}

/**
 * How far a wall may be crossed before it counts. Positions have decimals, and an actor
 * stopped exactly against a wall must not count as inside it on the next move.
 */
const EPS = 1e-6

/**
 * Corners: an actor that runs into the corner of a wall by at most this share of its box
 * (across its way) is nudged around it instead of stopping dead. Without it, walking into
 * a corridor one tile wide means lining up to the pixel. Half the box forgives as much as
 * possible while still meaning "almost in line": past half, the other side is closer.
 */
const CORNER = 1 / 2

const found: Rect[] = []

/** A box at (x, y): its edges. */
function edges(x: number, y: number, box: Box) {
  return { l: x + box.x, r: x + box.x + box.width, t: y + box.y, b: y + box.y + box.height }
}

function overlaps(s: Rect, l: number, t: number, r: number, b: number) {
  return s.x < r - EPS && s.x + s.width > l + EPS && s.y < b - EPS && s.y + s.height > t + EPS
}

/**
 * How far a box at (x, y) can go by `d` along one axis before a wall: `d` itself when
 * nothing is in the way. Walls the box is already in are ignored, so an actor placed inside
 * one can always walk out of it.
 */
function reach(x: number, y: number, box: Box, axis: 'x' | 'y', d: number): number {
  if (!d) return 0
  const { l, t, r, b } = edges(x, y, box)
  const dx = axis === 'x' ? d : 0
  const dy = axis === 'y' ? d : 0
  found.length = 0
  solidsIn(Math.min(l, l + dx), Math.min(t, t + dy), Math.max(r, r + dx), Math.max(b, b + dy), found)
  let go = d
  for (const s of found) {
    if (overlaps(s, l, t, r, b)) continue
    if (axis === 'x') {
      if (s.y >= b - EPS || s.y + s.height <= t + EPS) continue
      if (d > 0 && s.x >= r - EPS) go = Math.min(go, Math.max(0, s.x - r))
      if (d < 0 && s.x + s.width <= l + EPS) go = Math.max(go, Math.min(0, s.x + s.width - l))
    } else {
      if (s.x >= r - EPS || s.x + s.width <= l + EPS) continue
      if (d > 0 && s.y >= b - EPS) go = Math.min(go, Math.max(0, s.y - b))
      if (d < 0 && s.y + s.height <= t + EPS) go = Math.max(go, Math.min(0, s.y + s.height - t))
    }
  }
  return go
}

/**
 * After a move along `axis` stopped against a wall with `left` still to go: if the box
 * only clips the wall's corner, how far to slide across (signed), at most `left`; else 0.
 */
function aroundCorner(x: number, y: number, box: Box, axis: 'x' | 'y', left: number): number {
  const { l, t, r, b } = edges(x, y, box)
  const ahead = Math.sign(left)
  // The walls touching the box on the side it was going to.
  found.length = 0
  if (axis === 'x') solidsIn(ahead > 0 ? r : l - 1, t, ahead > 0 ? r + 1 : l, b, found)
  else solidsIn(l, ahead > 0 ? b : t - 1, r, ahead > 0 ? b + 1 : t, found)
  let lo = Infinity
  let hi = -Infinity
  for (const s of found) {
    if (overlaps(s, l, t, r, b)) continue
    const touching =
      axis === 'x'
        ? (ahead > 0 ? Math.abs(s.x - r) : Math.abs(s.x + s.width - l)) <= EPS && s.y < b - EPS && s.y + s.height > t + EPS
        : (ahead > 0 ? Math.abs(s.y - b) : Math.abs(s.y + s.height - t)) <= EPS && s.x < r - EPS && s.x + s.width > l + EPS
    if (!touching) continue
    lo = Math.min(lo, axis === 'x' ? s.y : s.x)
    hi = Math.max(hi, axis === 'x' ? s.y + s.height : s.x + s.width)
  }
  if (lo === Infinity) return 0
  const across = axis === 'x' ? 'y' : 'x'
  const size = axis === 'x' ? box.height : box.width
  // To pass before the walls (up, or left) or after them (down, or right).
  const before = (axis === 'x' ? b : r) - lo
  const after = hi - (axis === 'x' ? t : l)
  const ways = [-before, after].filter((w) => Math.abs(w) <= size * CORNER).sort((p, q) => Math.abs(p) - Math.abs(q))
  for (const w of ways) {
    // Only toward a way that is open: free once there, and free to go on.
    const nx = across === 'x' ? x + w : x
    const ny = across === 'y' ? y + w : y
    if (reach(x, y, box, across, w) !== w) continue
    if (reach(nx, ny, box, axis, ahead) === 0) continue
    return Math.sign(w) * Math.min(Math.abs(w), Math.abs(left))
  }
  return 0
}

/**
 * Moves a box at (x, y) by (dx, dy) among `walls`: along x, then along y, each stopping at
 * the first wall, and around corners it only clips. Returns where it ends, and whether it
 * went the whole way.
 */
export function collide(x: number, y: number, box: Box, dx: number, dy: number, walls: Walls) {
  solidsIn = walls
  let whole = true
  const gx = reach(x, y, box, 'x', dx)
  x += gx
  if (gx !== dx) {
    whole = false
    if (!dy) y += aroundCorner(x, y, box, 'x', dx - gx)
  }
  const gy = reach(x, y, box, 'y', dy)
  y += gy
  if (gy !== dy) {
    whole = false
    if (!dx) x += aroundCorner(x, y, box, 'y', dy - gy)
  }
  return { x, y, whole }
}

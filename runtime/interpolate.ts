// Pairs what the game drew in one update with what it drew in the update before, so that
// each displayed frame can draw what moved between its two positions. The game says
// nothing about what is what: things are recognized by what they look like and where
// they are.

import type { Command } from './screen'

/**
 * Farther than this in one update (in game pixels, on either axis), a thing jumped: a
 * teleport, a new room. It is then drawn where it is, without in-between positions.
 */
export const JUMP = 8

type Placed = Exclude<Command, { kind: 'clear' }>

/**
 * Sets `from` on what moved in `next` since `previous`. In three passes, each on what
 * the passes before left unpaired:
 *
 * 1. the same thing at the same place: it did not move (most of the world);
 * 2. the same thing (same sprite, same rectangle), the nearest one: two identical bats
 *    each keep their own path, even when the order they are drawn in changes;
 * 3. any sprite, the nearest one: an animation that switches sprites (hero_run_east to
 *    hero_idle_east as the hero stops) still moves along, in step with the rest.
 *
 * What is left is new, or jumped: drawn where it is.
 */
export function link(previous: readonly Command[], next: readonly Command[]) {
  const before = previous.filter(isPlaced)
  const now = next.filter(isPlaced)
  for (const c of now) c.from = undefined
  const used = new Set<Placed>()

  // 1. Not moved: matched by place, in constant time (the world can have many things).
  const byPlace = new Map<string, Placed[]>()
  for (const p of before) {
    const k = place(p)
    const list = byPlace.get(k)
    if (list) list.push(p)
    else byPlace.set(k, [p])
  }
  let moved: Placed[] = []
  for (const c of now) {
    const p = byPlace.get(place(c))?.pop()
    if (p) used.add(p)
    else moved.push(c)
  }
  if (moved.length === 0) return

  const candidates = before.filter((p) => !used.has(p))
  // 2. The same thing, nearest. 3. Any sprite, nearest.
  moved = pair(moved, candidates, used, (c, p) => c.key === p.key)
  pair(moved, candidates, used, (c, p) => c.kind === 'sprite' && p.kind === 'sprite')
}

/** Pairs each thing with the nearest unused candidate within a jump; returns the unpaired. */
function pair(things: Placed[], candidates: Placed[], used: Set<Placed>, alike: (c: Placed, p: Placed) => boolean) {
  const unpaired: Placed[] = []
  for (const c of things) {
    let best: Placed | null = null
    let bestDistance = JUMP
    for (const p of candidates) {
      if (used.has(p) || !alike(c, p)) continue
      const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y))
      if (d <= bestDistance) {
        best = p
        bestDistance = d
      }
    }
    if (best) {
      used.add(best)
      c.from = { x: best.x, y: best.y }
    } else unpaired.push(c)
  }
  return unpaired
}

function isPlaced(c: Command): c is Placed {
  return c.kind !== 'clear'
}

function place(c: Placed) {
  return `${c.key} ${c.x} ${c.y}`
}

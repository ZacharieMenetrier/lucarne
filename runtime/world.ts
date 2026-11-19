// The world: the game's things, the camera, and the order in which they update and draw.
//
//   class Hero extends Thing {
//     update() { this.move(input.x, input.y) }     // 60 times per second
//     draw() { screen.sprite(sprite('hero'), 0, 0) } // around itself: (0, 0) is where it is
//   }
//   const hero = new Hero(100, 80)                  // creating a thing puts it in the world
//   camera.follow(hero)
//
// Things update 60 times per second, in the order they were created. Displays refresh at
// other rates (120 Hz, 144 Hz…), so each displayed frame draws every thing between where it
// was before its last update and where it is now: motion is smooth on any display, and the
// game's code never sees it. A thing that `place`s itself, or was just created, is drawn
// where it is, with no in-between.

import { drawMaps, mapAt } from './maps'
import { beginDraw, endDraw, setOrigin, screen, screenScale } from './screen'

/** Where the engine keeps its own state on each thing (a symbol: games never see it). */
const track = Symbol('lucarne')

interface Track {
  /** Where the thing was before its last update. */
  fromX: number
  fromY: number
  /** Drawn where it is, without in-between, until its next update (new, or placed). */
  jumped: boolean
  removed: boolean
  /** Creation order: updates follow it, and it breaks ties in the depth order. */
  order: number
  /** Where it is shown on the frame being drawn: its depth. */
  shownY: number
}

let things: Thing[] = []
let created = 0
let anyRemoved = false

/**
 * Something in the game's world. Extend it; creating one puts it in the world.
 *
 * - `update()` runs 60 times per second, for every thing, in the order they were created.
 *   A thing created during an update gets its first update on the next one.
 * - `draw()` draws the thing around itself: (0, 0) is its position, where a sprite drawn
 *   at (0, 0) puts its origin pixel. Things are drawn from the top of the world down (by
 *   `y`), so the lower one is in front.
 * - `drawUI()` draws on the screen itself, over the world, in screen pixels: the camera
 *   does not move it.
 *
 * A thing that has nothing to draw (a clock, a spawner) only has an `update()`.
 */
export class Thing {
  /** Position in the world, in game pixels (fractions are fine). */
  x: number
  y: number
  /**
   * While a modal thing is in the world (a menu, a dialogue), the world stops: only the
   * last modal thing created updates, the world's clock (`time.ms`) and the camera stop,
   * and everything is still drawn.
   */
  modal = false;
  /** @internal */
  [track]: Track

  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
    this[track] = { fromX: x, fromY: y, jumped: true, removed: false, order: created++, shownY: y }
    things.push(this)
  }

  /** Called 60 times per second. */
  update(): void {}

  /** Draws the thing, around (0, 0). Only draws: changes nothing in the game. */
  draw(): void {}

  /** Draws on the screen, over the world, in screen pixels. Only draws. */
  drawUI(): void {}

  /** Moves by (dx, dy), drawn smoothly between its two positions. */
  move(dx: number, dy: number) {
    this.x += dx
    this.y += dy
  }

  /** Moves straight to (x, y), with no in-between: a teleport, a door to another room. */
  place(x: number, y: number) {
    this.x = x
    this.y = y
    this[track].jumped = true
  }

  /** Takes the thing out of the world, at the end of the current update. */
  remove() {
    if (this[track].removed) return
    this[track].removed = true
    anyRemoved = true
  }

  /** Was it removed from the world? */
  get removed() {
    return this[track].removed
  }
}

let target: Thing | null = null
let cameraFromX = 0
let cameraFromY = 0
let cameraJumped = true
/** The map the followed thing is in: the camera stays inside it. */
let cameraMap: string | null = null

/**
 * What part of the world the screen shows: (x, y) is the world position at the top left
 * of the screen. It stays at (0, 0) unless the game moves it or makes it follow a thing.
 */
export const camera = {
  x: 0,
  y: 0,
  /**
   * Keeps a thing in the middle of the screen (or stops following, with null). The camera
   * moves after every thing has updated, so it always shows where the thing ended up.
   *
   * It stays inside the map the thing is in, stopping at its edges. When the thing goes
   * into another map, the camera snaps to it at once: maps are never smaller than the
   * screen, so the maps around the one shown never appear.
   */
  follow(thing: Thing | null) {
    target = thing
    cameraJumped = true
    centerOn(thing)
  },
}

/** Centers the camera on a thing, inside its map. Returns whether it changed map. */
function centerOn(thing: Thing | null) {
  if (!thing) return false
  camera.x = thing.x - screen.width / 2
  camera.y = thing.y - screen.height / 2
  const m = mapAt(thing.x, thing.y)
  if (m) {
    camera.x = within(camera.x, m.x, m.x + m.width - screen.width)
    camera.y = within(camera.y, m.y, m.y + m.height - screen.height)
  }
  const changed = (m?.name ?? null) !== cameraMap
  cameraMap = m?.name ?? null
  return changed
}

/** Between lo and hi; lo when the map is smaller than the screen (a hand-edited file). */
function within(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, Math.max(lo, hi)))
}

/**
 * Puts the camera on the thing it follows, now that the screen has its size: the game's
 * code may call `camera.follow` before the game starts, when the screen has none yet.
 */
export function settleCamera() {
  if (!target) return
  centerOn(target)
  cameraJumped = true
}

/** Empties the world: called before a game's code runs. */
export function resetWorld() {
  things = []
  created = 0
  anyRemoved = false
  target = null
  cameraMap = null
  camera.x = 0
  camera.y = 0
  cameraJumped = true
}

/** The map the camera stays in (the followed thing's), or null. */
export function cameraMapName(): string | null {
  return cameraMap
}

/** The things in the world, in creation order. */
export function worldThings(): readonly Thing[] {
  return things
}

/** The modal thing in charge, if any: the last one created. */
export function modalThing(): Thing | null {
  for (let i = things.length - 1; i >= 0; i--) {
    const t = things[i]
    if (t.modal && !t[track].removed) return t
  }
  return null
}

/** One update of the world. Returns whether the world ran (no modal thing stopped it). */
export function updateWorld(): boolean {
  for (const t of things) {
    const k = t[track]
    k.fromX = t.x
    k.fromY = t.y
    k.jumped = false
  }
  cameraFromX = camera.x
  cameraFromY = camera.y
  cameraJumped = false

  const modal = modalThing()
  if (modal) modal.update()
  else {
    // Things created during this update wait for the next one.
    const count = things.length
    for (let i = 0; i < count; i++) {
      const t = things[i]
      if (!t[track].removed) t.update()
    }
    if (target && !target[track].removed) {
      if (centerOn(target) || target[track].jumped) cameraJumped = true
    }
  }
  if (anyRemoved) {
    things = things.filter((t) => !t[track].removed)
    if (target?.[track].removed) target = null
    anyRemoved = false
  }
  return modal === null
}

/** The things in depth order, reused from frame to frame. */
const sorted: Thing[] = []

/**
 * Draws the world on the screen, `alpha` (0 to 1) of the way between the update before
 * and the last one: first `background` (the game's own draw, through the camera), then the
 * maps, then the things from the top of the world down, then their UI.
 *
 * Positions are rounded to display pixels only once, relative to the camera: a thing the
 * camera follows stays perfectly still on screen while the world scrolls behind it.
 */
export function drawWorld(alpha: number, background?: () => void) {
  const scale = screenScale()
  const camX = cameraJumped ? camera.x : lerp(cameraFromX, camera.x, alpha)
  const camY = cameraJumped ? camera.y : lerp(cameraFromY, camera.y, alpha)
  beginDraw('world')
  try {
    setOrigin(Math.round(-camX * scale), Math.round(-camY * scale))
    background?.()
    drawMaps(camX, camY, screen.width, screen.height)

    sorted.length = 0
    for (const t of things) {
      if (t[track].removed) continue
      t[track].shownY = shown(t, alpha).y
      sorted.push(t)
    }
    sorted.sort(byDepth)
    for (const t of sorted) {
      const p = shown(t, alpha)
      setOrigin(Math.round((p.x - camX) * scale), Math.round((p.y - camY) * scale))
      t.draw()
    }

    beginDraw('ui')
    setOrigin(0, 0)
    for (const t of things) if (!t[track].removed) t.drawUI()
  } finally {
    endDraw()
  }
}

function byDepth(a: Thing, b: Thing) {
  return a[track].shownY - b[track].shownY || a[track].order - b[track].order
}

const point = { x: 0, y: 0 }

/** Where a thing is shown on this frame (the same object every time: read it at once). */
function shown(t: Thing, alpha: number) {
  const k = t[track]
  point.x = k.jumped ? t.x : lerp(k.fromX, t.x, alpha)
  point.y = k.jumped ? t.y : lerp(k.fromY, t.y, alpha)
  return point
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

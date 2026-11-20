// The world: the game's actors, the camera, and the order in which they update and draw.
//
//   class Hero extends Actor {
//     update() { this.move(input.x, input.y) }     // 60 times per second
//     draw() { screen.sprite(sprite('hero'), 0, 0) } // around itself: (0, 0) is where it is
//   }
//   const hero = new Hero(100, 80)                  // creating an actor puts it in the world
//   camera.follow(hero)
//
// Actors update 60 times per second, in the order they were created. Displays refresh at
// other rates (120 Hz, 144 Hz…), so each displayed frame draws every actor between where it
// was before its last update and where it is now: motion is smooth on any display, and the
// game's code never sees it. An actor that `place`s itself, or was just created, is drawn
// where it is, with no in-between.

import { collide, type Box } from './collision'
import { drawMaps, mapAt, placements, solidsIn, type Rect } from './maps'
import { attachScreen, beginDraw, endDraw, setOrigin, screen, screenScale } from './screen'

/** Where the engine keeps its own state on each actor (a symbol: games never see it). */
const track = Symbol('lucarne')

interface Track {
  /** Where the actor was before its last update. */
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

let actors: Actor[] = []
let created = 0
let anyRemoved = false

/**
 * Something in the game's world. Extend it; creating one puts it in the world.
 *
 * - `update()` runs 60 times per second, for every actor, in the order they were created.
 *   An actor created during an update gets its first update on the next one.
 * - `draw()` draws the actor around itself: (0, 0) is its position, where a sprite drawn
 *   at (0, 0) puts its origin pixel. Actors are drawn from the top of the world down (by
 *   `y`), so the lower one is in front.
 * - `drawUI()` draws on the screen itself, over the world, in screen pixels: the camera
 *   does not move it.
 *
 * An actor that has nothing to draw (a clock, a spawner) only has an `update()`.
 */
export class Actor {
  /** Position in the world, in game pixels (fractions are fine). */
  x: number
  y: number
  /**
   * While a modal actor is in the world (a menu, a dialogue), the world stops: only the
   * last modal actor created updates, the world's clock (`time.ms`) and the camera stop,
   * and everything is still drawn.
   */
  modal = false;
  /** @internal */
  [track]: Track

  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
    this[track] = { fromX: x, fromY: y, jumped: true, removed: false, order: created++, shownY: y }
    actors.push(this)
  }

  /**
   * Its box, drawn on the Actors page (actors.json): `{ x, y, width, height }` in game
   * pixels, (x, y) its top left relative to the actor's position. Walls stop it, and so do
   * the boxes of other actors. Null: it goes through everything, and nothing bumps into it.
   */
  get box(): Box | null {
    return boxOf(this.constructor)
  }

  /** Called 60 times per second. */
  update(): void {}

  /** Draws the actor, around (0, 0). Only draws: changes nothing in the game. */
  draw(): void {}

  /** Draws on the screen, over the world, in screen pixels. Only draws. */
  drawUI(): void {}

  /**
   * Moves by (dx, dy), drawn smoothly between its two positions. An actor with a `box`
   * slides along walls and other actors' boxes, and around the corners it only clips.
   * Returns whether it went the whole way (false: something stopped it, to turn around for
   * instance).
   */
  move(dx: number, dy: number): boolean {
    const box = this.box
    if (!box) {
      this.x += dx
      this.y += dy
      return true
    }
    mover = this
    const to = collide(this.x, this.y, box, dx, dy, walls)
    mover = null
    this.x = to.x
    this.y = to.y
    return to.whole
  }

  /**
   * Moves straight to (x, y), with no in-between: a teleport, a door to another room.
   * Walls do not stop it (and an actor placed inside a wall can walk out of it).
   */
  place(x: number, y: number) {
    this.x = x
    this.y = y
    this[track].jumped = true
  }

  /** Takes the actor out of the world, at the end of the current update. */
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

// --- Boxes ------------------------------------------------------------------
//
// Boxes are drawn on the Actors page and saved in actors.json by the name a class is
// exported under (the name maps place it by), so the game's code writes none. They are
// tied to the classes once the code has run, and looked up lazily: actors created by the
// code's top level, before that, get theirs too. A class with no box of its own takes its
// parent's: a class that is not exported (so cannot be drawn on) still has a body.

/** Boxes by export name, as read from actors.json. */
let boxesByName: Record<string, Box> = {}
/** Boxes by class, tied once the code has run (see `setActorBoxes`). */
let ownBoxes = new WeakMap<Function, Box>()
/** Each class's box, own or inherited, worked out on first use. */
let resolved = new WeakMap<Function, Box | null>()

/** Called by the editor before the game's code runs, with actors.json's boxes. */
export function setBoxes(boxes: Record<string, Box>) {
  boxesByName = boxes
  ownBoxes = new WeakMap()
  resolved = new WeakMap()
}

/** Ties the boxes to the classes the game's code exports, once it has run. */
export function linkBoxes(types: ReadonlyMap<string, ActorType>) {
  ownBoxes = new WeakMap()
  resolved = new WeakMap()
  for (const [name, Type] of types) {
    const b = boxesByName[name]
    if (b) ownBoxes.set(Type, Object.freeze({ x: b.x, y: b.y, width: b.width, height: b.height }))
  }
}

function boxOf(type: Function): Box | null {
  let b = resolved.get(type)
  if (b !== undefined) return b
  b = null
  for (let c: Function | null = type; c && c !== Actor; c = Object.getPrototypeOf(c)) {
    const own = ownBoxes.get(c)
    if (own) {
      b = own
      break
    }
  }
  resolved.set(type, b)
  return b
}

/** The actor moving (its own box is not a wall to it). */
let mover: Actor | null = null

/**
 * The walls of a move: the solid tiles, everything outside the maps, and every other
 * actor's box. All bodies are solid to each other, with no option: an actor that should
 * be walked through (a coin, a trigger) has no box. Actors are few in a pixel art game, so
 * looking at all of them is fast enough.
 */
function walls(left: number, top: number, right: number, bottom: number, out: Rect[]) {
  solidsIn(left, top, right, bottom, out)
  for (const a of actors) {
    if (a === mover || a[track].removed) continue
    const b = a.box
    if (!b) continue
    const x = a.x + b.x
    const y = a.y + b.y
    if (x > right || x + b.width < left || y > bottom || y + b.height < top) continue
    out.push({ x, y, width: b.width, height: b.height })
  }
}

let target: Actor | null = null
let cameraFromX = 0
let cameraFromY = 0
let cameraJumped = true
/** The map the followed actor is in: the camera stays inside it. */
let cameraMap: string | null = null

/**
 * What part of the world the screen shows: (x, y) is the world position at the top left
 * of the screen. It stays at (0, 0) unless the game moves it or makes it follow an actor.
 */
export const camera = {
  x: 0,
  y: 0,
  /**
   * Keeps an actor in the middle of the screen (or stops following, with null). The camera
   * moves after every actor has updated, so it always shows where the actor ended up.
   *
   * It stays inside the map the actor is in, stopping at its edges. When the actor goes
   * into another map, the camera snaps to it at once: maps are never smaller than the
   * screen, so the maps around the one shown never appear.
   */
  follow(actor: Actor | null) {
    target = actor
    cameraJumped = true
    centerOn(actor)
  },
}

/** Centers the camera on an actor, inside its map. Returns whether it changed map. */
function centerOn(actor: Actor | null) {
  if (!actor) return false
  camera.x = actor.x - screen.width / 2
  camera.y = actor.y - screen.height / 2
  const m = mapAt(actor.x, actor.y)
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
 * Puts the camera on the actor it follows, now that the screen has its size: the game's
 * code may call `camera.follow` before the game starts, when the screen has none yet.
 */
export function settleCamera() {
  if (!target) return
  centerOn(target)
  cameraJumped = true
}

/** A class of actors the editor can place on a map: created with `new Type(x, y)`. */
export type ActorType = new (x: number, y: number) => Actor

/**
 * The actor classes a game's code exports (from `code/main.ts`), by the name they are
 * exported under: the names maps place them by. Exporting a class is what makes it
 * placeable; nothing else declares it. The export name is used rather than the class's
 * own name, which a bundler may change.
 */
export function actorTypes(exports: Record<string, unknown>): Map<string, ActorType> {
  const out = new Map<string, ActorType>()
  for (const [name, value] of Object.entries(exports)) {
    if (typeof value === 'function' && value.prototype instanceof Actor) out.set(name, value as ActorType)
  }
  return out
}

/**
 * Creates every actor placed on the maps, with `new Type(x, y)` at its place in the world.
 * Called once the game's code has run (its classes exist then) and before `start()`: the
 * actors the code creates at its top level come first, then the placed ones, map by map.
 * A map that places a class the code does not export is an error, to fix in the code or
 * on the map, rather than an actor silently missing.
 */
export function placeActors(types: ReadonlyMap<string, ActorType>) {
  for (const p of placements()) {
    const Type = types.get(p.type)
    if (!Type) {
      const known = [...types.keys()].join(', ') || 'none'
      throw new Error(`maps/${p.map}.json places a ${p.type}, but code/main.ts exports no actor class named ${p.type} (it exports: ${known}).`)
    }
    new Type(p.x, p.y)
  }
}

/**
 * Draws one actor by itself on a canvas of `width` × `height` game pixels (one canvas
 * pixel each), its position at (x, y): the editor's picture of a class of actors. Draws
 * nothing else, and leaves the screen detached.
 */
export function drawActorOn(actor: Actor, canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number, x: number, y: number) {
  attachScreen(canvas, width, height)
  beginDraw('world')
  try {
    setOrigin(x, y)
    actor.draw()
  } finally {
    endDraw()
    attachScreen(null)
  }
}

/** Empties the world: called before a game's code runs. */
export function resetWorld() {
  actors = []
  created = 0
  anyRemoved = false
  target = null
  cameraMap = null
  camera.x = 0
  camera.y = 0
  cameraJumped = true
}

/** The map the camera stays in (the followed actor's), or null. */
export function cameraMapName(): string | null {
  return cameraMap
}

/** The actors in the world, in creation order. */
export function worldActors(): readonly Actor[] {
  return actors
}

/** The modal actor in charge, if any: the last one created. */
export function modalActor(): Actor | null {
  for (let i = actors.length - 1; i >= 0; i--) {
    const t = actors[i]
    if (t.modal && !t[track].removed) return t
  }
  return null
}

/** One update of the world. Returns whether the world ran (no modal actor stopped it). */
export function updateWorld(): boolean {
  for (const t of actors) {
    const k = t[track]
    k.fromX = t.x
    k.fromY = t.y
    k.jumped = false
  }
  cameraFromX = camera.x
  cameraFromY = camera.y
  cameraJumped = false

  const modal = modalActor()
  if (modal) modal.update()
  else {
    // Actors created during this update wait for the next one.
    const count = actors.length
    for (let i = 0; i < count; i++) {
      const t = actors[i]
      if (!t[track].removed) t.update()
    }
    if (target && !target[track].removed) {
      if (centerOn(target) || target[track].jumped) cameraJumped = true
    }
  }
  if (anyRemoved) {
    actors = actors.filter((t) => !t[track].removed)
    if (target?.[track].removed) target = null
    anyRemoved = false
  }
  return modal === null
}

/** The actors in depth order, reused from frame to frame. */
const sorted: Actor[] = []

/**
 * Draws the world on the screen, `alpha` (0 to 1) of the way between the update before
 * and the last one: first `background` (the game's own draw, through the camera), then the
 * maps, then the actors from the top of the world down, then their UI.
 *
 * Positions are rounded to display pixels only once, relative to the camera: an actor the
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
    for (const t of actors) {
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
    for (const t of actors) if (!t[track].removed) t.drawUI()
  } finally {
    endDraw()
  }
}

function byDepth(a: Actor, b: Actor) {
  return a[track].shownY - b[track].shownY || a[track].order - b[track].order
}

const point = { x: 0, y: 0 }

/** Where an actor is shown on this frame (the same object every time: read it at once). */
function shown(t: Actor, alpha: number) {
  const k = t[track]
  point.x = k.jumped ? t.x : lerp(k.fromX, t.x, alpha)
  point.y = k.jumped ? t.y : lerp(k.fromY, t.y, alpha)
  return point
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

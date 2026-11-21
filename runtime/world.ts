// The world: the game's actors, the camera, and the order in which they update and draw.
//
//   export default class Hero extends Actor {          // actors/hero.ts
//     speed = 1.25                                     // a variable (see values.ts)
//     create() { camera.follow(this) }                 // once its values are set
//     update() { this.move(input.x * this.speed, 0) }  // 60 times per second
//     draw() { screen.sprite(sprite('hero'), 0, 0) }   // around itself: (0, 0) is where it is
//   }
//
// Actors are created with `spawn(Hero, { x: 100, y: 80 })`, or placed on a map. Either way
// the engine creates it, sets its values (see "Actor files" below), then calls `create()`.
//
// Actors update 60 times per second, in the order they were created. Displays refresh at
// other rates (120 Hz, 144 Hz…), so each displayed frame draws every actor between where it
// was before its last update and where it is now: motion is smooth on any display, and the
// game's code never sees it. An actor that `place`s itself, or was just created, is drawn
// where it is, with no in-between.

import { collide, type Box } from './collision'
import { drawMaps, mapAt, placements, solidsIn, type Rect } from './maps'
import { attachScreen, beginDraw, endDraw, setOrigin, screen, screenScale } from './screen'
import { checkValues, copyValue, variablesOf, type Value, type Variable } from './values'

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
 * How the actor being constructed is made: by `spawn`, into the world, or by `probe`, to
 * read its code's defaults and leave the world as it is. Null: by `new`, which is refused.
 */
let constructing: 'world' | 'probe' | null = null

/**
 * Something in the game's world. Extend it, and create one with `spawn`.
 *
 * - `create()` runs once, when its values are set: what a constructor would do.
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
  x = 0
  y = 0
  /**
   * Its box: `{ x, y, width, height }` in game pixels, (x, y) its top left relative to the
   * actor's position. Walls stop it, and so do the boxes of other actors. Null: it goes
   * through everything, and nothing bumps into it. Drawn on the Actors page; the code may
   * change it as the game runs (a hero crouching), for this actor alone.
   */
  box: Box | null = null
  /**
   * While a modal actor is in the world (a menu, a dialogue), the world stops: only the
   * last modal actor created updates, the world's clock (`time.ms`) and the camera stop,
   * and everything is still drawn.
   */
  modal = false;
  /** @internal */
  [track]: Track

  /**
   * Not called by the game: `spawn` creates actors. A constructor runs before the values
   * set in the editor, which would make them lie to it; `create()` runs after them.
   */
  constructor() {
    if (!constructing) {
      throw new Error(`Actors are created with spawn(${new.target.name}, { x, y }), not with new.`)
    }
    this[track] = { fromX: 0, fromY: 0, jumped: true, removed: false, order: 0, shownY: 0 }
    if (constructing === 'world') {
      this[track].order = created++
      actors.push(this)
    }
  }

  /** Called once, when the actor is created and its values are set. */
  create(): void {}

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

/** A class of actors: created by `spawn`, never with `new`. */
export type ActorType<T extends Actor = Actor> = new () => T

/** What `spawn` can set on an actor: its position, its box, and its class's own fields. */
export type Values<T extends Actor> = Partial<Omit<T, keyof Actor>> & { x?: number; y?: number; box?: Box | null }

/**
 * Creates an actor in the world: its code's defaults, then the values set in the editor
 * (its actor files, see below), then `values`, then its `create()`. Returns it.
 *
 *   spawn(Villager, { x: 40, y: 96, lines: ['Nice weather.'] })
 *   spawn(Dialogue, { pages: ['Hello!'] })
 */
export function spawn<T extends Actor>(Type: ActorType<T>, values?: Values<T>): T {
  const actor = construct(Type, 'world')
  setValues(actor, actorValues(Type))
  if (values) Object.assign(actor, values)
  const k = actor[track]
  k.fromX = actor.x
  k.fromY = actor.y
  k.shownY = actor.y
  actor.create()
  return actor
}

function construct<T extends Actor>(Type: ActorType<T>, how: 'world' | 'probe'): T {
  const before = constructing
  constructing = how
  try {
    return new Type()
  } finally {
    constructing = before
  }
}

/** Sets checked values on an actor, each a copy of its own: no two share a list or a box. */
function setValues(actor: Actor, values: Record<string, Value>) {
  for (const [name, v] of Object.entries(values)) (actor as unknown as Record<string, Value>)[name] = copyValue(v)
}

// --- Actor files ------------------------------------------------------------
//
// An actor is a pair of files named alike: actors/<name>.ts exports its class (the code
// declares), actors/<name>.json holds the values set in the editor for every actor of that
// kind (the editor sets), its box among them. The name is the file's: maps place an actor
// by it. game.js registers the classes before the game's other code runs, so that actors
// spawned at the top level of code/main.ts get their values too.
//
// A class gets the values of every actor file on its way up to Actor, the nearest last:
// a guard that extends the villager is a villager with its own differences. A class
// defined in code/ (a helper, a dialogue) has no file, and only its code's defaults.

/** Each actor file's values, by name, as read: checked when first used. */
let files: Record<string, Record<string, unknown>> = {}
/** The classes of actors/*.ts, by name, and the other way round. */
let classes = new Map<string, ActorType>()
let names = new WeakMap<Function, string>()
/** Worked out on first use: a class's variables, and its values from its actor files. */
let variablesCache = new WeakMap<Function, Variable[]>()
let valuesCache = new WeakMap<Function, Record<string, Value>>()

/** Called by the editor before the game's code runs, with every actors/<name>.json. */
export function setActorFiles(values: Record<string, Record<string, unknown>>) {
  files = values
  classes = new Map()
  names = new WeakMap()
  variablesCache = new WeakMap()
  valuesCache = new WeakMap()
}

/**
 * Called by game.js (see server/build.mjs) with the default export of each actors/*.ts,
 * by file name, before the game's other code runs.
 */
export function registerActors(found: Record<string, unknown>) {
  for (const [name, Type] of Object.entries(found)) {
    if (typeof Type !== 'function' || !(Type.prototype instanceof Actor)) {
      throw new Error(`actors/${name}.ts must end with \`export default class … extends Actor\` (or a class extending one).`)
    }
    classes.set(name, Type as ActorType)
    names.set(Type, name)
  }
}

/** The classes of actors/*.ts, by name: what maps place. */
export function actorClasses(): ReadonlyMap<string, ActorType> {
  return classes
}

/** The name of a class's actor file, or null for a class that has none. */
export function actorName(Type: Function): string | null {
  return names.get(Type) ?? null
}

/** The names of the actor files a class inherits from, the nearest first (not its own). */
export function actorParents(Type: Function): string[] {
  const out: string[] = []
  for (let c = Object.getPrototypeOf(Type); c && c !== Actor; c = Object.getPrototypeOf(c)) {
    const n = names.get(c)
    if (n) out.push(n)
  }
  return out
}

/**
 * Creates an actor outside the world, with its code's defaults only: to read its variables,
 * or for the editor to draw it with values of its own.
 */
export function probe<T extends Actor>(Type: ActorType<T>, values: Record<string, Value> = {}): T {
  const actor = construct(Type, 'probe')
  setValues(actor, values)
  return actor
}

/** A class's variables, with its code's defaults (see values.ts). */
export function actorVariables(Type: ActorType): Variable[] {
  let v = variablesCache.get(Type)
  if (!v) {
    v = variablesOf(probe(Type))
    variablesCache.set(Type, v)
  }
  return v
}

/** The values a class gets from its actor files, checked, the nearest file last. Throws on
 * a value its class does not declare, or of the wrong kind. */
export function actorValues(Type: Function): Record<string, Value> {
  let out = valuesCache.get(Type)
  if (out) return out
  out = {}
  const chain: Function[] = []
  for (let c: Function | null = Type; c && c !== Actor; c = Object.getPrototypeOf(c)) if (names.has(c)) chain.unshift(c)
  for (const c of chain) {
    const name = names.get(c)!
    const own = files[name]
    if (own) Object.assign(out, checkValues(own, actorVariables(c as ActorType), `actors/${name}.json`, name))
  }
  valuesCache.set(Type, out)
  return out
}

/**
 * Checks every actor file, then creates every actor placed on the maps, map by map, with
 * its values from the map. Called once the game's code has run, before `start()`: the
 * actors code/main.ts spawns at its top level come first. A file that sets what its class
 * does not declare, or a map that places an actor with no actors/<name>.ts, is an error to
 * fix, rather than a value or an actor silently missing.
 */
export function placeActors() {
  for (const name of Object.keys(files)) {
    const Type = classes.get(name)
    if (!Type) throw new Error(`actors/${name}.json has no actors/${name}.ts: write the actor's code, or delete the file.`)
    actorValues(Type)
  }
  for (const p of placements()) {
    const Type = classes.get(p.actor)
    if (!Type) {
      const known = [...classes.keys()].join(', ') || 'none'
      throw new Error(`maps/${p.map}.json places a ${p.actor}, but there is no actors/${p.actor}.ts (the actors: ${known}).`)
    }
    const values = checkValues(p.values, actorVariables(Type), `maps/${p.map}.json`, p.actor)
    spawn(Type, { ...values, x: p.x, y: p.y } as Values<Actor>)
  }
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

/**
 * Draws one actor by itself on a canvas of `width` × `height` game pixels (one canvas
 * pixel each), its position at (x, y): the editor's picture of an actor. Draws
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

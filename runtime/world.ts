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
// the engine creates it with its code's defaults, sets the values the map (or `spawn`)
// gives it, then calls `create()`.
//
// Actors update 60 times per second, in the order they were created. Displays refresh at
// other rates (120 Hz, 144 Hz…), so each displayed frame draws every actor between where it
// was before its last update and where it is now: motion is smooth on any display, and the
// game's code never sees it. An actor that `place`s itself, or was just created, is drawn
// where it is, with no in-between.

import { collide, type Box } from './collision'
import { game } from './game'
import { Grid, type Listed } from './grid'
import { drawMaps, mapAt, placements, solidsIn, type Rect } from './maps'
import { attachScreen, beginDraw, endDraw, setOrigin, screen, screenScale } from './screen'
import { resetScripts, setRunning } from './scripts'
import { checkValues, variablesOf, type Variable } from './values'

/** Where the engine keeps its own state on each actor (a symbol: games never see it). */
const track = Symbol('lucarne')

interface Track extends Listed {
  /** The actor this is the state of (the grid lists tracks). */
  readonly actor: Actor
  /** Its position and box, behind `x`, `y` and `box`: setting one keeps the grid up to date. */
  x: number
  y: number
  box: Readonly<Box> | null
  /** In the world (spawned, not removed): listed in the grid. Probes never are. */
  inWorld: boolean
  /** Where the actor was before its last update. */
  fromX: number
  fromY: number
  /** Drawn where it is, without in-between, until its next update (new, or placed). */
  jumped: boolean
  removed: boolean
  /** Creation order: updates follow it, it breaks ties in the depth order, and queries keep it. */
  order: number
  /** Where it is shown on the frame being drawn: its depth. */
  shownY: number
}

let actors: Actor[] = []
let created = 0
/** Where every actor of the world is: what moves and `actorsIn` look in. */
const grid = new Grid<Track>()

/**
 * Lists an actor in the grid where it is now: over its box, or at its feet without one.
 * Called whenever its position or its box changes; cheap when it stays in the same cells.
 */
function relist(k: Track) {
  if (!k.inWorld) return
  const b = k.box
  if (b) grid.set(k, k.x + b.x, k.y + b.y, k.x + b.x + b.width, k.y + b.y + b.height)
  else grid.set(k, k.x, k.y, k.x, k.y)
}
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
 *
 * An actor that has nothing to draw (a clock, a spawner) only has an `update()`. The UI is
 * not an actor's: the game draws it, in its `ui()` (see game.ts).
 */
export class Actor {
  /** @internal */
  [track]: Track

  // x, y and box are accessors (defined after the class): setting one keeps the grid up
  // to date. Declared as properties, so that a class may give them defaults as fields.

  /** Position in the world, in game pixels (fractions are fine). */
  declare x: number
  declare y: number
  /**
   * Its box: `{ x, y, width, height }` in game pixels, (x, y) its top left relative to the
   * actor's position. Walls stop it, and so do the boxes of other actors. Null (the
   * default): it goes through everything, and nothing bumps into it. The code gives it one,
   * usually a sprite's, drawn on the sprite with the Box tool: `box = sprite('hero').box`.
   * It may change as the game runs (a hero crouching), for this actor alone, by setting a
   * new one: the box is frozen, so that the engine always knows where it is.
   */
  declare box: Readonly<Box> | null

  /**
   * Not called by the game: `spawn` creates actors. A constructor runs before the values
   * set on the map, which would make them lie to it; `create()` runs after them.
   */
  constructor() {
    if (!constructing) {
      throw new Error(`Actors are created with spawn(${new.target.name}, { x, y }), not with new.`)
    }
    const k: Track = {
      actor: this,
      x: 0,
      y: 0,
      box: null,
      inWorld: constructing === 'world',
      cells: null,
      fromX: 0,
      fromY: 0,
      jumped: true,
      removed: false,
      order: 0,
      shownY: 0,
    }
    this[track] = k
    if (k.inWorld) {
      k.order = created++
      actors.push(this)
      relist(k)
    }
  }

  /** Called once, when the actor is created and its values are set. */
  create(): void {}

  /** Called 60 times per second. */
  update(): void {}

  /** Draws the actor, around (0, 0). Only draws: changes nothing in the game. */
  draw(): void {}

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
    const k = this[track]
    if (k.removed) return
    k.removed = true
    k.inWorld = false
    grid.set(k, null)
    anyRemoved = true
  }

  /** Was it removed from the world? */
  get removed() {
    return this[track].removed
  }
}

Object.defineProperties(Actor.prototype, {
  x: {
    get(this: Actor) {
      return this[track].x
    },
    set(this: Actor, v: number) {
      const k = this[track]
      k.x = v
      relist(k)
    },
  },
  y: {
    get(this: Actor) {
      return this[track].y
    },
    set(this: Actor, v: number) {
      const k = this[track]
      k.y = v
      relist(k)
    },
  },
  box: {
    get(this: Actor) {
      return this[track].box
    },
    set(this: Actor, v: Box | null) {
      const k = this[track]
      k.box = v ? Object.freeze({ x: v.x, y: v.y, width: v.width, height: v.height }) : null
      relist(k)
    },
  },
})

/** A class of actors: created by `spawn`, never with `new`. */
export type ActorType<T extends Actor = Actor> = new () => T

/** What `spawn` can set on an actor: its position, its box, and its class's own fields. */
export type Values<T extends Actor> = Partial<Omit<T, keyof Actor>> & { x?: number; y?: number; box?: Box | null }

/**
 * Creates an actor in the world: its code's defaults, then `values`, then its `create()`.
 * Returns it.
 *
 *   spawn(Villager, { x: 40, y: 96, lines: ['Nice weather.'] })
 */
export function spawn<T extends Actor>(Type: ActorType<T>, values?: Values<T>): T {
  const actor = construct(Type, 'world')
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
  let actor: T
  try {
    actor = new Type()
  } finally {
    constructing = before
  }
  // A class that gives `x`, `y` or `box` a default as a field makes it its own property,
  // hiding the engine's accessor: the value goes through the accessor instead.
  for (const name of ['x', 'y', 'box'] as const) {
    if (!Object.hasOwn(actor, name)) continue
    const v = (actor as unknown as Record<string, unknown>)[name]
    delete (actor as unknown as Record<string, unknown>)[name]
    ;(actor as unknown as Record<string, unknown>)[name] = v
  }
  return actor
}

// --- Actor classes ----------------------------------------------------------
//
// An actor is actors/<name>.ts, exporting its class: its behavior, and each variable's
// default. The name is the file's: maps place an actor by it, with its own values. game.js
// registers the classes before the game's other code runs. Reuse goes through `extends`.

/** The classes of actors/*.ts, by name, and the other way round. */
let classes = new Map<string, ActorType>()
let names = new WeakMap<Function, string>()
/** Worked out on first use: a class's variables. */
let variablesCache = new WeakMap<Function, Variable[]>()

/** Called by the editor before the game's code runs: no class of an earlier run stays. */
export function resetActorClasses() {
  classes = new Map()
  names = new WeakMap()
  variablesCache = new WeakMap()
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

/** The name of a class's file (actors/<name>.ts), or null for a class defined in code/. */
export function actorName(Type: Function): string | null {
  return names.get(Type) ?? null
}

/**
 * Creates an actor outside the world, with its code's defaults only: to read its variables,
 * or for the editor to draw it.
 */
export function probe<T extends Actor>(Type: ActorType<T>): T {
  return construct(Type, 'probe')
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

/**
 * Creates every actor placed on the maps, map by map, with its values from the map. Called
 * once the game's code has run, before `start()`: the actors code/main.ts spawns at its top
 * level come first. A map that sets what a class does not declare, or places an actor with
 * no actors/<name>.ts, is an error to fix, rather than a value or an actor silently missing.
 */
export function placeActors() {
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
 * be walked through (a coin, a trigger) has no box. Only the actors near the move are
 * looked at (see grid.ts).
 */
function walls(left: number, top: number, right: number, bottom: number, out: Rect[]) {
  solidsIn(left, top, right, bottom, out)
  for (const k of grid.near(left, top, right, bottom)) {
    const b = k.box
    if (!b || k.actor === mover) continue
    const x = k.x + b.x
    const y = k.y + b.y
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
  grid.clear()
  created = 0
  anyRemoved = false
  target = null
  cameraMap = null
  camera.x = 0
  camera.y = 0
  cameraJumped = true
  game.paused = false
  resetScripts()
}

/** The map the camera stays in (the followed actor's), or null. */
export function cameraMapName(): string | null {
  return cameraMap
}

/** The actors in the world, in creation order. */
export function worldActors(): readonly Actor[] {
  return actors
}

/**
 * The first actor of that class in the world (of a class that extends it too), in creation
 * order, or null: to read the hero from anywhere, the game's `ui()` among them.
 *
 *   const hero = find(Hero)
 */
export function find<T extends Actor>(Type: abstract new () => T): T | null {
  for (const t of actors) if (t instanceof Type && !t[track].removed) return t
  return null
}

/** A rectangle of the world, in game pixels: (x, y) its top left. */
export interface Area {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The actors in a part of the world, in creation order: the ones whose box overlaps it,
 * and the ones without a box whose feet are in it. With a class, only actors of that class
 * (or of a class that extends it). Edges that only touch do not count.
 *
 *   // what stands just in front of the hero, facing east
 *   const ahead = actorsIn({ x: this.x + 6, y: this.y - 4, width: 8, height: 8 })
 *
 * The engine looks only near the area, however many actors the world holds.
 */
export function actorsIn(area: Area): Actor[]
export function actorsIn<T extends Actor>(area: Area, Type: abstract new () => T): T[]
export function actorsIn(area: Area, Type?: abstract new () => Actor): Actor[] {
  const l = area.x
  const t = area.y
  const r = area.x + area.width
  const b = area.y + area.height
  const out: Actor[] = []
  for (const k of grid.near(l, t, r, b)) {
    if (Type && !(k.actor instanceof Type)) continue
    const box = k.box
    const inside = box
      ? k.x + box.x < r && k.x + box.x + box.width > l && k.y + box.y < b && k.y + box.y + box.height > t
      : k.x >= l && k.x < r && k.y >= t && k.y < b
    if (inside) out.push(k.actor)
  }
  return out
}

/** One update of the world. Returns whether the world ran (`game.paused` did not stop it). */
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

  const paused = game.paused
  if (!paused) {
    // Actors created during this update wait for the next one.
    const count = actors.length
    try {
      for (let i = 0; i < count; i++) {
        const t = actors[i]
        if (t[track].removed) continue
        // A script the actor starts is its own (see `lucarne.scripts()`).
        setRunning(actorName(t.constructor) ?? t.constructor.name)
        t.update()
      }
    } finally {
      setRunning('game')
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
  return !paused
}

/** The actors in depth order, reused from frame to frame. */
const sorted: Actor[] = []

/**
 * Draws the world on the screen, `alpha` (0 to 1) of the way between the update before
 * and the last one: first `background` (the game's own draw, through the camera), then the
 * maps, then the actors from the top of the world down, then `ui` (the game's UI, on the
 * screen itself).
 *
 * Positions are rounded to display pixels only once, relative to the camera: an actor the
 * camera follows stays perfectly still on screen while the world scrolls behind it.
 */
export function drawWorld(alpha: number, background?: () => void, ui?: () => void) {
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
    ui?.()
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

// The game's classes of actors, as the world editor shows them to place on maps.
//
// The classes live in the game's code, so the editor runs it: game.js is built (on Mac),
// its top-level code runs, and every class it exports that extends Actor is a kind of
// actor to place. Each one is created once at (0, 0), never updated, and drawn by its own
// `draw()`: the editor shows exactly what the game's first frame shows, with no picture to
// choose for the editor. Modal actors (a menu, a dialogue) are UI, not actors on a map:
// they are left out.

import { resetTime } from '../../runtime/time'
import { spriteFramesOf, type SpriteFrame } from '../../runtime/screen'
import { drawActorOn, resetWorld, type Actor } from '../../runtime/world'
import type { Rect } from './bitmap'
import { fetchGameCode, importGame, isPlaying, loadGameData, useEngine } from './play'
import type { Project } from './project'

/** A class's picture: `x`, `y` place its top left relative to the actor's feet. */
export interface ActorPicture {
  image: OffscreenCanvas
  x: number
  y: number
  w: number
  h: number
  /**
   * The frame of its largest sprite, relative to its feet, or null when it draws no
   * sprite: what it snaps to the grid by (see `snapActor` in world.ts).
   */
  frame: Rect | null
}

export interface ActorKind {
  /** The name it is exported under: what maps place it by. */
  name: string
  /** Its picture; null when it draws nothing (a spawner, a trigger). */
  picture: ActorPicture | null
  /** Why it could not be created or drawn. */
  error?: string
}

export type ActorKinds =
  | { kinds: ActorKind[] }
  /** The code does not build, or throws as it runs. */
  | { error: string }
  /** No code yet. */
  | { missing: true }

/** Room drawn around an actor: its feet at (CANVAS / 2, CANVAS * 3 / 4). An actor's picture
 * is mostly above its feet. What falls outside is cut. */
const CANVAS = 256

/**
 * The game's classes of actors, with their pictures. Null when a game is playing: the
 * engine runs one game at a time, and this runs the game's code.
 */
export function loadActorKinds(project: Project): Promise<ActorKinds | null> {
  return useEngine(async () => {
    if (isPlaying()) return null
    const got = await fetchGameCode(project.storage)
    if ('missing' in got) return { missing: true }
    if ('error' in got) return { error: got.error }
    try {
      await loadGameData(project)
      resetWorld()
      resetTime()
      const { types } = await importGame(got.code)
      const kinds: ActorKind[] = []
      for (const [name, Type] of types) {
        resetWorld()
        try {
          const actor = new Type(0, 0)
          if (actor.modal) continue
          kinds.push({ name, picture: pictureOf(actor) })
        } catch (err) {
          kinds.push({ name, picture: null, error: (err as Error).message ?? String(err) })
        }
      }
      return { kinds: kinds.sort((a, b) => a.name.localeCompare(b.name)) }
    } catch (err) {
      return { error: (err as Error).message ?? String(err) }
    } finally {
      // The game's code created actors as it ran: none of them stay.
      resetWorld()
    }
  })
}

/** Draws an actor by itself and keeps the pixels it drew. */
function pictureOf(actor: Actor): ActorPicture | null {
  const feetX = CANVAS / 2
  const feetY = (CANVAS * 3) / 4
  const canvas = new OffscreenCanvas(CANVAS, CANVAS)
  const frames = spriteFramesOf(() => drawActorOn(actor, canvas, CANVAS, CANVAS, feetX, feetY))
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, CANVAS, CANVAS)
  let x0 = CANVAS, y0 = CANVAS, x1 = -1, y1 = -1
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      if (data[(y * CANVAS + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const image = new OffscreenCanvas(w, h)
  image.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
  return { image, x: x0 - feetX, y: y0 - feetY, w, h, frame: bodyOf(frames) }
}

/**
 * The frame an actor snaps by: its largest sprite's (the first drawn, of the same size).
 * The body is the largest part; a hat or a sword drawn half a tile aside must not move it
 * off its cell, which the frame around every part would.
 */
export function bodyOf(frames: readonly SpriteFrame[]): Rect | null {
  let best: SpriteFrame | null = null
  for (const f of frames) if (!best || f.width * f.height > best.width * best.height) best = f
  return best && { x: best.x, y: best.y, w: best.width, h: best.height }
}

/** A class's picture in a list row: its pixels whole, as large as fit in 32 × 32 (at least 1×). */
export function actorThumb(p: ActorPicture | null): HTMLCanvasElement {
  const thumb = document.createElement('canvas')
  thumb.className = 'thumb'
  const dpr = window.devicePixelRatio || 1
  const scale = p ? Math.max(1, Math.floor(32 / Math.max(p.w, p.h))) : 1
  thumb.width = Math.round(32 * dpr)
  thumb.height = Math.round(32 * dpr)
  thumb.style.width = '32px'
  thumb.style.height = '32px'
  if (p) {
    const ctx = thumb.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const w = p.w * scale * dpr
    const h = p.h * scale * dpr
    ctx.drawImage(p.image, Math.round((thumb.width - w) / 2), Math.round((thumb.height - h) / 2), w, h)
  }
  return thumb
}

// The game's screen: a small canvas, in game pixels. Positions are rounded to whole
// pixels, so nothing is ever drawn between two pixels.

import type { Sprite } from './sprites'
import { time } from './time'

let ctx: CanvasRenderingContext2D | null = null

function context() {
  if (!ctx) throw new Error('The screen can only be used while the game is running.')
  return ctx
}

export const screen = {
  /** Width of the screen, in pixels. */
  width: 0,
  /** Height of the screen, in pixels. */
  height: 0,

  /** Fills the whole screen with a color ("#1a1c2c"). */
  clear(color: string) {
    const c = context()
    c.fillStyle = color
    c.fillRect(0, 0, screen.width, screen.height)
  },

  /** Fills a rectangle. */
  rect(x: number, y: number, width: number, height: number, color: string) {
    const c = context()
    c.fillStyle = color
    c.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height))
  },

  /**
   * Draws a sprite with its origin pixel on (x, y). By default it plays its animation,
   * looping, on the game's clock (`time.ms`), in its first direction.
   */
  sprite(s: Sprite, x: number, y: number, options: SpriteOptions = {}) {
    const c = context()
    const frame = options.frame === undefined ? s.frameAt(time.ms) : wrap(Math.floor(options.frame), s.frames)
    const row = s.row(options.direction ?? 0)
    const { width: w, height: h } = s
    const sx = frame * w
    const sy = row * h
    // Mirrored, the origin pixel stays under (x, y): it moves to the other side of the frame.
    const left = Math.round(x) - (options.flipX ? w - 1 - s.origin.x : s.origin.x)
    const top = Math.round(y) - s.origin.y
    if (!options.flipX) {
      c.drawImage(s.sheet, sx, sy, w, h, left, top, w, h)
      return
    }
    c.save()
    c.translate(left + w, top)
    c.scale(-1, 1)
    c.drawImage(s.sheet, sx, sy, w, h, 0, 0, w, h)
    c.restore()
  },
}

export interface SpriteOptions {
  /** Frame to show, instead of playing the animation. */
  frame?: number
  /** Direction (sheet row), by name or index; the first one by default. */
  direction?: string | number
  /** Mirrors the sprite left to right (a character facing west, drawn facing east). */
  flipX?: boolean
}

function wrap(i: number, n: number) {
  return ((i % n) + n) % n
}

/** Points the screen at the canvas of a game that starts (or at nothing when it stops). */
export function attachScreen(canvas: HTMLCanvasElement | null) {
  ctx = canvas?.getContext('2d') ?? null
  if (ctx) ctx.imageSmoothingEnabled = false
  screen.width = canvas?.width ?? 0
  screen.height = canvas?.height ?? 0
}

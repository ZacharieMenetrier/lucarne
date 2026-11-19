// The game's screen. Games draw in game pixels: the world they show is `screen.width` ×
// `screen.height` of them, the same on every display. The canvas itself has the display's
// own pixels: each game pixel is a square of `scale` × `scale` of them, `scale` being the
// largest whole number that fits (the runner picks it, never the game).
//
// Positions are rounded to the display's pixels, not to game pixels: whole numbers put
// things on the game's pixel grid, fractions move them smoothly between its pixels. The
// art itself is never resampled: a sprite's pixels are always whole squares.
//
// The game draws after each update, and what it draws is recorded, not shown at once.
// Each displayed frame then shows the latest recording, with what moved placed between its
// position in the update before and its position now (see interpolate.ts): motion is
// smooth whatever the display's refresh rate, while the game still updates 60 times per
// second.

import type { Sprite } from './sprites'
import { time } from './time'

/** A position, in game pixels. */
export interface Point {
  x: number
  y: number
}

/** Something drawn at a position: what interpolation moves. */
interface Placed extends Point {
  /** What it is: things with the same key are the same kind of thing (a sprite, a color). */
  key: string
  /** Where it was in the recording before, when it moved there smoothly. */
  from?: Point
}

/** One drawing call, as recorded. */
export type Command =
  | { kind: 'clear'; color: string }
  | (Placed & { kind: 'rect'; width: number; height: number; color: string })
  | (Placed & { kind: 'sprite'; sprite: Sprite; frame: number; flipX: boolean })

let ctx: CanvasRenderingContext2D | null = null
/** Display pixels per game pixel. */
let scale = 1
/** The commands of the draw in progress, or null outside the game's draw(). */
let recording: Command[] | null = null

function record(command: Command) {
  if (!recording) throw new Error("The screen can only be drawn on in the game's draw().")
  recording.push(command)
}

export const screen = {
  /** Width of the screen, in game pixels. */
  width: 0,
  /** Height of the screen, in game pixels. */
  height: 0,

  /** Fills the whole screen with a color ("#1a1c2c"). */
  clear(color: string) {
    record({ kind: 'clear', color })
  },

  /** Fills a rectangle. */
  rect(x: number, y: number, width: number, height: number, color: string) {
    record({ kind: 'rect', key: `rect ${color} ${width} ${height}`, x, y, width, height, color })
  },

  /**
   * Draws a sprite with its origin pixel on (x, y). By default it plays its animation,
   * looping, on the game's clock (`time.ms`).
   */
  sprite(s: Sprite, x: number, y: number, options: SpriteOptions = {}) {
    const frame = options.frame === undefined ? s.frameAt(time.ms) : wrap(Math.floor(options.frame), s.frames)
    record({ kind: 'sprite', key: `sprite ${s.name}`, sprite: s, x, y, frame, flipX: options.flipX ?? false })
  },
}

export interface SpriteOptions {
  /** Frame to show, instead of playing the animation. */
  frame?: number
  /** Mirrors the sprite left to right (a character facing west, drawn facing east). */
  flipX?: boolean
}

function wrap(i: number, n: number) {
  return ((i % n) + n) % n
}

/** Runs the game's draw and returns what it drew. Called by the loop after each update. */
export function recordScreen(draw: () => void): Command[] {
  recording = []
  try {
    draw()
    return recording
  } finally {
    recording = null
  }
}

/**
 * Shows a recording on the canvas. `alpha` (0 to 1) is how far the displayed frame is
 * between the update before and the last one: what moved is drawn that far along.
 */
export function presentScreen(commands: readonly Command[], alpha: number) {
  if (!ctx) return
  const c = ctx
  for (const cmd of commands) {
    if (cmd.kind === 'clear') {
      c.fillStyle = cmd.color
      c.fillRect(0, 0, screen.width * scale, screen.height * scale)
      continue
    }
    const x = cmd.from ? cmd.from.x + (cmd.x - cmd.from.x) * alpha : cmd.x
    const y = cmd.from ? cmd.from.y + (cmd.y - cmd.from.y) * alpha : cmd.y
    if (cmd.kind === 'rect') drawRect(c, x, y, cmd.width, cmd.height, cmd.color)
    else drawSprite(c, cmd.sprite, cmd.frame, x, y, cmd.flipX)
  }
}

/** A position in game pixels, in display pixels. */
function px(v: number) {
  return Math.round(v * scale)
}

function drawRect(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) {
  c.fillStyle = color
  const left = px(x)
  const top = px(y)
  c.fillRect(left, top, px(x + width) - left, px(y + height) - top)
}

function drawSprite(c: CanvasRenderingContext2D, s: Sprite, frame: number, x: number, y: number, flipX: boolean) {
  const { width: w, height: h } = s
  const sx = frame * w
  // Mirrored, the origin pixel stays under (x, y): it moves to the other side of the frame.
  const left = px(x) - (flipX ? w - 1 - s.origin.x : s.origin.x) * scale
  const top = px(y) - s.origin.y * scale
  if (!flipX) {
    c.drawImage(s.sheet, sx, 0, w, h, left, top, w * scale, h * scale)
    return
  }
  c.save()
  c.translate(left + w * scale, top)
  c.scale(-1, 1)
  c.drawImage(s.sheet, sx, 0, w, h, 0, 0, w * scale, h * scale)
  c.restore()
}

/**
 * Points the screen at the canvas of a game that starts (or at nothing when it stops).
 * The game is `width` × `height` game pixels; the canvas, a whole multiple of that.
 * Called again whenever the canvas is resized: resizing resets its drawing settings.
 */
export function attachScreen(canvas: HTMLCanvasElement | null, width = 0, height = 0) {
  ctx = canvas?.getContext('2d') ?? null
  if (ctx) ctx.imageSmoothingEnabled = false
  screen.width = canvas ? width : 0
  screen.height = canvas ? height : 0
  scale = canvas && width > 0 ? canvas.width / width : 1
}

// The game's screen. Games draw in game pixels: the world they show is `screen.width` ×
// `screen.height` of them, the same on every display. The canvas itself has the display's
// own pixels: each game pixel is a square of `scale` × `scale` of them, `scale` being the
// largest whole number that fits (the runner picks it, never the game).
//
// Positions are rounded to the display's pixels, not to game pixels: whole numbers put
// actors on the game's pixel grid, fractions move them smoothly between its pixels. The
// art itself is never resampled: a sprite's pixels are always whole squares.
//
// The screen is drawn on only while the world draws (see world.ts): in the game's `draw`
// (the background, through the camera), in an actor's `draw` (around the actor: (0, 0) is
// where it is) and in the game's `ui` (on the screen itself, over everything).

import { font as gameFont, type TextOptions } from './fonts'
import type { Sprite } from './sprites'
import { time } from './time'

let ctx: CanvasRenderingContext2D | null = null
/** Display pixels per game pixel. */
let scale = 1
/** Where (0, 0) is, in display pixels: set by the world for each actor it draws. */
let originX = 0
let originY = 0
/** What is being drawn, or null outside drawing (the screen cannot be used then). */
let phase: 'world' | 'ui' | null = null
/** The text written on the frame being drawn: what `lucarne.ui()` reports. */
let written: { text: string; x: number; y: number }[] = []
let lastWritten: { text: string; x: number; y: number }[] = []
/** The sprites' frames drawn while the editor watches (see `spriteFramesOf`), else null. */
let frames: SpriteFrame[] | null = null

/** A sprite's whole frame as drawn, transparent margins included, in game pixels. */
export interface SpriteFrame {
  x: number
  y: number
  width: number
  height: number
}

function check() {
  if (!phase) throw new Error("The screen can only be drawn on in an actor's draw(), or the game's draw() and ui().")
  return ctx
}

export const screen = {
  /** Width of the screen, in game pixels. */
  width: 0,
  /** Height of the screen, in game pixels. */
  height: 0,

  /** Fills the whole screen with a color ("#1a1c2c"). */
  clear(color: string) {
    const c = check()
    if (!c) return
    c.fillStyle = color
    c.fillRect(0, 0, screen.width * scale, screen.height * scale)
  },

  /** Fills a rectangle. */
  rect(x: number, y: number, width: number, height: number, color: string) {
    const c = check()
    if (!c) return
    c.fillStyle = color
    const left = px(x, originX)
    const top = px(y, originY)
    c.fillRect(left, top, px(x + width, originX) - left, px(y + height, originY) - top)
  },

  /**
   * Draws a sprite with its origin pixel on (x, y). By default it plays its animation,
   * looping, on the game's clock (`time.ms`; in the game's `ui`, the UI's clock, `time.uiMs`).
   */
  sprite(s: Sprite, x: number, y: number, options: SpriteOptions = {}) {
    const c = check()
    if (!c) return
    const frame = options.frame === undefined ? s.frameAt(clock()) : wrap(Math.floor(options.frame), s.frames)
    const flipX = options.flipX ?? false
    const { width: w, height: h } = s
    // Mirrored, the origin pixel stays under (x, y): it moves to the other side of the frame.
    const ox = flipX ? w - 1 - s.origin.x : s.origin.x
    frames?.push({ x: x - ox, y: y - s.origin.y, width: w, height: h })
    const left = px(x, originX) - ox * scale
    const top = px(y, originY) - s.origin.y * scale
    if (!flipX) {
      c.drawImage(s.sheet, frame * w, 0, w, h, left, top, w * scale, h * scale)
      return
    }
    c.save()
    c.translate(left + w * scale, top)
    c.scale(-1, 1)
    c.drawImage(s.sheet, frame * w, 0, w, h, 0, 0, w * scale, h * scale)
    c.restore()
  },

  /**
   * Draws a sprite as a box of any size, its top left on (x, y): its middle row and middle
   * column stretch, its edges and corners stay as drawn. A window frame is drawn once and
   * fits any text.
   */
  panel(s: Sprite, x: number, y: number, width: number, height: number) {
    const c = check()
    if (!c) return
    const frame = s.frameAt(clock())
    const sx = frame * s.width
    // The middle pixel stretches; what is before and after it stays.
    const cx = Math.floor(s.width / 2)
    const cy = Math.floor(s.height / 2)
    const xs = [0, cx, cx + 1, s.width]
    const ys = [0, cy, cy + 1, s.height]
    const right = s.width - cx - 1
    const bottom = s.height - cy - 1
    const dx = [x, x + cx, x + width - right, x + width]
    const dy = [y, y + cy, y + height - bottom, y + height]
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const left = px(dx[col], originX)
        const top = px(dy[row], originY)
        const w = px(dx[col + 1], originX) - left
        const h = px(dy[row + 1], originY) - top
        if (w <= 0 || h <= 0 || xs[col + 1] === xs[col] || ys[row + 1] === ys[row]) continue
        c.drawImage(s.sheet, sx + xs[col], ys[row], xs[col + 1] - xs[col], ys[row + 1] - ys[row], left, top, w, h)
      }
    }
  },

  /**
   * Writes text with its top left on (x, y), in the game's font (see fonts.ts). Lines
   * break at "\n", and between words to fit `options.width`.
   */
  text(text: string, x: number, y: number, color: string, options: TextOptions = {}) {
    const c = check()
    const f = options.font ?? gameFont()
    written.push({ text, x, y })
    if (!c) return
    const h = f.cellHeight
    let line = 0
    for (const content of f.lines(text, options.width)) {
      let cx = x
      const top = px(y + line * f.lineHeight, originY)
      for (const ch of content) {
        // A space is blank: nothing to stamp.
        const g = f.glyph(ch)
        if (g) c.drawImage(f.tinted(color, g), g.x, g.y, g.width, h, px(cx, originX), top, g.width * scale, h * scale)
        cx += f.advance(ch)
      }
      line++
    }
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

/** The clock animations play on: the world's, or the UI's (which `game.paused` does not stop). */
function clock() {
  return phase === 'ui' ? time.uiMs : time.ms
}

/** A position in game pixels, in display pixels, from an origin in display pixels. */
function px(v: number, origin: number) {
  return origin + Math.round(v * scale)
}

/**
 * Draws a square of `size` pixels of `sheet`, taken at (sx, sy), with its top left on (x, y)
 * in game pixels: a map's tile (see maps.ts). Whole positions land on whole display pixels,
 * so tiles side by side never leave a seam.
 */
export function drawTile(sheet: CanvasImageSource, sx: number, sy: number, size: number, x: number, y: number) {
  if (!ctx) return
  ctx.drawImage(sheet, sx, sy, size, size, px(x, originX), px(y, originY), size * scale, size * scale)
}

/** Called by the world: drawing starts, of the world or of the UI. Clears the frame first. */
export function beginDraw(what: 'world' | 'ui') {
  if (what === 'world') {
    written = []
    if (ctx) ctx.clearRect(0, 0, screen.width * scale, screen.height * scale)
  }
  phase = what
}

export function endDraw() {
  phase = null
  originX = 0
  originY = 0
  lastWritten = written
}

/** Where (0, 0) is, in display pixels. */
export function setOrigin(x: number, y: number) {
  originX = x
  originY = y
}

/**
 * Runs `draw` and returns the frames of the sprites it drew, where (0, 0) is: the editor
 * snaps an actor to the grid by the frame of its sprite (see editor/src/actortypes.ts).
 */
export function spriteFramesOf(draw: () => void): SpriteFrame[] {
  frames = []
  try {
    draw()
    return frames
  } finally {
    frames = null
  }
}

/** Display pixels per game pixel. */
export function screenScale() {
  return scale
}

/** The text written on the last frame, in screen order. */
export function writtenText(): readonly { text: string; x: number; y: number }[] {
  return lastWritten
}

/**
 * Points the screen at the canvas of a game that starts (or at nothing when it stops).
 * The game is `width` × `height` game pixels; the canvas, a whole multiple of that.
 * Called again whenever the canvas is resized: resizing resets its drawing settings.
 */
export function attachScreen(canvas: HTMLCanvasElement | OffscreenCanvas | null, width = 0, height = 0) {
  ctx = (canvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined) ?? null
  if (ctx) ctx.imageSmoothingEnabled = false
  screen.width = canvas ? width : 0
  screen.height = canvas ? height : 0
  scale = canvas && width > 0 ? canvas.width / width : 1
}

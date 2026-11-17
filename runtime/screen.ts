// The game's screen: a small canvas, in game pixels. Positions are rounded to whole
// pixels, so nothing is ever drawn between two pixels.

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
}

/** Points the screen at the canvas of a game that starts (or at nothing when it stops). */
export function attachScreen(canvas: HTMLCanvasElement | null) {
  ctx = canvas?.getContext('2d') ?? null
  if (ctx) ctx.imageSmoothingEnabled = false
  screen.width = canvas?.width ?? 0
  screen.height = canvas?.height ?? 0
}

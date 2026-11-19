/** Everything a game is made of. All parts are optional. */
export interface GameConfig {
  /**
   * Width of the world on screen, in game pixels (320 by default). Every display shows
   * exactly this much: the engine scales it by the largest whole number that fits, with
   * black bars around.
   */
  width?: number
  /** Height of the world on screen, in game pixels (180 by default). See `width`. */
  height?: number
  /** Called once, before the first update. */
  start?(): void
  /** Called 60 times per second, whatever the display's refresh rate. Move things here. */
  update?(): void
  /**
   * Called after each update. Draw here, with `screen` (and only here). Only draw: change
   * nothing in the game. The engine shows what moved smoothly between two updates on every
   * display, at 60, 120 or 144 Hz.
   */
  draw?(): void
}

/** Declares the game. `code/main.ts` exports its result: `export default game({ … })`. */
export function game(config: GameConfig): GameConfig {
  return config
}

export const DEFAULT_WIDTH = 320
export const DEFAULT_HEIGHT = 180
/** Updates per second. */
export const TICK_RATE = 60

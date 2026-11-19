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
  /**
   * Called once when the game starts, before the first update. The world is empty then:
   * create the game's things here (or at the top of `code/main.ts`, which also runs anew
   * each time the game starts).
   */
  start?(): void
  /**
   * Draws the world's background, through the camera, under the things: on every
   * displayed frame. Only draw: change nothing in the game. What moves is a thing (see
   * `Thing`), drawn smoothly between its updates.
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

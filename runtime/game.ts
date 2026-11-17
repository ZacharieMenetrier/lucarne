/** Everything a game is made of. All parts are optional. */
export interface GameConfig {
  /** Width of the game's screen, in pixels (320 by default). */
  width?: number
  /** Height of the game's screen, in pixels (180 by default). */
  height?: number
  /** Called once, before the first update. */
  start?(): void
  /** Called 60 times per second, whatever the display's refresh rate. Move things here. */
  update?(): void
  /** Called once per displayed frame, after the updates. Draw here, with `screen`. */
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

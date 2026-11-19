/** What a game's code declares: what it does. All parts are optional. Its settings (its
 * resolution, its tile size) are in game.json, which the editor writes (see `GameSettings`). */
export interface GameConfig {
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

/**
 * The settings of the whole game, in game.json at the root of the game folder:
 * `{ "width": 384, "height": 216, "tileSize": 16 }`. Every one is optional.
 *
 * They are not in the code: the editor needs them to paint maps, and reading them from the
 * code would mean running the game (and nothing could be painted while the code is broken).
 */
export interface GameSettings {
  /**
   * Width of the world on screen, in game pixels. Every display shows exactly this much:
   * the engine scales it by the largest whole number that fits, with black bars around.
   */
  width: number
  /** Height of the world on screen, in game pixels. See `width`. */
  height: number
  /** Size of a tile (a square), in game pixels: tilesets are cut in tiles of that size. */
  tileSize: number
}

export const DEFAULT_WIDTH = 320
export const DEFAULT_HEIGHT = 180
/** The most common tile size in pixel art: most games never set it. */
export const DEFAULT_TILE_SIZE = 16
export const DEFAULT_SETTINGS: GameSettings = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, tileSize: DEFAULT_TILE_SIZE }

/** Bounds of each setting, in game pixels. */
export const SETTING_LIMITS: Record<keyof GameSettings, { min: number; max: number }> = {
  width: { min: 16, max: 4096 },
  height: { min: 16, max: 4096 },
  // 64 at most: a tileset is 8 tiles wide, and an image is 512 pixels at most.
  tileSize: { min: 4, max: 64 },
}

/** Reads game.json (null: no file), tolerating missing or wrong fields: they get their default. */
export function parseSettings(text: string | null): GameSettings {
  let raw: Record<string, unknown> = {}
  if (text !== null) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
    } catch {
      // A broken file counts as no file: the defaults.
    }
  }
  const read = (key: keyof GameSettings) => {
    const v = raw[key]
    const { min, max } = SETTING_LIMITS[key]
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : DEFAULT_SETTINGS[key]
  }
  return { width: read('width'), height: read('height'), tileSize: read('tileSize') }
}

/** game.json as the editor writes it: every setting, so the file says what the game is. */
export function serializeSettings(s: GameSettings): string {
  return `{ "width": ${s.width}, "height": ${s.height}, "tileSize": ${s.tileSize} }\n`
}

/** Updates per second. */
export const TICK_RATE = 60

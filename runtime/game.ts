/** What a game's code declares: what it does. All parts are optional. Its settings (its
 * resolution, its tile size) are in game.json, which the editor writes (see `GameSettings`). */
export interface GameConfig {
  /**
   * Called once when the game starts, before the first update. The actors placed on the
   * maps are in the world then, after the ones `code/main.ts` created at its top level
   * (which also runs anew each time the game starts).
   */
  start?(): void
  /**
   * Draws the world's background, through the camera, under the actors: on every
   * displayed frame. Only draw: change nothing in the game. What moves is an actor (see
   * `Actor`), drawn smoothly between its updates.
   */
  draw?(): void
}

/** Declares the game. `code/main.ts` exports its result: `export default game({ … })`. */
export function game(config: GameConfig): GameConfig {
  return config
}

/**
 * The settings of the whole game, in game.json at the root of the game folder:
 * `{ "columns": 20, "rows": 11, "tileSize": 16 }`. Every one is optional.
 *
 * The screen is counted in tiles, so it always holds whole tiles: the smallest map (one
 * screen) fits it exactly. `screenSize` gives it in game pixels.
 *
 * They are not in the code: the editor needs them to paint maps, and reading them from the
 * code would mean running the game (and nothing could be painted while the code is broken).
 */
export interface GameSettings {
  /**
   * Width of the screen, in tiles. Every display shows exactly this much of the world: the
   * engine scales it by the largest whole number that fits, with black bars around.
   */
  columns: number
  /** Height of the screen, in tiles. See `columns`. */
  rows: number
  /** Size of a tile (a square), in game pixels: tilesets are cut in tiles of that size. */
  tileSize: number
}

/** 320 × 176 pixels: ×6 on a 1080p display, with thin bars above and below. */
export const DEFAULT_COLUMNS = 20
export const DEFAULT_ROWS = 11
/** The most common tile size in pixel art: most games never set it. */
export const DEFAULT_TILE_SIZE = 16
export const DEFAULT_SETTINGS: GameSettings = { columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS, tileSize: DEFAULT_TILE_SIZE }

/** Bounds of each setting: the screen in tiles, the tile size in game pixels. */
export const SETTING_LIMITS: Record<keyof GameSettings, { min: number; max: number }> = {
  columns: { min: 1, max: 256 },
  rows: { min: 1, max: 256 },
  // 64 at most: a tileset is 8 tiles wide, and an image is 512 pixels at most.
  tileSize: { min: 4, max: 64 },
}

/** The screen's width and height, in game pixels, at most this much. */
export const MAX_SCREEN_PIXELS = 4096

/** The screen, in game pixels: what the game shows of the world. */
export function screenSize(s: GameSettings): { width: number; height: number } {
  return { width: s.columns * s.tileSize, height: s.rows * s.tileSize }
}

/** What is wrong with these settings, for a person to read, or null if nothing is. */
export function settingsError(s: GameSettings): string | null {
  const names = { columns: 'Columns', rows: 'Rows', tileSize: 'Tile size' }
  for (const key of ['columns', 'rows', 'tileSize'] as const) {
    const { min, max } = SETTING_LIMITS[key]
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max) {
      return `${names[key]}: a whole number between ${min} and ${max}.`
    }
  }
  const { width, height } = screenSize(s)
  if (width > MAX_SCREEN_PIXELS || height > MAX_SCREEN_PIXELS) {
    return `The screen would be ${width} × ${height} pixels: ${MAX_SCREEN_PIXELS} at most each way.`
  }
  return null
}

/**
 * Reads game.json (null: no file), tolerating missing or wrong fields: they get their default.
 * An older game.json gives the screen in pixels (`width`, `height`): it becomes the whole
 * tiles that fit in it.
 */
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
  const whole = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
  const read = (key: keyof GameSettings) => {
    const { min, max } = SETTING_LIMITS[key]
    return whole(raw[key], min, max)
  }
  const tileSize = read('tileSize') ?? DEFAULT_TILE_SIZE
  const inTiles = (pixels: unknown) => {
    const v = whole(pixels, 1, MAX_SCREEN_PIXELS)
    return v === null ? null : Math.max(1, Math.floor(v / tileSize))
  }
  const fit = (n: number) => Math.min(n, Math.floor(MAX_SCREEN_PIXELS / tileSize))
  return {
    columns: fit(read('columns') ?? inTiles(raw.width) ?? DEFAULT_COLUMNS),
    rows: fit(read('rows') ?? inTiles(raw.height) ?? DEFAULT_ROWS),
    tileSize,
  }
}

/** game.json as the editor writes it: every setting, so the file says what the game is. */
export function serializeSettings(s: GameSettings): string {
  return `{ "columns": ${s.columns}, "rows": ${s.rows}, "tileSize": ${s.tileSize} }\n`
}

/** Updates per second. */
export const TICK_RATE = 60

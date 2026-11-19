// The game folder as the editor sees it: the settings, the palette, the sprites, the
// tilesets, the maps and the fonts.

import { Bitmap, resized } from './bitmap'
import { parseBoard, serializeBoard, type BoardFile } from './board'
import { isHex } from './color'
import { parseFontMeta, serializeFontMeta, type FontMeta, type ImportedFont } from './font'
import { parseSettings, serializeSettings, type GameSettings } from '../../runtime/game'
import { parseMap, serializeMap, type GameMap } from './map'
import { decodePng, encodePng } from './png'
import {
  NAME_RE,
  TILESET_COLUMNS,
  TILESET_PREFIX,
  composeSheet,
  isTileset,
  tilesetName,
  defaultMeta,
  parseMeta,
  serializeMeta,
  splitSheet,
  type Sprite,
} from './sprite'
import { readText, writeText, type Storage } from './storage'

/** Default palette for a new project: Sweetie 16, by GrafxKid. */
export const DEFAULT_PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
]

/** Beyond this, the editor shows a warning (without blocking anything). */
export const PALETTE_WARNING = 32

const PALETTE_FILE = 'palette.json'
const BOARD_FILE = 'board.json'
const SPRITES_DIR = 'sprites'
const FONTS_DIR = 'fonts'
const SETTINGS_FILE = 'game.json'
const TILES_DIR = 'tiles'
const MAPS_DIR = 'maps'

export function parsePalette(text: string): string[] {
  const raw = JSON.parse(text) as unknown
  const list = Array.isArray(raw) ? raw : (raw as { colors?: unknown })?.colors
  if (!Array.isArray(list)) throw new Error('palette.json must contain a list of colors')
  return list.filter((c): c is string => typeof c === 'string' && isHex(c)).map(normalizeHex)
}

export function normalizeHex(hex: string) {
  const h = hex.trim().toLowerCase()
  return h.startsWith('#') ? h : `#${h}`
}

export class Project {
  palette: string[] = []
  settings: GameSettings = parseSettings(null)

  constructor(readonly storage: Storage) {}

  get name() {
    return this.storage.label
  }

  async load() {
    await this.loadSettings()
    const text = await readText(this.storage, PALETTE_FILE)
    if (text === null) {
      this.palette = [...DEFAULT_PALETTE]
      await this.savePalette()
    } else {
      this.palette = parsePalette(text)
    }
  }

  /** Reads game.json again (it may have been changed by hand, or synced). */
  async loadSettings(): Promise<GameSettings> {
    this.settings = parseSettings(await readText(this.storage, SETTINGS_FILE))
    return this.settings
  }

  async saveSettings(settings: GameSettings) {
    await writeText(this.storage, SETTINGS_FILE, serializeSettings(settings))
    this.settings = settings
  }

  async savePalette() {
    await writeText(this.storage, PALETTE_FILE, JSON.stringify(this.palette, null, 2) + '\n')
  }

  /** Sprite positions and board color (empty if the file is missing or unreadable). */
  async loadBoard(): Promise<BoardFile> {
    const empty: BoardFile = { placements: new Map(), background: null, paletteRows: null }
    const text = await readText(this.storage, BOARD_FILE)
    if (text === null) return empty
    try {
      return parseBoard(text)
    } catch {
      return empty
    }
  }

  async saveBoard(board: BoardFile) {
    await writeText(this.storage, BOARD_FILE, serializeBoard(board))
  }

  /** Sprite names (a PNG alone, without JSON, counts too). */
  async listSprites(): Promise<string[]> {
    const names = new Set<string>()
    for (const file of await this.storage.list(SPRITES_DIR)) {
      const m = /^(.+)\.(png|json)$/.exec(file)
      if (m && NAME_RE.test(m[1])) names.add(m[1])
    }
    return [...names].sort()
  }

  /** What sits on the board: the sprites, then the tilesets ("tiles/<name>"). */
  async listBoard(): Promise<string[]> {
    const [sprites, tiles] = await Promise.all([this.listSprites(), this.storage.list(TILES_DIR)])
    const tilesets = tiles
      .map((f) => /^(.+)\.png$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && NAME_RE.test(n))
      .sort()
      .map((n) => TILESET_PREFIX + n)
    return [...sprites, ...tilesets]
  }

  /** A sprite, or a tileset ("tiles/<name>": one frame, cut in tiles by the game). */
  async loadSprite(name: string): Promise<Sprite> {
    if (isTileset(name)) {
      const png = await this.storage.read(`${TILES_DIR}/${tilesetName(name)}.png`)
      if (!png) throw new Error(`Tileset not found: ${tilesetName(name)}`)
      const sheet = widenTileset(await decodePng(png), this.settings.tileSize)
      return { name, meta: defaultMeta(sheet.width, sheet.height), frames: [sheet] }
    }
    const [png, json] = await Promise.all([
      this.storage.read(`${SPRITES_DIR}/${name}.png`),
      readText(this.storage, `${SPRITES_DIR}/${name}.json`),
    ])
    if (!png && json === null) throw new Error(`Sprite not found: ${name}`)
    const sheet = png ? await decodePng(png) : null
    const meta = json !== null ? parseMeta(json) : defaultMeta(sheet!.width, sheet!.height)
    const filled = sheet ?? new Bitmap(meta.frameWidth * meta.frames.length, meta.frameHeight)
    return { name, meta, frames: splitSheet(filled, meta) }
  }

  async saveSprite(sprite: Sprite) {
    if (isTileset(sprite.name)) {
      await this.storage.write(`${TILES_DIR}/${tilesetName(sprite.name)}.png`, await encodePng(sprite.frames[0]))
      return
    }
    const png = await encodePng(composeSheet(sprite))
    await this.storage.write(`${SPRITES_DIR}/${sprite.name}.png`, png)
    await writeText(this.storage, `${SPRITES_DIR}/${sprite.name}.json`, serializeMeta(sprite.meta))
  }

  /** Font names: fonts/<name>.png with its .json. */
  async listFonts(): Promise<string[]> {
    const files = new Set(await this.storage.list(FONTS_DIR))
    return [...files]
      .map((f) => /^(.+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && files.has(`${n}.png`))
      .sort()
  }

  async loadFont(name: string): Promise<{ sheet: Bitmap; meta: FontMeta }> {
    const [png, json] = await Promise.all([
      this.storage.read(`${FONTS_DIR}/${name}.png`),
      readText(this.storage, `${FONTS_DIR}/${name}.json`),
    ])
    if (!png || json === null) throw new Error(`Font not found: ${name}`)
    return { sheet: await decodePng(png), meta: parseFontMeta(json) }
  }

  /** Saves a font, and its license when there is one (it travels with the font). */
  async saveFont(name: string, font: ImportedFont, license: string | null) {
    await this.storage.write(`${FONTS_DIR}/${name}.png`, await encodePng(font.sheet))
    await writeText(this.storage, `${FONTS_DIR}/${name}.json`, serializeFontMeta(font.meta))
    if (license !== null) await writeText(this.storage, `${FONTS_DIR}/${name}.license.txt`, license)
  }

  async deleteSprite(name: string) {
    if (isTileset(name)) return this.storage.remove(`${TILES_DIR}/${tilesetName(name)}.png`)
    await this.storage.remove(`${SPRITES_DIR}/${name}.png`)
    await this.storage.remove(`${SPRITES_DIR}/${name}.json`)
  }

  /** Map names: maps/<name>.json. */
  async listMaps(): Promise<string[]> {
    return (await this.storage.list(MAPS_DIR))
      .map((f) => /^(.+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && NAME_RE.test(n))
      .sort()
  }

  async loadMap(name: string): Promise<GameMap> {
    const text = await readText(this.storage, `${MAPS_DIR}/${name}.json`)
    if (text === null) throw new Error(`Map not found: ${name}`)
    try {
      return parseMap(name, text)
    } catch (err) {
      throw new Error(`The map "${name}" could not be read: ${(err as Error).message}`)
    }
  }

  async saveMap(map: GameMap) {
    await writeText(this.storage, `${MAPS_DIR}/${map.name}.json`, serializeMap(map))
  }

  async deleteMap(name: string) {
    await this.storage.remove(`${MAPS_DIR}/${name}.json`)
  }
}

/** A tileset narrower than TILESET_COLUMNS tiles (made elsewhere, or before the rule) gets
 *  empty columns on its right: its tiles keep their column and row, so maps are unchanged.
 *  A wider one is left as it is: cutting it would lose tiles. */
export function widenTileset(sheet: Bitmap, tileSize: number): Bitmap {
  const w = TILESET_COLUMNS * tileSize
  return sheet.width < w ? resized(sheet, w, sheet.height, 0, 0) : sheet
}

// The game folder as the editor sees it: the settings, the palette, the sprites, the
// tilesets, the actor files' values, the maps, the fonts, the instruments and the songs.

import { ACTORS_DIR, parseActorFile, serializeActorFile, type Values } from './actors'
import { Bitmap, resized } from './bitmap'
import { parseBoard, serializeBoard, type BoardFile } from './board'
import { isHex } from './color'
import { parseFontMeta, serializeFontMeta, type FontMeta, type ImportedFont } from './font'
import { parseSettings, serializeSettings, type GameSettings } from '../../runtime/game'
import { parseMap, serializeMap, type GameMap } from './map'
import { decodeWav, encodeWav, noteName, noteNumber, parseSong, serializeSong, type Song } from '../../runtime/sound'
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
  parseTileBoxes,
  serializeMeta,
  serializeTileBoxes,
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
const INSTRUMENTS_DIR = 'instruments'
const SONGS_DIR = 'songs'

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
      const base = `${TILES_DIR}/${tilesetName(name)}`
      const [png, json] = await Promise.all([this.storage.read(`${base}.png`), readText(this.storage, `${base}.json`)])
      if (!png) throw new Error(`Tileset not found: ${tilesetName(name)}`)
      const sheet = widenTileset(await decodePng(png), this.settings.tileSize)
      const meta = defaultMeta(sheet.width, sheet.height)
      const solid = json === null ? [] : parseTileBoxes(json, this.settings.tileSize)
      if (solid.length) meta.solid = solid
      return { name, meta, frames: [sheet] }
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
      const base = `${TILES_DIR}/${tilesetName(sprite.name)}`
      await this.storage.write(`${base}.png`, await encodePng(sprite.frames[0]))
      // The JSON only says which tiles are solid: none, no file.
      const solid = sprite.meta.solid ?? []
      if (solid.length) await writeText(this.storage, `${base}.json`, serializeTileBoxes(solid))
      else await this.storage.remove(`${base}.json`)
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
    if (isTileset(name)) {
      await this.storage.remove(`${TILES_DIR}/${tilesetName(name)}.png`)
      await this.storage.remove(`${TILES_DIR}/${tilesetName(name)}.json`)
      return
    }
    await this.storage.remove(`${SPRITES_DIR}/${name}.png`)
    await this.storage.remove(`${SPRITES_DIR}/${name}.json`)
  }

  /** The values of every actor file (actors/<name>.json), by actor name. */
  async loadActorFiles(): Promise<Map<string, Values>> {
    const names = (await this.storage.list(ACTORS_DIR))
      .map((f) => /^(.+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && NAME_RE.test(n))
      .sort()
    const out = new Map<string, Values>()
    for (const name of names) {
      const text = await readText(this.storage, `${ACTORS_DIR}/${name}.json`)
      if (text === null) continue
      try {
        out.set(name, parseActorFile(text))
      } catch (err) {
        throw new Error(`${ACTORS_DIR}/${name}.json could not be read: ${(err as Error).message}`)
      }
    }
    return out
  }

  /** Saves an actor's file; with no value set, there is no file. */
  async saveActorFile(name: string, values: Values) {
    const path = `${ACTORS_DIR}/${name}.json`
    if (Object.keys(values).length) await writeText(this.storage, path, serializeActorFile(values))
    else await this.storage.remove(path)
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

  /** The game's own instruments: instruments/<name>.wav (its .json, when it has a note). */
  async listInstruments(): Promise<string[]> {
    return (await this.storage.list(INSTRUMENTS_DIR))
      .map((f) => /^(.+)\.wav$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && NAME_RE.test(n))
      .sort()
  }

  /** A game's instrument: its recording, and its note (none: a drum). */
  async loadInstrument(name: string): Promise<{ data: Float32Array; note: number | null }> {
    const [wav, json] = await Promise.all([
      this.storage.read(`${INSTRUMENTS_DIR}/${name}.wav`),
      readText(this.storage, `${INSTRUMENTS_DIR}/${name}.json`),
    ])
    if (!wav) throw new Error(`Instrument not found: ${name}`)
    return { data: decodeWav(wav).data, note: json === null ? null : parseInstrumentFile(json) }
  }

  /** Saves an instrument as it plays; with no note, there is no .json. */
  async saveInstrument(name: string, data: Float32Array, note: number | null, license: string | null = null) {
    await this.storage.write(`${INSTRUMENTS_DIR}/${name}.wav`, encodeWav(data))
    await this.setInstrumentNote(name, note)
    if (license !== null) await writeText(this.storage, `${INSTRUMENTS_DIR}/${name}.license.txt`, license)
  }

  async setInstrumentNote(name: string, note: number | null) {
    const path = `${INSTRUMENTS_DIR}/${name}.json`
    if (note === null) await this.storage.remove(path)
    else await writeText(this.storage, path, `{ "note": "${noteName(note)}" }\n`)
  }

  async deleteInstrument(name: string) {
    for (const ext of ['wav', 'json', 'license.txt']) await this.storage.remove(`${INSTRUMENTS_DIR}/${name}.${ext}`)
  }

  /** Song names: songs/<name>.json. */
  async listSongs(): Promise<string[]> {
    return (await this.storage.list(SONGS_DIR))
      .map((f) => /^(.+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && NAME_RE.test(n))
      .sort()
  }

  async loadSong(name: string): Promise<Song> {
    const text = await readText(this.storage, `${SONGS_DIR}/${name}.json`)
    if (text === null) throw new Error(`Song not found: ${name}`)
    try {
      return parseSong(text)
    } catch (err) {
      throw new Error(`The song "${name}" could not be read: ${(err as Error).message}`)
    }
  }

  async saveSong(name: string, song: Song) {
    await writeText(this.storage, `${SONGS_DIR}/${name}.json`, serializeSong(song))
  }

  async deleteSong(name: string) {
    await this.storage.remove(`${SONGS_DIR}/${name}.json`)
  }
}

/** An instrument's .json: `{ "note": "C5" }`. */
export function parseInstrumentFile(text: string): number | null {
  const raw = JSON.parse(text) as { note?: unknown }
  return typeof raw?.note === 'string' ? noteNumber(raw.note) : null
}

/** A tileset narrower than TILESET_COLUMNS tiles (made elsewhere, or before the rule) gets
 *  empty columns on its right: its tiles keep their column and row, so maps are unchanged.
 *  A wider one is left as it is: cutting it would lose tiles. */
export function widenTileset(sheet: Bitmap, tileSize: number): Bitmap {
  const w = TILESET_COLUMNS * tileSize
  return sheet.width < w ? resized(sheet, w, sheet.height, 0, 0) : sheet
}

// The game folder as the editor sees it: the palette and the sprites.

import { Bitmap } from './bitmap'
import { parseBoard, serializeBoard, type BoardFile } from './board'
import { isHex } from './color'
import { decodePng, encodePng } from './png'
import {
  NAME_RE,
  composeSheet,
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

  constructor(readonly storage: Storage) {}

  get name() {
    return this.storage.label
  }

  async load() {
    const text = await readText(this.storage, PALETTE_FILE)
    if (text === null) {
      this.palette = [...DEFAULT_PALETTE]
      await this.savePalette()
    } else {
      this.palette = parsePalette(text)
    }
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

  async loadSprite(name: string): Promise<Sprite> {
    const [png, json] = await Promise.all([
      this.storage.read(`${SPRITES_DIR}/${name}.png`),
      readText(this.storage, `${SPRITES_DIR}/${name}.json`),
    ])
    if (!png && json === null) throw new Error(`Sprite not found: ${name}`)
    const sheet = png ? await decodePng(png) : null
    const meta = json !== null ? parseMeta(json) : defaultMeta(sheet!.width, sheet!.height)
    const filled =
      sheet ?? new Bitmap(meta.frameWidth * meta.frames.length, meta.frameHeight * meta.directions.length)
    return { name, meta, frames: splitSheet(filled, meta) }
  }

  async saveSprite(sprite: Sprite) {
    const png = await encodePng(composeSheet(sprite))
    await this.storage.write(`${SPRITES_DIR}/${sprite.name}.png`, png)
    await writeText(this.storage, `${SPRITES_DIR}/${sprite.name}.json`, serializeMeta(sprite.meta))
  }

  async deleteSprite(name: string) {
    await this.storage.remove(`${SPRITES_DIR}/${name}.png`)
    await this.storage.remove(`${SPRITES_DIR}/${name}.json`)
  }
}

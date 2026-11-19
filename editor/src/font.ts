// Fonts: fonts/<name>.png (the characters in white, in a grid of cells) and
// fonts/<name>.json (which character is in which cell, and how wide each one is), with the
// font's license next to them (fonts/<name>.license.txt).
//
// The engine stamps a font's characters on whole game pixels: the browser never draws text
// in a game. The editor makes a font by importing a pixel font file (.ttf, .otf, .woff):
// the browser draws each character once, ten times larger than the size it is made for,
// and its pixels are read back at the center of each of its squares. Done once, at import,
// so every device then shows exactly the same pixels.

import { Bitmap } from './bitmap'
import { hexToColor } from './color'

export interface FontMeta {
  version: 1
  /** Size of a cell, in pixels: the box every character is drawn in, from its left. */
  cellWidth: number
  cellHeight: number
  /** Cells per row of the sheet. */
  columns: number
  /** The characters, in the order of the cells. */
  characters: string
  /** For each character, how far the next one starts, in pixels (the gap included). */
  advances: number[]
}

/** A font as imported: its sheet and its description. */
export interface ImportedFont {
  sheet: Bitmap
  meta: FontMeta
}

/** Names are those of files: lowercase letters, digits, - and _. */
export const FONT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

const WHITE = hexToColor('#ffffff')
const COLUMNS = 32

export function parseFontMeta(text: string): FontMeta {
  const raw = JSON.parse(text) as Partial<FontMeta>
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0
  if (!int(raw.cellWidth) || !int(raw.cellHeight) || !int(raw.columns)) throw new Error('cellWidth, cellHeight and columns must be whole numbers')
  if (typeof raw.characters !== 'string' || !Array.isArray(raw.advances)) throw new Error('characters and advances are missing')
  if ([...raw.characters].length !== raw.advances.length) throw new Error('there must be one advance per character')
  return {
    version: 1,
    cellWidth: raw.cellWidth!,
    cellHeight: raw.cellHeight!,
    columns: raw.columns!,
    characters: raw.characters,
    advances: raw.advances.map((w) => Math.max(0, Math.round(Number(w) || 0))),
  }
}

export function serializeFontMeta(meta: FontMeta) {
  const { advances, ...rest } = meta
  // One line for the advances, so the file stays short and readable.
  return JSON.stringify(rest, null, 2).replace(/\n}$/, `,\n  "advances": ${JSON.stringify(advances)}\n}`) + '\n'
}

/** One character as read from the font: its pixels, from the cell's left. */
export interface Glyph {
  ch: string
  /** Rows of the character, top to bottom: which pixels are ink. */
  rows: boolean[][]
  advance: number
}

/** Lays characters out in a sheet, in the order given. */
export function buildFont(glyphs: Glyph[], cellHeight: number): ImportedFont {
  const cellWidth = Math.max(1, ...glyphs.map((g) => g.advance))
  const rows = Math.ceil(glyphs.length / COLUMNS)
  const sheet = new Bitmap(COLUMNS * cellWidth, rows * cellHeight)
  glyphs.forEach((g, i) => {
    const ox = (i % COLUMNS) * cellWidth
    const oy = Math.floor(i / COLUMNS) * cellHeight
    g.rows.forEach((row, y) => row.forEach((ink, x) => ink && sheet.set(ox + x, oy + y, WHITE)))
  })
  return {
    sheet,
    meta: {
      version: 1,
      cellWidth,
      cellHeight,
      columns: COLUMNS,
      characters: glyphs.map((g) => g.ch).join(''),
      advances: glyphs.map((g) => g.advance),
    },
  }
}

/** Characters looked for in a .ttf: Latin, with accents, and common punctuation. */
function candidates(): string[] {
  const out: string[] = []
  const add = (from: number, to: number) => {
    for (let c = from; c <= to; c++) out.push(String.fromCodePoint(c))
  }
  add(0x20, 0x7e)
  add(0xa0, 0x24f)
  add(0x2010, 0x2027)
  add(0x20ac, 0x20ac)
  add(0x2190, 0x2193)
  add(0x2665, 0x2665)
  return out
}

/** Each pixel of the font is drawn this many times larger, then read at its center. */
const ZOOM = 10

/**
 * Reads a pixel font file (.ttf, .otf, .woff…) drawn at `pixelSize` (the size it is made
 * for, in pixels: one square of the font is then one pixel). Characters the font lacks are
 * left out: the browser would draw them with another font.
 */
export async function fontFromFile(bytes: ArrayBuffer, pixelSize: number): Promise<ImportedFont> {
  const family = `lucarne-import-${Date.now()}`
  const face = new FontFace(family, bytes)
  await face.load()
  document.fonts.add(face)
  try {
    const size = pixelSize * ZOOM
    const canvas = new OffscreenCanvas(size * 4, size * 3)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.textBaseline = 'alphabetic'
    // The font's own ascent and descent give the line's height.
    ctx.font = `${size}px "${family}"`
    const m = ctx.measureText('Hg')
    const ascent = Math.round(m.fontBoundingBoxAscent / ZOOM)
    const height = Math.max(1, ascent + Math.round(m.fontBoundingBoxDescent / ZOOM))
    const baseline = ascent * ZOOM

    /** The character drawn with these fonts, read back pixel by pixel. */
    const read = (ch: string, fonts: string) => {
      ctx.font = `${size}px ${fonts}`
      const width = Math.round(ctx.measureText(ch).width / ZOOM)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#000'
      ctx.fillText(ch, 0, baseline)
      const w = Math.min(width, Math.floor(canvas.width / ZOOM))
      const img = ctx.getImageData(0, 0, Math.max(1, w * ZOOM), height * ZOOM).data
      const rows: boolean[][] = []
      for (let y = 0; y < height; y++) {
        const row: boolean[] = []
        for (let x = 0; x < w; x++) {
          const at = ((y * ZOOM + ZOOM / 2) * w * ZOOM + x * ZOOM + ZOOM / 2) * 4
          row.push(img[at + 3] > 127)
        }
        rows.push(row)
      }
      return { width, rows, key: `${width}:${rows.map((r) => r.map(Number).join('')).join('|')}` }
    }

    const glyphs: Glyph[] = []
    for (const ch of candidates()) {
      // A character the font lacks comes from the fallback font: with two different
      // fallbacks, it looks different. One the font has looks the same both times.
      const a = read(ch, `"${family}", monospace`)
      const b = read(ch, `"${family}", serif`)
      if (a.key !== b.key || (a.width === 0 && ch !== ' ')) continue
      glyphs.push({ ch, rows: a.rows, advance: a.width })
    }
    if (glyphs.length < 10) throw new Error('This font has almost no characters, or the browser could not read it.')
    return buildFont(glyphs, height)
  } finally {
    document.fonts.delete(face)
  }
}

/** A file name turned into a font name: "BoldPixels.ttf" → "boldpixels". */
export function fontName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '')
  const name = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return FONT_NAME_RE.test(name) ? name : 'font'
}

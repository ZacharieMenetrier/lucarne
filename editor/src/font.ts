// Fonts in the editor: fonts/<name>.png, on the board as "fonts/<name>" (see
// runtime/fonts.ts for what the image means: a fixed grid of characters, ink and spacing
// read from the pixels).
//
// A font is made by drawing it on the board, or by importing a pixel font file (.ttf, .otf,
// .woff). Its size is found from its characters' ink, read from the file (ttf.ts): the size
// at which their widths and heights are whole pixels. The browser then draws each character
// ten times larger, its ink starting on a pixel, and a pixel is ink when most of its square
// is. Any other font gives what it gives, to be fixed by hand. Done once, at import, so
// every device then shows exactly the same pixels.

import { Bitmap } from './bitmap'
import { hexToColor, TRANSPARENT } from './color'
import { FONT_CHARACTERS, FONT_COLUMNS, FONT_ROWS } from '../../runtime/fonts'
import { readFontFile } from './ttf'

const WHITE = hexToColor('#ffffff')

/** Size of a blank font's cells: the smallest that holds a readable letter with accents. */
export const NEW_FONT_CELL = 8

/** The size of a font's cells, from its image. */
export function fontCell(sheet: Bitmap) {
  return { width: Math.max(1, Math.floor(sheet.width / FONT_COLUMNS)), height: Math.max(1, Math.floor(sheet.height / FONT_ROWS)) }
}

/** A font's image for cells of this size. */
export function fontSheetSize(cellWidth: number, cellHeight: number) {
  return { width: cellWidth * FONT_COLUMNS, height: cellHeight * FONT_ROWS }
}

/** An empty font, with cells of this size. */
export function blankFont(cellWidth = NEW_FONT_CELL, cellHeight = NEW_FONT_CELL) {
  const { width, height } = fontSheetSize(cellWidth, cellHeight)
  return new Bitmap(width, height)
}

/**
 * The same characters in cells of another size: each keeps its top left, and is cut if
 * its cell got smaller. (Resizing a font changes its cells, never the grid.)
 */
export function relayoutFont(sheet: Bitmap, cellWidth: number, cellHeight: number): Bitmap {
  const from = fontCell(sheet)
  const { width, height } = fontSheetSize(cellWidth, cellHeight)
  const out = new Bitmap(width, height)
  const w = Math.min(from.width, cellWidth)
  const h = Math.min(from.height, cellHeight)
  for (let i = 0; i < FONT_COLUMNS * FONT_ROWS; i++) {
    const col = i % FONT_COLUMNS
    const row = Math.floor(i / FONT_COLUMNS)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out.set(col * cellWidth + x, row * cellHeight + y, sheet.get(col * from.width + x, row * from.height + y))
    }
  }
  return out
}

/** The ink of a font, in white, as it is saved: its color is the text's, chosen by the game. */
export function whiteInk(sheet: Bitmap): Bitmap {
  const out = new Bitmap(sheet.width, sheet.height)
  for (let i = 0; i < sheet.data.length; i++) out.data[i] = sheet.data[i] === TRANSPARENT ? TRANSPARENT : WHITE
  return out
}

/** One character as read from a font file: which pixels are ink, from its first column. */
export interface Glyph {
  ch: string
  /** Rows, top to bottom. */
  rows: boolean[][]
}

/** Puts characters in their cells (each from its first column of ink), in a sheet whose cells
 * hold the widest one. Characters that are not in FONT_CHARACTERS are left out. */
export function buildFont(glyphs: Glyph[], cellHeight: number): Bitmap {
  const trimmed = glyphs.map((g) => {
    const first = Math.min(...g.rows.map((r) => r.indexOf(true)).filter((i) => i >= 0))
    return { ch: g.ch, rows: Number.isFinite(first) ? g.rows.map((r) => r.slice(first)) : [] }
  })
  const width = (rows: boolean[][]) => Math.max(0, ...rows.map((r) => r.lastIndexOf(true) + 1))
  const cellWidth = Math.max(1, ...trimmed.map((g) => width(g.rows)))
  const sheet = blankFont(cellWidth, cellHeight)
  const cells = new Map([...FONT_CHARACTERS].map((ch, i) => [ch, i]))
  for (const g of trimmed) {
    const i = cells.get(g.ch)
    if (i === undefined) continue
    const ox = (i % FONT_COLUMNS) * cellWidth
    const oy = Math.floor(i / FONT_COLUMNS) * cellHeight
    g.rows.slice(0, cellHeight).forEach((row, y) => row.forEach((ink, x) => ink && sheet.set(ox + x, oy + y, WHITE)))
  }
  return sheet
}

/** Each pixel of the font is drawn this many times larger, then read. */
const ZOOM = 10
/** A pixel is ink when most of its square is: lower, a font that is not quite on its grid
 * gets thicker strokes; higher, thinner ones. */
const INK_SHARE = 0.5
/** Sizes looked at, in pixels, and how finely: a font's pixel is not always a whole
 * fraction of its em (Pixelify Sans has 10.85 to the em). */
const MIN_SIZE = 5
const MAX_SIZE = 32
const SIZE_STEPS = 20

/**
 * The pixel size a font is made for, from the size of its characters' ink (`extents`: their
 * widths and heights, in ems): the size at which they are closest to whole pixels, and of
 * sizes as close, the smallest (a pixel font fits just as well at twice its size).
 */
export function pixelSize(extents: number[]): number {
  const misfit = (size: number) => extents.reduce((sum, v) => sum + Math.abs(v * size - Math.round(v * size)), 0) / extents.length
  const sizes: [number, number][] = []
  for (let k = MIN_SIZE * SIZE_STEPS; k <= MAX_SIZE * SIZE_STEPS; k++) sizes.push([k / SIZE_STEPS, misfit(k / SIZE_STEPS)])
  const best = Math.min(...sizes.map(([, m]) => m))
  return sizes.find(([, m]) => m <= best + 0.005)![0]
}

/** The middle value. */
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
}

/** A character's ink, in ems from its origin on the baseline (y up). */
interface Ink {
  left: number
  right: number
  top: number
  bottom: number
}

/** The line and each character's ink, in ems, read from the file (TrueType), or else measured
 * by the browser: a character the browser draws with a fallback font is one the font lacks,
 * and with two different fallbacks, it measures differently. */
async function readInk(bytes: ArrayBuffer, family: string) {
  const file = await readFontFile(bytes, FONT_CHARACTERS)
  const inks = new Map<string, Ink>()
  if (file) {
    const em = file.unitsPerEm
    for (const [ch, box] of file.glyphs) {
      if (box) inks.set(ch, { left: box.xMin / em, right: box.xMax / em, top: box.yMax / em, bottom: box.yMin / em })
    }
    return { ascent: file.ascent / em, descent: file.descent / em, inks }
  }
  const EM = 1000
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  const measure = (ch: string, fallback: string) => {
    ctx.font = `${EM}px "${family}", ${fallback}`
    const m = ctx.measureText(ch)
    return { left: -m.actualBoundingBoxLeft / EM, right: m.actualBoundingBoxRight / EM, top: m.actualBoundingBoxAscent / EM, bottom: -m.actualBoundingBoxDescent / EM }
  }
  for (const ch of FONT_CHARACTERS) {
    const a = measure(ch, 'monospace')
    const b = measure(ch, 'serif')
    if (JSON.stringify(a) === JSON.stringify(b) && a.right > a.left && a.top > a.bottom) inks.set(ch, a)
  }
  ctx.font = `${EM}px "${family}"`
  const line = ctx.measureText('Hg')
  return { ascent: line.fontBoundingBoxAscent / EM, descent: line.fontBoundingBoxDescent / EM, inks }
}

/**
 * Reads a font file (.ttf, .otf, .woff…) as a font image, at the size it is made for, found
 * from its characters' shapes. Each character is drawn with its ink starting on a pixel, and
 * the baseline where most characters' bottoms fall on a pixel: a pixel font comes out
 * exactly, one that is not quite (Pixelify Sans) comes out as close as it can.
 * Characters the font lacks are left empty.
 */
export async function fontFromFile(bytes: ArrayBuffer): Promise<Bitmap> {
  const family = `lucarne-import-${Date.now()}`
  const face = new FontFace(family, bytes.slice(0))
  await face.load()
  document.fonts.add(face)
  try {
    const { ascent: lineAscent, descent: lineDescent, inks } = await readInk(bytes, family)

    // The size, from the ink of the ASCII characters.
    const ascii = [...inks].filter(([ch]) => ch > ' ' && ch <= '~').map(([, ink]) => ink)
    if (!ascii.length) throw new Error('it has no letters the browser could read')
    const size = pixelSize(ascii.flatMap((ink) => [ink.right - ink.left, ink.top - ink.bottom]))

    // The line: its height, and the baseline, set so that bottoms fall on whole pixels.
    const ascent = Math.round(lineAscent * size)
    const height = Math.max(1, ascent + Math.round(lineDescent * size))
    const baseline = ascent + median(ascii.map((ink) => ink.bottom * size - Math.round(ink.bottom * size)))

    const canvas = new OffscreenCanvas(MAX_SIZE * ZOOM * 4, MAX_SIZE * ZOOM * 3)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#000'
    ctx.font = `${size * ZOOM}px "${family}"`
    const glyphs: Glyph[] = []
    for (const [ch, ink] of inks) {
      if (ch === ' ' || ch === '\u00a0') continue
      // Drawn with its ink from the left edge, and read: which squares are mostly ink.
      const w = Math.min(Math.ceil((ink.right - ink.left) * size), Math.floor(canvas.width / ZOOM))
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillText(ch, -ink.left * size * ZOOM, baseline * ZOOM)
      const W = Math.max(1, w * ZOOM)
      const img = ctx.getImageData(0, 0, W, height * ZOOM).data
      const rows: boolean[][] = []
      for (let y = 0; y < height; y++) {
        const row: boolean[] = []
        for (let x = 0; x < w; x++) {
          let sum = 0
          for (let dy = 0; dy < ZOOM; dy++) for (let dx = 0; dx < ZOOM; dx++) sum += img[((y * ZOOM + dy) * W + x * ZOOM + dx) * 4 + 3]
          row.push(sum > 255 * ZOOM * ZOOM * INK_SHARE)
        }
        rows.push(row)
      }
      if (rows.some((r) => r.includes(true))) glyphs.push({ ch, rows })
    }
    return buildFont(glyphs, height)
  } finally {
    document.fonts.delete(face)
  }
}

/** A file name turned into a font name: "BoldPixels.ttf" → "boldpixels",
 * "PixelifySans-VariableFont_wght.ttf" → "pixelifysans". */
export function nameFromFile(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/\[[^\]]*\]/g, '').replace(/[-_ ]?variable-?font.*$/i, '')
  const name = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return /^[a-z0-9][a-z0-9_-]*$/.test(name) ? name : 'font'
}

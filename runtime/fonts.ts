// The game's fonts (fonts/<name>.png), by name. A font is pixel art: its characters, in a
// grid, are stamped on whole game pixels like sprites. The browser never draws text, so it
// never smooths or shifts it.
//
//   screen.text('Hello!', 8, 8, '#f4f4f4')                 // the game's font
//   screen.text(line, 8, 8, '#f4f4f4', { width: 120 })     // wrapped at 120 pixels
//   font().measure('Hello!')                               // { width, height }
//
// A font is only its image, so that drawing it is all there is to making one:
// - Every font has the same characters, in the same cells: FONT_CHARACTERS, FONT_COLUMNS to
//   a row. The cell's size is the image's size divided by that grid; a line is a cell high.
// - Ink is any pixel that is not transparent, whatever its color: text takes the color
//   it is written in.
// - A character is drawn from its first column of ink, and the next one starts one pixel
//   after its last: redraw a letter wider and the text makes room for it. There is no
//   width to set, and no other spacing (most pixel fonts are spaced this way).
// - A space is half a cell wide. An empty cell is a character the font does not have:
//   "?" is drawn instead.
//
// There is no font in the engine: a game that writes text brings its own, in fonts/.

/** Cells per row of a font's image. */
export const FONT_COLUMNS = 16

/**
 * The characters of a font, in the order of its cells: ASCII, Latin-1 (French accents
 * among them), then a few more that games write. New ones may only be added at the end, so
 * a character never changes cell.
 */
export const FONT_CHARACTERS = (() => {
  let out = ''
  for (let c = 0x20; c <= 0x7e; c++) out += String.fromCodePoint(c)
  for (let c = 0xa0; c <= 0xff; c++) out += String.fromCodePoint(c)
  return out + 'ŒœŸ€…‘’“”–—←↑→↓♥'
})()

/** Rows of cells in a font's image. */
export const FONT_ROWS = Math.ceil([...FONT_CHARACTERS].length / FONT_COLUMNS)

const SPACES = new Set([' ', ' '])

/** A font as the editor hands it to the engine: its image, and which of its pixels are ink. */
export interface FontData {
  name: string
  /** The image, the characters in their cells, on transparent pixels. */
  sheet: CanvasImageSource
  width: number
  height: number
  /** Is the pixel at (x, y) of the image ink? */
  ink: (x: number, y: number) => boolean
}

export interface TextOptions {
  /** The font to write with (the game's font by default). */
  font?: Font
  /** Wraps lines at this width, in pixels, between words. */
  width?: number
}

/** Where a character's ink is on the image, and how far the next character starts. */
interface Glyph {
  /** Its ink, on the image. */
  x: number
  y: number
  width: number
  /** How far the next character starts: the ink and one pixel. */
  advance: number
}

/** A sheet tinted in one color, filled in character by character as they get used. */
interface Tint {
  canvas: OffscreenCanvas | HTMLCanvasElement
  ready: Uint8Array
}

/**
 * The ink of each cell, in the order of FONT_CHARACTERS: null for an empty cell. A pure
 * function of the pixels, so the editor and the engine agree on it.
 */
export function measureGlyphs(cellWidth: number, cellHeight: number, ink: (x: number, y: number) => boolean): (Glyph | null)[] {
  return [...FONT_CHARACTERS].map((_, i) => {
    const ox = (i % FONT_COLUMNS) * cellWidth
    const oy = Math.floor(i / FONT_COLUMNS) * cellHeight
    let first = -1
    let last = -1
    for (let x = 0; x < cellWidth; x++) {
      for (let y = 0; y < cellHeight; y++) {
        if (!ink(ox + x, oy + y)) continue
        if (first < 0) first = x
        last = x
        break
      }
    }
    if (first < 0) return null
    return { x: ox + first, y: oy, width: last - first + 1, advance: last - first + 2 }
  })
}

export class Font {
  readonly name: string
  /** Height of a line, in pixels. */
  readonly lineHeight: number
  /** @internal Size of a cell. */
  readonly cellWidth: number
  /** @internal */
  readonly cellHeight: number
  private readonly glyphs = new Map<string, Glyph>()
  private readonly spaceAdvance: number
  private readonly sheet: CanvasImageSource
  private readonly sheetWidth: number
  private readonly sheetHeight: number
  private readonly tints = new Map<string, Tint>()
  private readonly index = new Map<Glyph, number>()

  constructor(data: FontData) {
    this.name = data.name
    this.sheet = data.sheet
    this.sheetWidth = data.width
    this.sheetHeight = data.height
    this.cellWidth = Math.max(1, Math.floor(data.width / FONT_COLUMNS))
    this.cellHeight = Math.max(1, Math.floor(data.height / FONT_ROWS))
    this.lineHeight = this.cellHeight
    this.spaceAdvance = Math.ceil(this.cellWidth / 2)
    const chars = [...FONT_CHARACTERS]
    measureGlyphs(this.cellWidth, this.cellHeight, data.ink).forEach((g, i) => {
      if (!g || SPACES.has(chars[i])) return
      this.glyphs.set(chars[i], g)
      this.index.set(g, this.index.size)
    })
  }

  /** Does the font have this character? */
  has(ch: string) {
    return SPACES.has(ch) || this.glyphs.has(ch)
  }

  /** How far the next character starts after this one, in pixels. */
  advance(ch: string) {
    if (SPACES.has(ch)) return this.spaceAdvance
    return this.glyph(ch)?.advance ?? 0
  }

  /** The lines a text is written on: at its line breaks, and between words to fit `width`. */
  lines(text: string, width = Infinity): string[] {
    const out: string[] = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const word of paragraph.split(' ')) {
        const tried = line === '' ? word : `${line} ${word}`
        if (line !== '' && this.lineWidth(tried) > width) {
          out.push(line)
          line = word
        } else line = tried
      }
      out.push(line)
    }
    return out
  }

  /** Width of one line, in pixels. */
  lineWidth(line: string) {
    let w = 0
    for (const ch of line) w += this.advance(ch)
    return w
  }

  /** Size of a text as written, wrapped at `width` if given. */
  measure(text: string, width?: number) {
    const lines = this.lines(text, width)
    return { width: Math.max(0, ...lines.map((l) => this.lineWidth(l))), height: lines.length * this.lineHeight }
  }

  /** @internal The ink of a character (or of "?" for one the font lacks), null for none. */
  glyph(ch: string): Glyph | null {
    if (SPACES.has(ch)) return null
    return this.glyphs.get(ch) ?? this.glyphs.get('?') ?? null
  }

  /** @internal The sheet in that color, with that character ready on it. */
  tinted(color: string, g: Glyph): CanvasImageSource {
    let tint = this.tints.get(color)
    if (!tint) {
      tint = { canvas: makeCanvas(this.sheetWidth, this.sheetHeight), ready: new Uint8Array(this.index.size) }
      this.tints.set(color, tint)
    }
    const i = this.index.get(g)!
    if (!tint.ready[i]) {
      paintGlyph(this.sheet, tint.canvas, g, this.cellHeight, color)
      tint.ready[i] = 1
    }
    return tint.canvas
  }
}

/** Copies one character of the sheet onto the tinted sheet, in `color`. */
function paintGlyph(sheet: CanvasImageSource, target: OffscreenCanvas | HTMLCanvasElement, g: Glyph, h: number, color: string) {
  const w = g.width
  // "source-in" would clear a whole canvas outside what it fills: tint on a scratch cell.
  if (!scratch || scratch.width < w || scratch.height < h) scratch = makeCanvas(Math.max(w, scratch?.width ?? 0), Math.max(h, scratch?.height ?? 0))
  const s = scratch.getContext('2d') as CanvasRenderingContext2D
  s.globalCompositeOperation = 'source-over'
  s.clearRect(0, 0, scratch.width, scratch.height)
  s.drawImage(sheet, g.x, g.y, w, h, 0, 0, w, h)
  s.globalCompositeOperation = 'source-in'
  s.fillStyle = color
  s.fillRect(0, 0, w, h)
  const t = target.getContext('2d') as CanvasRenderingContext2D
  t.drawImage(scratch, 0, 0, w, h, g.x, g.y, w, h)
}

let scratch: OffscreenCanvas | HTMLCanvasElement | null = null

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

let loaded = new Map<string, Font>()

/**
 * The font named `name` (fonts/<name>.png). Without a name, the game's font: the only one
 * in fonts/ (with several, name the one you want).
 */
export function font(name?: string): Font {
  if (name !== undefined) {
    const f = loaded.get(name)
    if (!f) throw new Error(`No font named "${name}" in fonts/ (there are: ${[...loaded.keys()].join(', ') || 'none'}).`)
    return f
  }
  if (loaded.size === 1) return loaded.values().next().value!
  if (loaded.size === 0) {
    throw new Error('No font in fonts/: make or import one in the editor (Fonts, under Tilesets) to write text.')
  }
  throw new Error(`There are several fonts in fonts/ (${[...loaded.keys()].join(', ')}): name the one to use, with font("…").`)
}

/** Called by the editor before the game's code runs. */
export function setFonts(list: FontData[]) {
  loaded = new Map(list.map((d) => [d.name, new Font(d)]))
}

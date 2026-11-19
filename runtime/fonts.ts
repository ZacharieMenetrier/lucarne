// The game's fonts (fonts/*.png + .json), by name. A font is pixel art: its characters,
// drawn in white in a grid, are stamped on whole game pixels like sprites. The browser
// never draws text, so it never smooths or shifts it.
//
//   screen.text('Hello!', 8, 8, '#f4f4f4')                 // the game's font
//   screen.text(line, 8, 8, '#f4f4f4', { width: 120 })     // wrapped at 120 pixels
//   font().measure('Hello!')                               // { width, height }
//
// There is no font in the engine: a game that writes text brings its own, in fonts/.

/** A font as the editor hands it to the engine. */
export interface FontData {
  name: string
  /** Size of one cell of the grid, in pixels: every character's box. */
  cellWidth: number
  cellHeight: number
  /** Cells per row of the sheet. */
  columns: number
  /** The characters, in the order of the cells (each drawn from the left of its cell). */
  characters: string
  /** For each character, how far the next one starts, in pixels (the gap included). */
  advances: number[]
  /** The sheet: the characters in white, on transparent pixels. */
  sheet: CanvasImageSource
}

export interface TextOptions {
  /** The font to write with (the game's font by default). */
  font?: Font
  /** Wraps lines at this width, in pixels, between words. */
  width?: number
}

/** A sheet tinted in one color, filled in character by character as they get used. */
interface Tint {
  canvas: OffscreenCanvas | HTMLCanvasElement
  ready: Uint8Array
}

export class Font {
  readonly name: string
  /** Height of a line, in pixels. */
  readonly lineHeight: number
  /** @internal */
  readonly cellWidth: number
  /** @internal */
  readonly cellHeight: number
  private readonly columns: number
  private readonly advances: number[]
  private readonly index = new Map<string, number>()
  private readonly sheet: CanvasImageSource
  private readonly tints = new Map<string, Tint>()
  /** Drawn for a character the font does not have. */
  private readonly fallback: number

  constructor(data: FontData) {
    this.name = data.name
    this.cellWidth = data.cellWidth
    this.cellHeight = data.cellHeight
    this.lineHeight = data.cellHeight
    this.columns = data.columns
    this.advances = data.advances
    this.sheet = data.sheet
    let i = 0
    for (const ch of data.characters) this.index.set(ch, i++)
    this.fallback = this.index.get('?') ?? -1
  }

  /** Does the font have this character? */
  has(ch: string) {
    return this.index.has(ch)
  }

  /** How far the next character starts after this one, in pixels. */
  advance(ch: string) {
    const i = this.glyph(ch)
    return i < 0 ? 0 : this.advances[i]
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

  /** @internal The cell of a character (or of the fallback), -1 for none. */
  glyph(ch: string) {
    return this.index.get(ch) ?? this.fallback
  }

  /** @internal Where a cell is on the sheet. */
  cell(i: number) {
    return { x: (i % this.columns) * this.cellWidth, y: Math.floor(i / this.columns) * this.cellHeight }
  }

  /** @internal The sheet in that color, with that character ready on it. */
  tinted(color: string, i: number): CanvasImageSource {
    let tint = this.tints.get(color)
    if (!tint) {
      const rows = Math.ceil(this.advances.length / this.columns)
      tint = { canvas: makeCanvas(this.columns * this.cellWidth, rows * this.cellHeight), ready: new Uint8Array(this.advances.length) }
      this.tints.set(color, tint)
    }
    if (!tint.ready[i]) {
      paintGlyph(this.sheet, tint.canvas, this.cell(i), this.cellWidth, this.cellHeight, color)
      tint.ready[i] = 1
    }
    return tint.canvas
  }
}

/** Copies one cell of the white sheet onto the tinted sheet, in `color`. */
function paintGlyph(
  sheet: CanvasImageSource,
  target: OffscreenCanvas | HTMLCanvasElement,
  at: { x: number; y: number },
  w: number,
  h: number,
  color: string,
) {
  // "source-in" would clear a whole canvas outside what it fills: tint on a scratch cell.
  scratch ??= makeCanvas(w, h)
  if (scratch.width < w || scratch.height < h) scratch = makeCanvas(w, h)
  const s = scratch.getContext('2d') as CanvasRenderingContext2D
  s.globalCompositeOperation = 'source-over'
  s.clearRect(0, 0, scratch.width, scratch.height)
  s.drawImage(sheet, at.x, at.y, w, h, 0, 0, w, h)
  s.globalCompositeOperation = 'source-in'
  s.fillStyle = color
  s.fillRect(0, 0, w, h)
  const t = target.getContext('2d') as CanvasRenderingContext2D
  t.drawImage(scratch, 0, 0, w, h, at.x, at.y, w, h)
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
    throw new Error('No font in fonts/: import a pixel font in the editor (menu → Import a font) to write text.')
  }
  throw new Error(`There are several fonts in fonts/ (${[...loaded.keys()].join(', ')}): name the one to use, with font("…").`)
}

/** Called by the editor before the game's code runs. */
export function setFonts(list: FontData[]) {
  loaded = new Map(list.map((d) => [d.name, new Font(d)]))
}

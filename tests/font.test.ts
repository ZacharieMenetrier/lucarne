import { describe, expect, it } from 'vitest'
import { Bitmap } from '../editor/src/bitmap'
import { hexToColor } from '../editor/src/color'
import { blankFont, buildFont, fontCell, nameFromFile, pixelSize, relayoutFont, whiteInk } from '../editor/src/font'
import { FONT_CHARACTERS, FONT_COLUMNS, FONT_ROWS, Font, measureGlyphs } from '../runtime/fonts'
import { readFontFile } from '../editor/src/ttf'
import pixel10Ttf from './fonts/pixel10.ttf?inline'
import pixel10Woff from './fonts/pixel10.woff?inline'

const WHITE = hexToColor('#ffffff')
const RED = hexToColor('#ff0000')
const cellOf = (ch: string) => [...FONT_CHARACTERS].indexOf(ch)

/** The ink of a cell, as text: "#" for ink. */
function cellText(sheet: Bitmap, ch: string) {
  const { width, height } = fontCell(sheet)
  const i = cellOf(ch)
  const ox = (i % FONT_COLUMNS) * width
  const oy = Math.floor(i / FONT_COLUMNS) * height
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (sheet.get(ox + x, oy + y) ? '#' : '.')).join(''))
}

function fontOf(sheet: Bitmap) {
  return new Font({ name: 't', sheet: {} as CanvasImageSource, width: sheet.width, height: sheet.height, ink: (x, y) => sheet.get(x, y) !== 0 })
}

describe('fonts', () => {
  it('has a fixed grid of characters, ASCII and French accents among them', () => {
    expect(FONT_CHARACTERS.startsWith(' !"#')).toBe(true)
    for (const ch of 'azAZ09éèêàçùôœ€…’«»') expect(FONT_CHARACTERS).toContain(ch)
    expect(new Set(FONT_CHARACTERS).size).toBe([...FONT_CHARACTERS].length)
    expect(FONT_ROWS).toBe(Math.ceil([...FONT_CHARACTERS].length / FONT_COLUMNS))
    const sheet = blankFont()
    expect(fontCell(sheet)).toEqual({ width: 8, height: 8 })
    expect(sheet.width).toBe(8 * FONT_COLUMNS)
  })

  it('reads each character’s width from its ink, plus one pixel', () => {
    const sheet = blankFont(6, 6)
    const { width } = fontCell(sheet)
    const put = (ch: string, x: number, y: number) => {
      const i = cellOf(ch)
      sheet.set((i % FONT_COLUMNS) * width + x, Math.floor(i / FONT_COLUMNS) * 6 + y, RED)
    }
    put('i', 2, 1)
    put('i', 2, 4)
    put('m', 0, 3)
    put('m', 4, 3)
    const glyphs = measureGlyphs(6, 6, (x, y) => sheet.get(x, y) !== 0)
    expect(glyphs[cellOf('i')]).toMatchObject({ width: 1, advance: 2 })
    expect(glyphs[cellOf('m')]).toMatchObject({ width: 5, advance: 6 })
    expect(glyphs[cellOf('a')]).toBeNull()
    const f = fontOf(sheet)
    expect(f.advance('i')).toBe(2)
    expect(f.advance(' ')).toBe(3) // half a cell
    expect(f.has('a')).toBe(false)
    expect(f.advance('a')).toBe(0) // no "?" either: nothing
    put('?', 0, 0)
    expect(fontOf(sheet).advance('a')).toBe(2) // drawn as "?"
    // Drawing a letter wider makes room for it.
    put('i', 3, 4)
    expect(fontOf(sheet).advance('i')).toBe(3)
  })

  it('lays read characters out in their cells, from their first column of ink', () => {
    const sheet = buildFont([
      { ch: 'A', rows: [[false, false, true, false], [false, true, false, true], [false, true, true, true]] },
      { ch: '!', rows: [[true], [true], [false]] },
      { ch: '\u{1F600}', rows: [[true]] },
    ], 3)
    expect(fontCell(sheet)).toEqual({ width: 3, height: 3 })
    expect(cellText(sheet, 'A')).toEqual(['.#.', '#.#', '###'])
    expect(cellText(sheet, '!')).toEqual(['#..', '#..', '...'])
    // A character that has no cell is left out: only the ink of "A" and "!".
    expect(sheet.data.filter(Boolean).length).toBe(6 + 2)
  })

  it('changes the size of every cell, each character keeping its top left', () => {
    const sheet = buildFont([{ ch: 'A', rows: [[false, true, false], [true, false, true], [true, true, true]] }], 3)
    const bigger = relayoutFont(sheet, 4, 5)
    expect(fontCell(bigger)).toEqual({ width: 4, height: 5 })
    expect(cellText(bigger, 'A')).toEqual(['.#..', '#.#.', '###.', '....', '....'])
    expect(cellText(relayoutFont(sheet, 2, 2), 'A')).toEqual(['.#', '#.'])
  })

  it('saves ink in white', () => {
    const sheet = new Bitmap(2, 1)
    sheet.set(0, 0, RED)
    const out = whiteInk(sheet)
    expect([out.get(0, 0), out.get(1, 0)]).toEqual([WHITE, 0])
  })

  it('finds the size a pixel font is made for, from its characters’ ink', () => {
    // A font of 10 pixels to the em: ink 0.5, 0.3, 0.7… em. Twice the size fits as well.
    expect(pixelSize([0.5, 0.7, 0.3, 0.1, 0.6, 0.5, 0.2, 0.9])).toBe(10)
    // Pixels of 92 units to the em of 1000 (10.85 pixels), drawn a little off the grid.
    const off = [5.05, 7.07, 6.04, 5.02, 3.1, 7, 1.02, 4.96, 6.1, 2.02].map((n) => (n * 92) / 1000)
    expect(Math.abs(pixelSize(off) - 10.85)).toBeLessThan(0.15)
  })

  it('names a font after its file', () => {
    expect(nameFromFile('BoldPixels.ttf')).toBe('boldpixels')
    expect(nameFromFile('m5x7.ttf')).toBe('m5x7')
    expect(nameFromFile('My Font!.otf')).toBe('my-font')
    expect(nameFromFile('PixelifySans-VariableFont_wght.ttf')).toBe('pixelifysans')
    expect(nameFromFile('PixelifySans[wght].ttf')).toBe('pixelifysans')
  })
})

describe('reading a font file', () => {
  // A pixel font made for these tests: 10 pixels to the em of 1000 units, a few characters.
  const files: Record<string, string> = { 'pixel10.ttf': pixel10Ttf, 'pixel10.woff': pixel10Woff }
  const file = async (name: string) => (await fetch(files[name])).arrayBuffer()

  it.each(['pixel10.ttf', 'pixel10.woff'])('reads the em, the line and the ink of each character (%s)', async (name) => {
    const info = (await readFontFile(await file(name), FONT_CHARACTERS))!
    expect(info).toMatchObject({ unitsPerEm: 1000, ascent: 800, descent: 200 })
    expect(info.glyphs.get('H')).toEqual({ xMin: 0, yMin: 0, xMax: 500, yMax: 500 })
    expect(info.glyphs.get('g')).toEqual({ xMin: 0, yMin: -200, xMax: 500, yMax: 300 })
    expect(info.glyphs.get(' ')).toBeNull()
    expect(info.glyphs.has('é')).toBe(true)
    expect(info.glyphs.has('b')).toBe(false)
  })

  it('finds the size the test font is made for', async () => {
    const info = (await readFontFile(await file('pixel10.ttf'), FONT_CHARACTERS))!
    const boxes = [...info.glyphs.values()].filter((b) => b !== null)
    expect(pixelSize(boxes.flatMap((b) => [(b.xMax - b.xMin) / 1000, (b.yMax - b.yMin) / 1000]))).toBe(10)
  })

  it('reads nothing from a file that is not TrueType', async () => {
    expect(await readFontFile(new Uint8Array([1, 2, 3, 4]).buffer, 'a')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { hexToColor } from '../editor/src/color'
import { buildFont, fontName, parseFontMeta, serializeFontMeta } from '../editor/src/font'

const WHITE = hexToColor('#ffffff')

describe('fonts', () => {
  // Reading a .ttf needs a browser (it draws the characters): what follows is tested here.
  const glyphs = [
    { ch: ' ', rows: [[], [], []], advance: 2 },
    { ch: '!', rows: [[true], [true], [false]], advance: 2 },
    { ch: 'A', rows: [[false, true, false], [true, false, true], [true, true, true]], advance: 4 },
  ]

  it('lays characters out in a grid of cells as wide as the widest advance', () => {
    const { sheet, meta } = buildFont(glyphs, 3)
    expect(meta).toMatchObject({ cellWidth: 4, cellHeight: 3, columns: 32, characters: ' !A', advances: [2, 2, 4] })
    const ink = (ox: number) =>
      [0, 1, 2].map((y) => [0, 1, 2].map((x) => (sheet.get(ox + x, y) === WHITE ? '#' : '.')).join(''))
    expect(ink(4)).toEqual(['#..', '#..', '...'])
    expect(ink(8)).toEqual(['.#.', '#.#', '###'])
  })

  it('writes and reads its description back', () => {
    const { meta } = buildFont(glyphs, 3)
    expect(parseFontMeta(serializeFontMeta(meta))).toEqual(meta)
    expect(() => parseFontMeta('{"cellWidth": 2, "cellHeight": 2, "columns": 1, "characters": "ab", "advances": [1]}')).toThrow('one advance per character')
  })

  it('names a font after its file', () => {
    expect(fontName('BoldPixels.ttf')).toBe('boldpixels')
    expect(fontName('m5x7.ttf')).toBe('m5x7')
    expect(fontName('My Font!.otf')).toBe('my-font')
  })
})

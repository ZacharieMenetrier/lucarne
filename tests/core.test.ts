import { describe, expect, it } from 'vitest'
import { Bitmap, constrainLine, floodFill, flipH, linePoints, resized } from '../editor/src/bitmap'
import { colorToHex, hexToColor } from '../editor/src/color'
import { Editor } from '../editor/src/editor'
import { parsePalette } from '../editor/src/project'
import { composeSheet, newSprite, parseMeta, splitSheet } from '../editor/src/sprite'

const RED = hexToColor('#ff0000')
const BLUE = hexToColor('#0000ff')
const at = (x: number, y: number) => ({ x, y, shift: false, alt: false })

describe('colors', () => {
  it('converts hex ↔ color', () => {
    expect(colorToHex(hexToColor('#1a1c2c'))).toBe('#1a1c2c')
    expect(hexToColor('#12345600')).toBe(0)
  })
})

describe('bitmap', () => {
  it('draws a continuous line', () => {
    const pts = linePoints(0, 0, 5, 2)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts.at(-1)).toEqual({ x: 5, y: 2 })
    expect(pts).toHaveLength(6)
  })

  it('snaps lines to 0°, 45° and 90°', () => {
    expect(constrainLine(0, 0, 10, 1)).toEqual({ x: 10, y: 0 })
    expect(constrainLine(0, 0, 1, 10)).toEqual({ x: 0, y: 10 })
    expect(constrainLine(0, 0, 6, -5)).toEqual({ x: 6, y: -6 })
  })

  it('fills a closed area without leaking', () => {
    const b = new Bitmap(5, 5)
    for (let i = 0; i < 5; i++) b.set(2, i, BLUE)
    expect(floodFill(b, 0, 0, RED)).toBe(true)
    expect(b.get(1, 4)).toBe(RED)
    expect(b.get(3, 0)).toBe(0)
    expect(floodFill(b, 0, 0, RED)).toBe(false)
  })

  it('flips and resizes', () => {
    const b = new Bitmap(3, 1)
    b.set(0, 0, RED)
    expect(flipH(b).get(2, 0)).toBe(RED)
    const r = resized(b, 5, 2, 1, 1)
    expect(r.get(1, 1)).toBe(RED)
  })
})

describe('sprite', () => {
  it('splits and recomposes the sheet', () => {
    const meta = parseMeta(JSON.stringify({ frameWidth: 2, frameHeight: 2, directions: [{ name: 'a' }, { name: 'b' }], frames: [{ duration: 80 }, {}] }))
    expect(meta.frames[1].duration).toBe(100)
    const sheet = new Bitmap(4, 4)
    sheet.set(3, 3, RED)
    const frames = splitSheet(sheet, meta)
    expect(frames[1][1].get(1, 1)).toBe(RED)
    expect(composeSheet({ name: 'x', meta, frames }).equals(sheet)).toBe(true)
  })

  it('reads a palette', () => {
    expect(parsePalette('["#ABCDEF", "nope", "123456"]')).toEqual(['#abcdef', '#123456'])
  })
})

describe('editor', () => {
  function setup() {
    const ed = new Editor(['#ff0000', '#0000ff'])
    ed.setSprite(newSprite('test', 8, 8))
    return ed
  }

  it('draws, undoes and redoes', () => {
    const ed = setup()
    ed.down(at(0, 0))
    ed.move(at(3, 0))
    ed.up(at(3, 0))
    expect(ed.bmp!.get(2, 0)).toBe(RED)
    ed.undo()
    expect(ed.bmp!.get(2, 0)).toBe(0)
    ed.redo()
    expect(ed.bmp!.get(2, 0)).toBe(RED)
  })

  it('moves a selection and undoes it in one step', () => {
    const ed = setup()
    ed.down(at(0, 0))
    ed.up(at(0, 0))
    ed.setTool('select')
    ed.down(at(0, 0))
    ed.move(at(1, 1))
    ed.up(at(1, 1))
    expect(ed.selection).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    ed.down(at(0, 0))
    ed.move(at(4, 4))
    ed.up(at(4, 4))
    // While moving, saving already sees the result.
    expect(ed.snapshot()!.frames[0][0].get(4, 4)).toBe(RED)
    ed.deselect()
    expect(ed.bmp!.get(4, 4)).toBe(RED)
    expect(ed.bmp!.get(0, 0)).toBe(0)
    ed.undo()
    expect(ed.bmp!.get(0, 0)).toBe(RED)
    expect(ed.bmp!.get(4, 4)).toBe(0)
  })

  it('copies with ⌥ and keeps the original', () => {
    const ed = setup()
    ed.down(at(0, 0))
    ed.up(at(0, 0))
    ed.setTool('select')
    ed.down(at(0, 0))
    ed.move(at(0, 0))
    ed.up(at(0, 0))
    // Click without dragging: no selection
    expect(ed.selection).toBeNull()
    ed.selectAll()
    ed.down({ ...at(0, 0), alt: true })
    ed.move({ ...at(2, 0), alt: true })
    ed.up({ ...at(2, 0), alt: true })
    ed.deselect()
    expect(ed.bmp!.get(0, 0)).toBe(RED)
    expect(ed.bmp!.get(2, 0)).toBe(RED)
  })

  it('draws a rectangle', () => {
    const ed = setup()
    ed.setColor(BLUE)
    ed.setTool('rect')
    ed.down(at(1, 1))
    ed.move(at(4, 3))
    expect(ed.bmp!.get(1, 1)).toBe(0) // preview only
    ed.up(at(4, 3))
    expect(ed.bmp!.get(4, 3)).toBe(BLUE)
    expect(ed.bmp!.get(2, 2)).toBe(0)
  })
})

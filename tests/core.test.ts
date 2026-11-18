import { describe, expect, it } from 'vitest'
import { Bitmap, constrainLine, floodFill, flipH, linePoints, resized } from '../editor/src/bitmap'
import { colorToHex, hexToColor } from '../editor/src/color'
import { Editor } from '../editor/src/editor'
import { findFreeSpot, overlaps, parseBoard, resolveOverlaps, serializeBoard, shelfLayout } from '../editor/src/board'
import { parsePalette } from '../editor/src/project'
import { lospecSlug } from '../editor/src/lospec'
import { composeSheet, newSprite, parseMeta, serializeMeta, splitSheet } from '../editor/src/sprite'

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
    ed.addSprite(newSprite('test', 8, 8), 0, 0)
    ed.activate('test')
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

describe('board', () => {
  it('saves and reads positions and the board color', () => {
    const placements = new Map([['slime', { x: 24, y: -8 }], ['hero', { x: 0, y: 0 }]])
    const text = serializeBoard({ placements, background: null, paletteRows: null })
    expect(text).toContain('"hero": { "x": 0, "y": 0 },\n    "slime"')
    expect(text).not.toContain('background')
    expect(parseBoard(text)).toEqual({ placements: new Map([['hero', { x: 0, y: 0 }], ['slime', { x: 24, y: -8 }]]), background: null, paletteRows: null })
    expect(parseBoard('{"sprites": {"bad": {"x": 1.5, "y": 0}}}').placements.size).toBe(0)
    const parsed = parseBoard(serializeBoard({ placements, background: '#2a2a33', paletteRows: 4 }))
    expect(parsed.background).toBe('#2a2a33')
    expect(parsed.paletteRows).toBe(4)
    expect(parseBoard('{"background": "nope"}').background).toBeNull()
  })

  it('finds free space and lays out unplaced sprites', () => {
    const taken = [{ x: 0, y: 0, w: 16, h: 16 }]
    const p = findFreeSpot(16, 16, { x: 0, y: 0 }, taken)
    expect(overlaps({ ...p, w: 16, h: 16 }, taken[0], 8)).toBe(false)
    const layout = shelfLayout([{ name: 'a', w: 16, h: 16 }, { name: 'b', w: 16, h: 16 }], { x: 0, y: 40 })
    expect(layout.get('a')).toEqual({ x: 0, y: 40 })
    expect(layout.get('b')!.x).toBeGreaterThanOrEqual(24)
  })

  function board() {
    const ed = new Editor(['#ff0000', '#0000ff'])
    ed.addSprite(newSprite('hero', 8, 8), 0, 0)
    ed.addSprite(newSprite('slime', 8, 8), 20, 0)
    return ed
  }

  function click(ed: Editor, x: number, y: number) {
    ed.down(at(x, y))
    ed.up(at(x, y))
  }

  it('long press picks from any sprite, or the board color', () => {
    const ed = board()
    const blue = hexToColor('#0000ff')
    const red = hexToColor('#ff0000')
    ed.sprites.get('slime')!.sprite.frames[0][0].set(1, 1, blue)
    ed.pickAt({ x: 21, y: 1 }, '#ff0000')
    expect(ed.color).toBe(blue)
    expect(ed.active).not.toBe('slime') // picking does not focus
    ed.pickAt({ x: 21, y: 2 }, '#ff0000') // transparent pixel: board color
    expect(ed.color).toBe(red)
    ed.pickAt({ x: 21, y: 1 }, '#ff0000')
    ed.pickAt({ x: 50, y: 50 }, '#123456') // off-palette board color
    expect(ed.color).toBe(blue)
  })

  it('focuses another sprite on the first press, draws on the next', () => {
    const ed = board()
    click(ed, 21, 2)
    expect(ed.active).toBe('slime')
    expect(ed.sprites.get('slime')!.sprite.frames[0][0].get(1, 2)).toBe(0)
    click(ed, 21, 2)
    expect(ed.sprites.get('slime')!.sprite.frames[0][0].get(1, 2)).toBe(RED)
    click(ed, 12, 2) // between the two: nothing
    expect(ed.active).toBe('slime')
    expect(ed.canUndo).toBe(true)
  })

  it('undoes across sprites, in order', () => {
    const ed = board()
    const edits: string[] = []
    ed.onEdit = (n) => edits.push(n)
    click(ed, 1, 1) // focus hero
    click(ed, 1, 1)
    click(ed, 21, 1) // focus slime
    click(ed, 21, 1)
    ed.undo()
    expect(ed.sprites.get('slime')!.sprite.frames[0][0].get(1, 1)).toBe(0)
    expect(ed.sprites.get('hero')!.sprite.frames[0][0].get(1, 1)).toBe(RED)
    ed.undo()
    expect(ed.active).toBe('hero')
    expect(ed.sprites.get('hero')!.sprite.frames[0][0].get(1, 1)).toBe(0)
    expect(edits).toEqual(['hero', 'slime', 'slime', 'hero'])
  })

  it('moves a sprite with the Move tool, undoably', () => {
    const ed = board()
    let moved = 0
    ed.onMoved = () => moved++
    ed.setTool('move')
    ed.down(at(22, 3))
    ed.move(at(30, 13))
    ed.up(at(30, 13))
    expect(ed.rectOf('slime')).toEqual({ x: 28, y: 10, w: 8, h: 8 })
    ed.undo()
    expect(ed.rectOf('slime')).toEqual({ x: 20, y: 0, w: 8, h: 8 })
    expect(moved).toBe(2)
  })

  it('pastes into another sprite', () => {
    const ed = board()
    click(ed, 0, 0) // focus hero
    click(ed, 0, 0)
    ed.copy()
    ed.activate('slime')
    ed.paste()
    ed.deselect()
    expect(ed.sprites.get('slime')!.sprite.frames[0][0].get(0, 0)).toBe(RED)
  })

  it('replaces a color in every sprite as one undo step', () => {
    const ed = board()
    click(ed, 0, 0) // focus hero
    click(ed, 0, 0)
    click(ed, 20, 0) // focus slime
    click(ed, 20, 0)
    expect(ed.replaceColorEverywhere(RED, BLUE).sort()).toEqual(['hero', 'slime'])
    ed.undo()
    expect(ed.sprites.get('hero')!.sprite.frames[0][0].get(0, 0)).toBe(RED)
    expect(ed.sprites.get('slime')!.sprite.frames[0][0].get(0, 0)).toBe(RED)
  })

  it('keeps the drawing in place when resizing from the center', () => {
    const ed = board()
    ed.activate('slime')
    ed.resize(10, 10, 1, 1)
    expect(ed.rectOf('slime')).toEqual({ x: 19, y: -1, w: 10, h: 10 })
  })

  it('finds the closest free spot, touching allowed', () => {
    const taken = [{ x: 0, y: 0, w: 16, h: 16 }]
    expect(findFreeSpot(8, 8, { x: 10, y: 2 }, taken, 0)).toEqual({ x: 16, y: 2 })
    expect(resolveOverlaps([], [
      { name: 'a', rect: { x: 0, y: 0, w: 8, h: 8 } },
      { name: 'b', rect: { x: 0, y: 1, w: 8, h: 8 } },
    ])).toEqual(new Map([['b', { x: 0, y: 8 }]]))
  })

  it('pushes a sprite dropped onto another to the closest free spot', () => {
    const ed = board()
    ed.setTool('move')
    ed.down(at(21, 1))
    ed.move(at(5, 2)) // slime now at (4, 1), on top of hero
    expect(ed.placeBlocked).toBe(true)
    ed.up(at(5, 2))
    expect(ed.rectOf('slime')).toEqual({ x: 8, y: 1, w: 8, h: 8 })
    ed.undo()
    expect(ed.rectOf('slime')).toEqual({ x: 20, y: 0, w: 8, h: 8 })
  })

  it('pushes neighbours aside when a sprite grows, in one undo step', () => {
    const ed = board()
    ed.activate('hero')
    ed.resize(24, 8, 0, 0)
    expect(ed.rectOf('hero')).toEqual({ x: 0, y: 0, w: 24, h: 8 })
    expect(overlaps(ed.rectOf('hero')!, ed.rectOf('slime')!)).toBe(false)
    ed.undo()
    expect(ed.rectOf('slime')).toEqual({ x: 20, y: 0, w: 8, h: 8 })
    expect(ed.rectOf('hero')).toEqual({ x: 0, y: 0, w: 8, h: 8 })
  })

  it('separates sprites that overlap when the board is opened', () => {
    const ed = new Editor(['#ff0000'])
    ed.addSprite(newSprite('a', 8, 8), 0, 0)
    ed.addSprite(newSprite('b', 8, 8), 4, 4)
    expect(ed.untangle()).toBe(true)
    expect(overlaps(ed.rectOf('a')!, ed.rectOf('b')!)).toBe(false)
    expect(ed.rectOf('a')).toEqual({ x: 0, y: 0, w: 8, h: 8 })
  })
})

describe('animation frames', () => {
  const RED = hexToColor('#ff0000')
  const setup = () => {
    const ed = new Editor(['#ff0000'])
    ed.addSprite(newSprite('hero', 4, 4), 0, 0)
    ed.activate('hero')
    return ed
  }

  it('adds, edits and removes frames, undoing each step', () => {
    const ed = setup()
    ed.addFrame()
    expect(ed.sprite!.meta.frames).toHaveLength(2)
    expect(ed.frame).toBe(1)
    ed.down({ x: 1, y: 1, shift: false, alt: false })
    ed.up({ x: 1, y: 1, shift: false, alt: false })
    expect(ed.sprite!.frames[0][1].get(1, 1)).toBe(RED)
    expect(ed.sprite!.frames[0][0].get(1, 1)).not.toBe(RED)
    ed.duplicateFrame()
    expect(ed.sprite!.frames[0][2].get(1, 1)).toBe(RED)
    ed.deleteFrame()
    expect(ed.sprite!.meta.frames).toHaveLength(2)
    ed.undo() // delete
    ed.undo() // duplicate
    expect(ed.sprite!.meta.frames).toHaveLength(2)
    ed.undo() // pixel
    expect(ed.sprite!.frames[0][1].get(1, 1)).not.toBe(RED)
    ed.undo() // add
    expect(ed.sprite!.meta.frames).toHaveLength(1)
  })

  it('reorders frames and keeps one frame at least', () => {
    const ed = setup()
    ed.down({ x: 0, y: 0, shift: false, alt: false })
    ed.up({ x: 0, y: 0, shift: false, alt: false })
    ed.addFrame()
    ed.moveFrame(-1)
    expect(ed.frame).toBe(0)
    expect(ed.sprite!.frames[0][1].get(0, 0)).toBe(RED)
    ed.deleteFrame()
    ed.deleteFrame()
    expect(ed.sprite!.meta.frames).toHaveLength(1)
  })

  it('sets one fps for the whole animation, undoably', () => {
    const ed = setup()
    ed.addFrame()
    ed.setFps(4)
    expect(ed.sprite!.meta.frames.map((f) => f.duration)).toEqual([250, 250])
    expect(ed.fps).toBe(4)
    ed.undo()
    expect(ed.fps).toBe(10)
    ed.setFps(60) // capped to MAX_FPS
    expect(ed.fps).toBe(24)
    ed.setFps(0) // raised to MIN_FPS
    expect(ed.fps).toBe(2)
  })

  it('resizes every frame', () => {
    const ed = setup()
    ed.addFrame()
    ed.resize(6, 6, 0, 0)
    expect(ed.sprite!.frames[0].map((b) => b.width)).toEqual([6, 6])
    ed.undo()
    expect(ed.sprite!.frames[0].map((b) => b.width)).toEqual([4, 4])
  })

  it('plays from the current frame and stops when drawing', () => {
    const ed = setup()
    ed.addFrame()
    ed.setFrameIndex(0)
    ed.play()
    expect(ed.playing).toBe(true)
    expect(ed.playIndex).toBe(0)
    ed.down({ x: 0, y: 0, shift: false, alt: false })
    ed.up({ x: 0, y: 0, shift: false, alt: false })
    expect(ed.playing).toBe(false)
  })
})

describe('lospec', () => {
  it('finds the palette name in a link or a slug', () => {
    expect(lospecSlug('https://lospec.com/palette-list/sweetie-16')).toBe('sweetie-16')
    expect(lospecSlug('lospec.com/palette-list/Sweetie-16.json')).toBe('sweetie-16')
    expect(lospecSlug(' endesga-32 ')).toBe('endesga-32')
    expect(lospecSlug('https://evil.example/palette-list/sweetie-16')).toBeNull()
    expect(lospecSlug('https://lospec.com/other/x')).toBeNull()
    expect(lospecSlug('not a name!')).toBeNull()
    expect(lospecSlug('')).toBeNull()
  })
})

describe('sprite origin', () => {
  it('round-trips through the JSON, and is optional', () => {
    const meta = newSprite('a', 4, 4).meta
    expect(parseMeta(serializeMeta(meta)).origin).toBeUndefined()
    meta.origin = { x: 2, y: 3 }
    expect(parseMeta(serializeMeta(meta)).origin).toEqual({ x: 2, y: 3 })
  })
})

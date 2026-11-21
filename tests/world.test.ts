import { describe, expect, it } from 'vitest'
import { cellAt, newMap, parseMap, reframe, serializeMap } from '../editor/src/map'
import { World } from '../editor/src/world'

/** A world of 16 px tiles for a 4 × 2 tiles screen: maps are at least 4 × 2 cells. */
function world() {
  const w = new World()
  w.tileSize = 16
  w.screen = { columns: 4, rows: 2 }
  return w
}

/** The world pixel in the middle of a cell. */
const at = (cx: number, cy: number) => ({ x: cx * 16 + 8, y: cy * 16 + 8 })

describe('map files', () => {
  it('keep tiles by tileset, column and row, one line per row', () => {
    const m = newMap('town', 2, 3, 2, 2)
    m.cells[0] = { tileset: 'outdoor', col: 3, row: 1 }
    m.cells[3] = { tileset: 'house', col: 0, row: 0 }
    const text = serializeMap(m)
    expect(text).toBe(
      [
        '{',
        '  "version": 1,',
        '  "x": 2, "y": 3, "width": 2, "height": 2,',
        '  "tilesets": ["house","outdoor"],',
        '  "cells": [',
        '    [1, 3, 1], null,',
        '    null, [0, 0, 0]',
        '  ]',
        '}',
        '',
      ].join('\n'),
    )
    expect(parseMap('town', text)).toEqual(m)
  })

  it('read broken cells as empty ones', () => {
    const m = parseMap('a', '{ "width": 2, "height": 1, "tilesets": ["t"], "cells": [[5, 0, 0], [0, -1, 0]] }')
    expect(m.cells).toEqual([null, null])
  })

  it('keep their tiles in place in the world when reframed', () => {
    const m = newMap('a', 0, 0, 2, 2)
    m.cells[3] = { tileset: 't', col: 0, row: 0 }
    const r = reframe(m, 1, 1, 3, 3, 16)
    expect(cellAt(r, 1, 1)).toEqual({ tileset: 't', col: 0, row: 0 })
    expect(r.cells.filter(Boolean).length).toBe(1)
  })
})

describe('world editor', () => {
  it('stamps the picked block of tiles where the pointer is, then undoes it', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    const edited: string[] = []
    w.onEdit = (n) => edited.push(n)
    w.setBrush({ tileset: 't', col: 2, row: 5, w: 2, h: 1 })
    w.down(at(1, 0))
    w.up(at(1, 0))
    const m = () => w.maps.get('a')!
    expect(m().cells.slice(0, 4)).toEqual([null, { tileset: 't', col: 2, row: 5 }, { tileset: 't', col: 3, row: 5 }, null])
    expect(edited).toEqual(['a'])
    w.undo()
    expect(m().cells.every((c) => c === null)).toBe(true)
    w.redo()
    expect(cellAt(m(), 2, 0)).toEqual({ tileset: 't', col: 3, row: 5 })
  })

  it('paints every cell along a drag, and erases', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.setBrush({ tileset: 't', col: 0, row: 0, w: 1, h: 1 })
    w.down(at(0, 1))
    w.move(at(3, 1))
    w.up(at(3, 1))
    expect(w.maps.get('a')!.cells.slice(4).every(Boolean)).toBe(true)
    w.setTool('eraser')
    w.down(at(2, 1))
    w.up(at(2, 1))
    expect(cellAt(w.maps.get('a')!, 2, 1)).toBe(null)
  })

  it('repeats a block whole along a drag, on a grid of its size from where it started', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 6, 2))
    w.setBrush({ tileset: 't', col: 1, row: 0, w: 2, h: 1 })
    w.down(at(0, 0))
    w.move(at(4, 0))
    w.up(at(4, 0))
    expect(w.maps.get('a')!.cells.slice(0, 6).map((c) => c?.col ?? null)).toEqual([1, 2, 1, 2, 1, 2])
  })

  it('picks the tile under the pointer with the eyedropper', () => {
    const w = world()
    const m = newMap('a', 0, 0, 4, 2)
    m.cells[5] = { tileset: 't', col: 7, row: 1 }
    w.addMap(m)
    w.setTool('picker')
    w.down(at(1, 1))
    w.up(at(1, 1))
    expect(w.brush).toEqual({ tileset: 't', col: 7, row: 1, w: 1, h: 1 })
    expect(w.tool).toBe('tile')
  })

  it('moves maps by whole cells, never onto another one', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.addMap(newMap('b', 10, 0, 4, 2))
    w.setTool('move')
    w.down(at(0, 0))
    w.move({ x: at(0, 0).x + 37, y: at(0, 0).y })
    expect(w.maps.get('a')!.x).toBe(2)
    // Dropped on b: pushed to the closest free place, touching it (just above it).
    w.move({ x: at(0, 0).x + 10 * 16, y: at(0, 0).y })
    expect(w.placeBlocked).toBe(true)
    w.up(at(10, 0))
    const a = w.maps.get('a')!
    expect([a.x, a.y]).toEqual([10, -2])
    w.undo()
    expect(w.maps.get('a')!.x).toBe(0)
  })

  it('resizes maps from any corner, never below one screen, the tiles staying in place', () => {
    const w = world()
    const m = newMap('a', 0, 0, 6, 3)
    m.cells[0] = { tileset: 't', col: 0, row: 0 }
    w.addMap(m)
    w.setTool('move')
    // The north-west corner, 2 cells up and left: the map grows that way.
    w.startResize('a', 'nw', { x: 0, y: 0 })
    w.move({ x: -32, y: -32 })
    w.up({ x: -32, y: -32 })
    let a = w.maps.get('a')!
    expect([a.x, a.y, a.width, a.height]).toEqual([-2, -2, 8, 5])
    expect(cellAt(a, 0, 0)).toEqual({ tileset: 't', col: 0, row: 0 })
    // The south-east corner, far in: it stops at one screen (4 × 2 cells).
    w.startResize('a', 'se', { x: 6 * 16, y: 3 * 16 })
    w.move({ x: -500, y: -500 })
    w.up({ x: -500, y: -500 })
    a = w.maps.get('a')!
    expect([a.x, a.y, a.width, a.height]).toEqual([-2, -2, 4, 2])
  })

  it('renames a tileset in every map, and knows which maps use one', () => {
    const w = world()
    const m = newMap('a', 0, 0, 4, 2)
    m.cells[0] = { tileset: 'old', col: 0, row: 0 }
    w.addMap(m)
    w.addMap(newMap('b', 10, 0, 4, 2))
    expect(w.mapsUsing('old')).toEqual(['a'])
    expect(w.renameTileset('old', 'new')).toEqual(['a'])
    expect(w.mapsUsing('new')).toEqual(['a'])
    expect(w.mapsUsing('old')).toEqual([])
  })
})

describe('actors on maps', () => {
  it('are saved after the cells, one line each, their own values after their feet, and read back', () => {
    const m = newMap('town', 0, 0, 2, 1)
    m.actors.push(
      { actor: 'villager', x: 8, y: 16, values: { shy: true, lines: ['Nice weather.', 'Bye.'] } },
      { actor: 'chest', x: 24, y: 8, values: {} },
    )
    const text = serializeMap(m)
    expect(text).toContain(
      ['  "cells": [', '    null, null', '  ],', '  "actors": [',
        '    { "actor": "villager", "x": 8, "y": 16, "lines": ["Nice weather.", "Bye."], "shy": true },',
        '    { "actor": "chest", "x": 24, "y": 8 }', '  ]', '}'].join('\n'),
    )
    expect(parseMap('town', text)).toEqual(m)
    // A map without actors has no "actors".
    expect(serializeMap(newMap('a', 0, 0, 1, 1))).not.toContain('actors')
  })

  it('leave out broken actors when read', () => {
    const m = parseMap('a', '{ "width": 2, "height": 1, "actors": [{ "actor": "a", "x": 1, "y": 2 }, { "x": 1, "y": 2 }, { "actor": "b", "x": -4, "y": 2 }, null] }')
    expect(m.actors).toEqual([{ actor: 'a', x: 1, y: 2, values: {} }])
  })

  it('keep their own values, set with undo, and each copy its own', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.setMode('maps')
    const v = { actor: 'villager', x: 24, y: 16, values: { lines: ['Hi.'] } as Record<string, unknown> }
    w.maps.get('a')!.actors.push(v)
    w.selection = new Set([v])
    w.setValue('lines', ['Hello.'])
    w.setValue('lines', ['Hello.']) // The same value: nothing to undo.
    expect(v.values).toEqual({ lines: ['Hello.'] })
    // Undo brings the value back, and keeps the actor it was set on selected.
    w.undo()
    const back = w.maps.get('a')!.actors
    expect(back.map((t) => t.values)).toEqual([{ lines: ['Hi.'] }])
    expect([...w.selection]).toEqual([back[0]])
    // Cleared: it takes its actor file's value again.
    w.setValue('lines', undefined)
    expect(back[0].values).toEqual({})
    w.setValue('lines', ['Hello.'])
    w.duplicate()
    const copy = w.maps.get('a')!.actors[1]
    expect(copy.values).toEqual({ lines: ['Hello.'] })
    ;(copy.values.lines as string[]).push('More.')
    expect(back[0].values.lines).toEqual(['Hello.'])
  })

  it('stay in place in the world when a map is reframed, and the ones left outside go', () => {
    const m = newMap('a', 0, 0, 4, 2)
    m.actors.push({ actor: 'A', x: 40, y: 16, values: {} }, { actor: 'B', x: 8, y: 16, values: {} })
    const r = reframe(m, 2, 0, 2, 2, 16)
    expect(r.actors).toEqual([{ actor: 'A', x: 8, y: 16, values: {} }])
  })

  it('are placed on the half tile under the pointer, standing on it', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.addMap(newMap('b', 4, 0, 4, 2))
    const edited: string[] = []
    w.onEdit = (n) => edited.push(n)
    w.setPlacing('Villager')
    expect([w.mode, w.tool]).toEqual(['maps', 'place'])
    w.down({ x: 21, y: 3 })
    w.up({ x: 21, y: 3 })
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'Villager', x: 24, y: 8, values: {} }])
    // In the second map: from its own top left. The new one is the selection.
    w.down({ x: 70, y: 20 })
    w.up({ x: 70, y: 20 })
    expect(w.maps.get('b')!.actors).toEqual([{ actor: 'Villager', x: 8, y: 24, values: {} }])
    expect([...w.selection]).toEqual(w.maps.get('b')!.actors)
    expect(edited).toEqual(['a', 'b'])
    w.undo()
    expect(w.maps.get('b')!.actors).toEqual([])
  })

  it('belong to a mode: tiles are painted under them, and each mode keeps its last tool', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.maps.get('a')!.actors.push({ actor: 'A', x: 8, y: 16, values: {} })
    w.setBrush({ tileset: 't', col: 0, row: 0, w: 1, h: 1 })
    expect(w.mode).toBe('tiles')
    w.down(at(0, 0))
    w.up(at(0, 0))
    expect(cellAt(w.maps.get('a')!, 0, 0)).toEqual({ tileset: 't', col: 0, row: 0 })
    expect(w.selection.size).toBe(0)
    w.setTool('eraser')
    w.setMode('maps')
    expect(w.tool).toBe('select')
    w.setTool('move')
    w.setMode('tiles')
    expect(w.tool).toBe('eraser')
    w.setMode('maps')
    expect(w.tool).toBe('move')
  })

  it('share the Maps mode with the maps: each tool does one thing, one selection holds either', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    const t = { actor: 'A', x: 24, y: 16, values: {} }
    w.maps.get('a')!.actors.push(t)
    w.setMode('maps')
    // Select: a drag on the ground draws a box, it never moves the map.
    w.down(at(3, 0))
    w.move(at(3, 1))
    w.up(at(3, 1))
    expect([w.maps.get('a')!.x, w.maps.get('a')!.y]).toEqual([0, 0])
    // Move map: the map moves, and is the one selected.
    w.select([t])
    w.setTool('move')
    expect(w.selection.size).toBe(1)
    w.down(at(3, 0))
    w.move(at(5, 1))
    w.up(at(5, 1))
    expect([w.maps.get('a')!.x, w.maps.get('a')!.y]).toEqual([2, 1])
    expect([w.selectedMap, w.selection.size]).toEqual(['a', 0])
    // Selecting actors (from the list, whatever the tool) leaves the map, and back.
    w.select([t])
    expect([w.selectedMap, w.tool]).toEqual([null, 'move'])
    w.selectMap('a')
    expect(w.selection.size).toBe(0)
    w.renameMap('a', 'b')
    expect(w.selectedMap).toBe('b')
    w.removeMap('b')
    expect(w.selectedMap).toBeNull()
    // Tiles has no selection.
    w.select([])
    w.selectMap(null)
    w.setMode('tiles')
    expect([w.selectedMap, w.selection.size]).toEqual([null, 0])
  })

  it('are dragged together, into another map too, in one undo', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.addMap(newMap('b', 4, 0, 4, 2))
    const a = { actor: 'A', x: 24, y: 16, values: {} }
    const b = { actor: 'B', x: 40, y: 16, values: {} }
    w.maps.get('a')!.actors.push(a, b)
    w.setMode('maps')
    w.down({ x: 28, y: 10 })
    w.up({ x: 28, y: 10 })
    w.shift = true
    w.down({ x: 42, y: 10 })
    w.up({ x: 42, y: 10 })
    w.shift = false
    expect(w.selection).toEqual(new Set([a, b]))
    // Grabbed by A's picture (a tile above its feet), moved 16 pixels right: still in a.
    w.down({ x: 28, y: 10 })
    w.move({ x: 44, y: 10 })
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'A', x: 40, y: 16, values: {} }, { actor: 'B', x: 56, y: 16, values: {} }])
    // 48 pixels right: both cross into b.
    w.move({ x: 76, y: 10 })
    // Further right, B would leave every map: neither moves.
    w.move({ x: 120, y: 10 })
    w.up({ x: 120, y: 10 })
    expect(w.maps.get('a')!.actors).toEqual([])
    expect(w.maps.get('b')!.actors).toEqual([{ actor: 'A', x: 8, y: 16, values: {} }, { actor: 'B', x: 24, y: 16, values: {} }])
    w.undo()
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'A', x: 24, y: 16, values: {} }, { actor: 'B', x: 40, y: 16, values: {} }])
    expect(w.maps.get('b')!.actors).toEqual([])
    w.redo()
    expect(w.maps.get('b')!.actors).toHaveLength(2)
  })

  it('are hit by their picture, the one in front first, and deleted', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.actorBounds = (type) => (type === 'Tall' ? { x: -4, y: -30, w: 8, h: 30 } : null)
    const tall = { actor: 'Tall', x: 16, y: 32, values: {} }
    const small = { actor: 'A', x: 16, y: 16, values: {} }
    w.maps.get('a')!.actors.push(tall, small)
    // Where both are, the lower one (Tall's feet are lower) is in front, as in the game.
    expect(w.actorAt({ x: 17, y: 10 })).toBe(tall)
    expect(w.actorAt({ x: 10, y: 10 })).toBe(small)
    expect(w.actorAt({ x: 40, y: 20 })).toBe(null)
    w.setMode('maps')
    w.down({ x: 17, y: 20 })
    w.up({ x: 17, y: 20 })
    w.deleteSelection()
    expect(w.maps.get('a')!.actors).toEqual([small])
    w.undo()
    expect(w.maps.get('a')!.actors).toHaveLength(2)
  })

  it('are selected with a box, Shift adding to the selection', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 8, 2))
    const [a, b, c] = [8, 40, 100].map((x) => ({ actor: 'A', x, y: 16, values: {} }))
    w.maps.get('a')!.actors.push(a, b, c)
    w.setMode('maps')
    w.down({ x: 0, y: 30 })
    w.move({ x: 34, y: 5 })
    expect(w.selectBox).toEqual({ x: 0, y: 5, w: 34, h: 25 })
    w.up({ x: 34, y: 5 })
    expect(w.selection).toEqual(new Set([a, b]))
    w.shift = true
    w.down({ x: 120, y: 30 })
    w.move({ x: 95, y: 5 })
    w.up({ x: 95, y: 5 })
    expect(w.selection).toEqual(new Set([a, b, c]))
    // A click on the ground clears it.
    w.shift = false
    w.down({ x: 60, y: 30 })
    w.up({ x: 60, y: 30 })
    expect(w.selection.size).toBe(0)
  })

  it('are nudged, copied, pasted and duplicated', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 8, 4))
    w.addMap(newMap('b', 8, 0, 8, 4))
    w.maps.get('a')!.actors.push({ actor: 'A', x: 16, y: 32, values: {} }, { actor: 'B', x: 32, y: 48, values: {} })
    w.setMode('maps')
    w.selectAll()
    w.nudge(8, -8)
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'A', x: 24, y: 24, values: {} }, { actor: 'B', x: 40, y: 40, values: {} }])
    w.copy()
    // At the pointer, in the other map, keeping their places to each other.
    w.move({ x: 160, y: 16 })
    w.paste()
    expect(w.maps.get('b')!.actors).toEqual([{ actor: 'A', x: 32, y: 16, values: {} }, { actor: 'B', x: 48, y: 32, values: {} }])
    expect(w.selection).toEqual(new Set(w.maps.get('b')!.actors))
    // Duplicated: one step aside, and selected.
    w.leave()
    w.duplicate()
    expect(w.maps.get('b')!.actors.slice(2)).toEqual([{ actor: 'A', x: 40, y: 24, values: {} }, { actor: 'B', x: 56, y: 40, values: {} }])
    expect(w.selection.size).toBe(2)
    w.undo()
    expect(w.maps.get('b')!.actors).toHaveLength(2)
  })

  it('snap to half tiles by the frame of their sprite, whatever their feet', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 8, 4))
    // A 16 × 16 sprite with its origin at (7, 14): the feet are not on any grid line.
    w.actorFrame = (type) => (type === 'Hero' ? { x: -7, y: -14, w: 16, h: 16 } : type === 'Boss' ? { x: -16, y: -31, w: 32, h: 32 } : null)
    w.setMode('maps')
    w.setPlacing('Hero')
    // The pointer holds the frame by the middle: near a cell's middle, it fills that cell.
    w.down({ x: 40, y: 24 })
    w.up({ x: 40, y: 24 })
    w.down({ x: 42, y: 26 })
    w.up({ x: 42, y: 26 })
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'Hero', x: 39, y: 30, values: {} }, { actor: 'Hero', x: 39, y: 30, values: {} }])
    // Its frame on half tiles, wherever the pointer holds it.
    w.setPlacing('Boss')
    w.down({ x: 70, y: 30 })
    w.up({ x: 70, y: 30 })
    expect(w.maps.get('a')!.actors[2]).toEqual({ actor: 'Boss', x: 72, y: 47, values: {} })
    // Dragged, the actor held snaps by its frame, and the others keep their places to it.
    w.setTool('select')
    w.selectAll()
    w.down({ x: 40, y: 25 })
    w.move({ x: 61, y: 30 })
    w.up({ x: 61, y: 30 })
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'Hero', x: 63, y: 38, values: {} }, { actor: 'Hero', x: 63, y: 38, values: {} }, { actor: 'Boss', x: 96, y: 55, values: {} }])
    // Pasted: the pointer holds the top one, as when placing it.
    w.selection = new Set([w.maps.get('a')!.actors[0]])
    w.copy()
    w.move({ x: 10, y: 50 })
    w.paste()
    expect(w.maps.get('a')!.actors[3]).toEqual({ actor: 'Hero', x: 7, y: 54, values: {} })
  })

  it('are removed by the Eraser, a whole stroke undone at once', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 8, 2))
    w.addMap(newMap('b', 8, 0, 8, 2))
    const [a, b, c] = [8, 40, 100].map((x) => ({ actor: 'A', x, y: 16, values: {} }))
    const d = { actor: 'A', x: 12, y: 16, values: {} } // 140 in the world
    w.maps.get('a')!.actors.push(a, b, c)
    w.maps.get('b')!.actors.push(d)
    w.setMode('maps')
    w.selectAll()
    w.setTool('remove')
    // A click on the ground removes nothing; a stroke, every actor it crosses, in any map.
    w.down({ x: 60, y: 30 })
    w.up({ x: 60, y: 30 })
    expect(w.canUndo).toBe(false)
    w.down({ x: 8, y: 10 })
    w.move({ x: 140, y: 10 })
    w.up({ x: 140, y: 10 })
    expect(w.maps.get('a')!.actors).toEqual([])
    expect(w.maps.get('b')!.actors).toEqual([])
    expect(w.selection.size).toBe(0)
    w.undo()
    expect(w.maps.get('a')!.actors).toEqual([a, b, c])
    expect(w.maps.get('b')!.actors).toEqual([d])
  })

  it('go anywhere by the pixel with snapping off', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 8, 4))
    w.actorFrame = (type) => (type === 'Hero' ? { x: -7, y: -14, w: 16, h: 16 } : null)
    w.snap = false
    w.setMode('maps')
    w.setPlacing('Hero')
    w.down({ x: 33.4, y: 17 })
    w.up({ x: 33.4, y: 17 })
    w.setPlacing('Spawner')
    w.down({ x: 13, y: 17.6 })
    w.up({ x: 13, y: 17.6 })
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'Hero', x: 32, y: 23, values: {} }, { actor: 'Spawner', x: 13, y: 18, values: {} }])
    w.setTool('select')
    w.down({ x: 34, y: 18 })
    w.move({ x: 37, y: 19 })
    w.up({ x: 37, y: 19 })
    expect(w.maps.get('a')!.actors[0]).toEqual({ actor: 'Hero', x: 35, y: 24, values: {} })
  })

  it('with no sprite, have their feet on half tiles', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 8, 4))
    w.setMode('maps')
    w.setPlacing('Spawner')
    w.down({ x: 13, y: 17 })
    w.up({ x: 13, y: 17 })
    expect(w.maps.get('a')!.actors).toEqual([{ actor: 'Spawner', x: 16, y: 24, values: {} }])
  })

  it('count by class, and every one of a class can be selected', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    w.addMap(newMap('b', 4, 0, 4, 2))
    w.maps.get('a')!.actors.push({ actor: 'Chest', x: 8, y: 16, values: {} }, { actor: 'A', x: 24, y: 16, values: {} })
    w.maps.get('b')!.actors.push({ actor: 'Chest', x: 8, y: 16, values: {} })
    expect(w.countOf('Chest')).toBe(2)
    w.selectAllOf('Chest')
    expect(w.mode).toBe('maps')
    expect([...w.selection].map((t) => t.actor)).toEqual(['Chest', 'Chest'])
  })

  it('go nowhere outside the maps, and need a class picked first', () => {
    const w = world()
    w.addMap(newMap('a', 0, 0, 4, 2))
    const said: string[] = []
    w.onMessage = (t) => said.push(t)
    w.setTool('place')
    w.down({ x: 8, y: 8 })
    w.setPlacing('A')
    w.down({ x: 200, y: 8 })
    expect(said).toEqual(['Pick an actor in the Actors panel first', 'Actors go inside a map'])
    expect(w.maps.get('a')!.actors).toEqual([])
  })
})

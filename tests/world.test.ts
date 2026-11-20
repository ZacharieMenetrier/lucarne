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
    const r = reframe(m, 1, 1, 3, 3)
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

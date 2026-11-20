import { describe, expect, it } from 'vitest'
import { ActorBoxes, boxFromDrag, parseActors, serializeActors } from '../editor/src/actors'
import { isEditorFile } from '../editor/src/github'

describe('actors.json', () => {
  it('keeps each class its box, one line per class, sorted by name', () => {
    const boxes = new Map([
      ['Villager', { x: -4, y: -5, width: 8, height: 5 }],
      ['Hero', { x: -5, y: -6, width: 10, height: 6 }],
    ])
    const text = serializeActors(boxes)
    expect(text).toBe(`{
  "version": 1,
  "actors": {
    "Hero": { "box": { "x": -5, "y": -6, "width": 10, "height": 6 } },
    "Villager": { "box": { "x": -4, "y": -5, "width": 8, "height": 5 } }
  }
}
`)
    expect(parseActors(text)).toEqual(new Map([...boxes].reverse()))
    expect(serializeActors(new Map())).toBe('{\n  "version": 1,\n  "actors": {}\n}\n')
  })

  it('leaves out boxes that were not drawn here (fractions, empty, missing)', () => {
    const text = JSON.stringify({
      version: 1,
      actors: {
        Half: { box: { x: 0.5, y: 0, width: 4, height: 4 } },
        Flat: { box: { x: 0, y: 0, width: 4, height: 0 } },
        Bare: {},
        Ok: { box: { x: 0, y: -2, width: 1, height: 2 } },
      },
    })
    expect([...parseActors(text).keys()]).toEqual(['Ok'])
  })

  it('syncs with GitHub, like the other files the editor writes', () => {
    expect(isEditorFile('actors.json')).toBe(true)
  })
})

describe('drawing a box', () => {
  it('covers both pixels of the drag, whichever way it goes', () => {
    expect(boxFromDrag({ x: 3, y: -1 }, { x: -2, y: -6 })).toEqual({ x: -2, y: -6, width: 6, height: 6 })
    expect(boxFromDrag({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('is undone and redone, and says what changed', () => {
    const edits: string[] = []
    const m = new ActorBoxes()
    m.onEdit = (n) => edits.push(n)
    const a = { x: -5, y: -6, width: 10, height: 6 }
    m.set('Hero', a)
    m.set('Hero', a) // The same box: nothing to undo.
    m.set('Hero', { ...a, width: 8 })
    m.set('Hero', null)
    expect(m.get('Hero')).toBe(null)
    m.undo()
    expect(m.get('Hero')).toEqual({ ...a, width: 8 })
    m.undo()
    expect(m.get('Hero')).toEqual(a)
    m.undo()
    expect(m.boxes.has('Hero')).toBe(false)
    m.redo()
    expect(m.get('Hero')).toEqual(a)
    expect(edits).toEqual(['Hero', 'Hero', 'Hero', 'Hero', 'Hero', 'Hero', 'Hero'])
  })
})

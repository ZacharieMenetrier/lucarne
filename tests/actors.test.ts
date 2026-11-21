import { describe, expect, it } from 'vitest'
import { ActorFiles, boxFromDrag, boxHandle, boxWhenOn, dragBox, fileLayers, setBoxField, inlineJson, parseActorFile, resolve, serializeActorFile } from '../editor/src/actors'
import { isEditorFile } from '../editor/src/github'

describe('actor files', () => {
  it('hold one value per line, the box first, then by name', () => {
    const values = { speed: 0.5, lines: ['Hi.', 'Bye.'], box: { x: -5, y: -6, width: 10, height: 6 }, shy: true }
    const text = serializeActorFile(values)
    expect(text).toBe(`{
  "box": { "x": -5, "y": -6, "width": 10, "height": 6 },
  "lines": ["Hi.", "Bye."],
  "shy": true,
  "speed": 0.5
}
`)
    expect(parseActorFile(text)).toEqual(values)
    expect(serializeActorFile({})).toBe('{}\n')
    expect(() => parseActorFile('[1]')).toThrow('an actor file holds an object')
  })

  it('write values on one line, spaced like the other files', () => {
    expect(inlineJson({ a: [1, 'b'], c: {} })).toBe('{ "a": [1, "b"], "c": {} }')
    expect(inlineJson(null)).toBe('null')
  })

  it('sync with GitHub, like the other files the editor writes, but not the code', () => {
    expect(isEditorFile('actors/hero.json')).toBe(true)
    expect(isEditorFile('actors/hero.ts')).toBe(false)
  })
})

describe('values', () => {
  it("are the code's default, then each layer that sets them, the nearest last", () => {
    const files = new ActorFiles(new Map([['villager', { speed: 0.5, shy: true }], ['guard', { speed: 2 }]]))
    const layers = fileLayers({ name: 'guard', parents: ['villager'] }, files)
    expect(resolve('speed', 1, layers)).toEqual({ value: 2, from: 'guard' })
    expect(resolve('shy', false, layers)).toEqual({ value: true, from: 'villager' })
    expect(resolve('lines', ['Hello!'], layers)).toEqual({ value: ['Hello!'], from: null })
    expect(resolve('speed', 1, [...layers, { from: 'here', values: { speed: 3 } }])).toEqual({ value: 3, from: 'here' })
  })

  it('are set and cleared with undo, and an actor with none set has no file', () => {
    const edits: string[] = []
    const files = new ActorFiles()
    files.onEdit = (n) => edits.push(n)
    const box = { x: -5, y: -6, width: 10, height: 6 }
    files.set('hero', 'box', box)
    files.set('hero', 'box', { ...box }) // The same box: nothing to undo.
    files.set('hero', 'speed', 2)
    files.set('hero', 'box', null) // No box, even if a parent has one.
    expect(files.values('hero')).toEqual({ box: null, speed: 2 })
    files.set('hero', 'box', undefined) // Cleared: inherited again.
    expect(files.values('hero')).toEqual({ speed: 2 })
    files.undo()
    files.undo()
    expect(files.values('hero')).toEqual({ box, speed: 2 })
    files.undo()
    files.undo()
    expect(files.files.has('hero')).toBe(false)
    files.redo()
    expect(files.values('hero')).toEqual({ box })
    expect(edits).toEqual(['hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero'])
  })
})

describe('drawing a box', () => {
  it('covers both pixels of the drag, whichever way it goes', () => {
    expect(boxFromDrag({ x: 3, y: -1 }, { x: -2, y: -6 })).toEqual({ x: -2, y: -6, width: 6, height: 6 })
    expect(boxFromDrag({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('editing a box on the actor', () => {
  const box = { x: -4, y: -8, width: 8, height: 8 }

  it('is held by an edge, a corner, or its inside', () => {
    expect(boxHandle(box, { x: 0, y: -4 }, 0.5)).toBe('move')
    expect(boxHandle(box, { x: -4.2, y: -4 }, 0.5)).toBe('w')
    expect(boxHandle(box, { x: 4.3, y: 0.2 }, 0.5)).toBe('se')
    expect(boxHandle(box, { x: 0, y: -8.4 }, 0.5)).toBe('n')
    expect(boxHandle(box, { x: 6, y: -4 }, 0.5)).toBeNull()
  })

  it('moves and resizes by whole pixels, keeping at least one pixel', () => {
    expect(dragBox(box, 'move', 2.4, -1.6)).toEqual({ x: -2, y: -10, width: 8, height: 8 })
    expect(dragBox(box, 'e', 3, 0)).toEqual({ x: -4, y: -8, width: 11, height: 8 })
    expect(dragBox(box, 'nw', 2, 2)).toEqual({ x: -2, y: -6, width: 6, height: 6 })
    expect(dragBox(box, 'w', 20, 0)).toEqual({ x: 3, y: -8, width: 1, height: 8 })
    expect(dragBox(box, 's', 0, -20)).toEqual({ x: -4, y: -8, width: 8, height: 1 })
  })

  it('takes typed numbers as whole pixels, a size of at least one', () => {
    expect(setBoxField(box, 'x', -6.4)).toEqual({ ...box, x: -6 })
    expect(setBoxField(box, 'width', 0)).toEqual({ ...box, width: 1 })
  })

  it('comes back as the inherited box, or around the picture', () => {
    expect(boxWhenOn(box, null)).toBeUndefined()
    expect(boxWhenOn(null, { x: -5, y: -12, w: 10, h: 12 })).toEqual({ x: -5, y: -12, width: 10, height: 12 })
    expect(boxWhenOn(null, null)).toEqual({ x: -4, y: -8, width: 8, height: 8 })
  })
})

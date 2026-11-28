import { describe, expect, it } from 'vitest'
import { inlineJson, sameValue, staleNames } from '../editor/src/actors'
import { isEditorFile } from '../editor/src/github'

describe('placed actor values', () => {
  it('write values on one line, spaced like the other files', () => {
    expect(inlineJson({ a: [1, 'b'], c: {} })).toBe('{ "a": [1, "b"], "c": {} }')
    expect(inlineJson(null)).toBe('null')
  })

  it('name what the code no longer declares, to remove it', () => {
    expect(staleNames({ speed: 1, sped: 2, box: null }, [{ name: 'speed' }])).toEqual(['box', 'sped'])
    expect(sameValue(['a'], ['a'])).toBe(true)
  })

  it('live in the maps: actors/ holds only code, which does not sync from the editor', () => {
    expect(isEditorFile('actors/hero.json')).toBe(false)
    expect(isEditorFile('actors/hero.ts')).toBe(false)
  })
})

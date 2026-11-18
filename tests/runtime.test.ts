import { describe, expect, it } from 'vitest'
import { Sprite, setSprites, sprite } from '../runtime/sprites'

const data = {
  name: 'hero',
  frameWidth: 8,
  frameHeight: 8,
  directions: ['north', 'east'],
  durations: [100, 50, 100],
  sheet: {} as CanvasImageSource,
}

describe('sprites', () => {
  it('picks the frame for a time, looping', () => {
    const s = new Sprite(data)
    expect(s.duration).toBe(250)
    expect([0, 99, 100, 149, 150, 249, 250, 350].map((t) => s.frameAt(t))).toEqual([0, 0, 1, 1, 2, 2, 0, 1])
    expect(s.frameAt(-1)).toBe(2)
  })

  it('finds directions by name or index, and says which exist', () => {
    const s = new Sprite(data)
    expect(s.row('east')).toBe(1)
    expect(s.row(0)).toBe(0)
    expect(() => s.row('west')).toThrow('it has: north, east')
  })

  it('looks sprites up by name', () => {
    setSprites([data])
    expect(sprite('hero').origin).toEqual({ x: 0, y: 0 })
    expect(() => sprite('cat')).toThrow('there are: hero')
  })
})

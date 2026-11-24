import { describe, expect, it } from 'vitest'
import { RATE } from '../runtime/sound'
import { COLUMNS, LOUDEST, SPEED_SECONDS, TEXTURES, emptySound, lastColumn, parseSound, renderDry, renderSound, rowFrequency, serializeSound, synthesize } from '../runtime/sfx'
import { SoundEditor, fromCode, randomSound, soundCode } from '../editor/src/sfx'

const FILES = Object.fromEntries(
  Object.entries(import.meta.glob('../runtime/sounds/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).map(([p, t]) => [p.replace(/^.*\//, '').replace(/\.json$/, ''), t]),
)
const builtIn = (name: string) => parseSound(FILES[name])

describe('sound files', () => {
  it('round-trip, writing only what is not the default', () => {
    const s = emptySound()
    s.texture = 'glass'
    s.pitch[0] = 12
    s.pitch[3] = 5
    s.volume[1] = 4
    const text = serializeSound(s)
    expect(JSON.parse(text)).toEqual({ texture: 'glass', pitch: [12, null, null, 5], volume: [23, 4] })
    expect(parseSound(text)).toEqual(s)
  })

  it('fills missing columns and clamps values', () => {
    const s = parseSound('{"texture":"nope","pitch":[40,-1],"volume":[99]}')
    expect(s.texture).toBe('soft')
    expect(s.pitch.length).toBe(COLUMNS)
    expect(s.pitch.slice(0, 3)).toEqual([23, 0, null])
    expect(s.volume[0]).toBe(LOUDEST)
  })

  it('the built-in sounds all read and make a sound', () => {
    expect(Object.keys(FILES).length).toBe(25)
    for (const [name, text] of Object.entries(FILES)) {
      const s = parseSound(text)
      expect(lastColumn(s), name).toBeGreaterThanOrEqual(0)
      expect(serializeSound(s)).toBe(text)
    }
  })
})

describe('sound codes', () => {
  it('match the tool the sounds were made in', () => {
    expect(soundCode(builtIn('coin'))).toBe('310022/jnjnlnlmlklhldl9l5' + '.n'.repeat(15))
  })

  it('round-trip, and read the older formats', () => {
    const s = randomSound()
    expect(fromCode(soundCode(s))).toEqual(s)
    const v5 = fromCode('31002/jnjn' + '.n'.repeat(22))!
    expect(v5.ring).toBe('normal')
    expect(v5.pitch.slice(0, 3)).toEqual([19, 19, null])
    const old = fromCode('31002:j3j1' + '.3'.repeat(22))!
    expect(old.volume.slice(0, 2)).toEqual([23, 10])
    expect(fromCode('nope')).toBeNull()
  })
})

describe('making a sound', () => {
  it('rows are a pentatonic scale from C2', () => {
    expect(rowFrequency(0)).toBeCloseTo(65.41, 1)
    expect(rowFrequency(5)).toBeCloseTo(130.81, 1)
    expect(rowFrequency(23)).toBeCloseTo(1567.98, 0)
  })

  it('nothing drawn is no sound', () => {
    expect(synthesize(emptySound())).toBeNull()
  })

  it('every texture makes a sound at 16 kHz in 8-bit steps, as long as drawn at least', async () => {
    for (const texture of TEXTURES) {
      const s = builtIn('jump')
      s.texture = texture
      const d = renderSound(s)!
      expect(d.length, texture).toBeGreaterThanOrEqual(Math.floor(5 * SPEED_SECONDS[s.speed] * RATE))
      let peak = 0
      for (const x of d) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Math.round(x * 127)).toBeCloseTo(x * 127, 4)
        peak = Math.max(peak, Math.abs(x))
      }
      expect(peak, texture).toBeGreaterThan(0.5)
      expect(peak).toBeLessThanOrEqual(1)
    }
  })

  it('the echo repeats the sound after its delay, and makes it longer', () => {
    const s = emptySound()
    s.texture = 'click'
    s.pitch[0] = 12
    const dry = renderSound(s)!
    s.echo = 'lots'
    const wet = renderSound(s)!
    expect(wet.length).toBeGreaterThan(dry.length + RATE)
    // A click, then its first repeat 0.2 s later (louder than the room around it).
    const level = (a: number, b: number) => Math.max(...wet.slice(a, b).map(Math.abs))
    const at = Math.round(0.2 * RATE)
    expect(level(at - 40, at + 200)).toBeGreaterThan(2 * level(at - 600, at - 300))
  })

  it('a quiet column is quieter', () => {
    const s = emptySound()
    s.pitch[0] = s.pitch[10] = 12
    s.volume[10] = 0
    const d = renderDry(s)!
    const col = Math.round(SPEED_SECONDS.fast * RATE)
    const peak = (a: number) => Math.max(...d.slice(a, a + col).map(Math.abs))
    expect(peak(10 * col)).toBeLessThan(peak(0) / 10)
  })
})

describe('SoundEditor', () => {
  const open = () => {
    const ed = new SoundEditor()
    const edits: string[] = []
    ed.onEdit = (n) => edits.push(n)
    ed.open('beep', emptySound())
    return { ed, edits }
  }

  it('a stroke draws a line of pixels, one undo', () => {
    const { ed, edits } = open()
    ed.down(0, 0)
    ed.move(4, 8)
    ed.up()
    expect(ed.sound!.pitch.slice(0, 6)).toEqual([0, 2, 4, 6, 8, null])
    expect(edits).toEqual(['beep'])
    ed.undo()
    expect(lastColumn(ed.sound!)).toBe(-1)
    ed.redo()
    expect(ed.sound!.pitch[4]).toBe(8)
  })

  it('pressing on a pixel erases, the eraser erases, the right button erases', () => {
    const { ed } = open()
    ed.down(2, 5)
    ed.up()
    ed.down(2, 5)
    ed.move(3, 5)
    ed.up()
    expect(ed.sound!.pitch[2]).toBeNull()
    ed.down(1, 1)
    ed.up()
    ed.down(1, 9, true)
    ed.up()
    expect(ed.sound!.pitch[1]).toBeNull()
    ed.down(0, 3)
    ed.up()
    ed.setTool('eraser')
    ed.down(0, 20)
    ed.up()
    expect(ed.sound!.pitch[0]).toBeNull()
  })

  it('the volume tool sets each column, heard where there is a pixel', () => {
    const { ed } = open()
    const heard: number[][] = []
    ed.onPlace = (r, v) => heard.push([r, v])
    ed.down(1, 7)
    ed.up()
    ed.setTool('volume')
    ed.down(0, 10)
    ed.move(2, 12)
    ed.up()
    expect(ed.sound!.volume.slice(0, 4)).toEqual([10, 11, 12, LOUDEST])
    expect(ed.sound!.pitch[1]).toBe(7)
    expect(heard).toEqual([[7, LOUDEST], [7, 11]])
  })

  it('settings, clear and a pasted code are each one undo', () => {
    const { ed, edits } = open()
    ed.set('texture', 'metal')
    ed.set('texture', 'metal')
    expect(edits.length).toBe(1)
    ed.down(0, 3)
    ed.up()
    ed.clear()
    expect(ed.sound!.texture).toBe('metal')
    expect(lastColumn(ed.sound!)).toBe(-1)
    expect(ed.paste('not a code')).toBe(false)
    expect(ed.paste(soundCode(builtIn('coin')))).toBe(true)
    expect(ed.sound!.texture).toBe('retro')
    ed.undo()
    ed.undo()
    expect(ed.sound!.pitch[0]).toBe(3)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type { GameConfig } from '../runtime/game'
import { Runner } from '../runtime/runner'
import { JUMP, link } from '../runtime/interpolate'
import { attachScreen, presentScreen, recordScreen, screen, type Command } from '../runtime/screen'
import { Sprite, setSprites, sprite } from '../runtime/sprites'

const data = {
  name: 'hero',
  frameWidth: 8,
  frameHeight: 8,
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

  it('looks sprites up by name', () => {
    setSprites([data])
    expect(sprite('hero').origin).toEqual({ x: 0, y: 0 })
    expect(() => sprite('cat')).toThrow('there are: hero')
  })
})

/** A canvas whose context records fills and images, in display pixels. */
function fakeCanvas(width: number, height: number) {
  const calls: unknown[][] = []
  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect: (...a: number[]) => calls.push(['rect', ...a]),
    drawImage: (...a: unknown[]) => calls.push(['image', ...a.slice(1)]),
    save() {},
    restore() {},
    translate: (...a: number[]) => calls.push(['translate', ...a]),
    scale() {},
  }
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement
  return { canvas, ctx, calls }
}

describe('screen', () => {
  it('keeps game pixels as the unit and scales to the canvas', () => {
    const { canvas, ctx, calls } = fakeCanvas(1920, 1080)
    attachScreen(canvas, 384, 216)
    expect([screen.width, screen.height]).toEqual([384, 216])
    expect(ctx.imageSmoothingEnabled).toBe(false)
    const drawn = recordScreen(() => {
      screen.clear('#000')
      screen.rect(10, 20, 3, 2, '#fff')
    })
    expect(calls).toEqual([])
    presentScreen(drawn, 1)
    expect(calls).toEqual([
      ['rect', 0, 0, 1920, 1080],
      ['rect', 50, 100, 15, 10],
    ])
    attachScreen(null)
  })

  it('places fractions on display pixels, never resampling the art', () => {
    setSprites([{ ...data, origin: { x: 2, y: 7 } }])
    const { canvas, calls } = fakeCanvas(1920, 1080)
    attachScreen(canvas, 384, 216)
    const s = sprite('hero')
    // 1.5 game pixels at ×5: 7.5 display pixels, rounded to 8; the 8×8 art becomes 40×40.
    const drawn = recordScreen(() => {
      screen.sprite(s, 11.5, 10, { frame: 0 })
      screen.sprite(s, 11.5, 10, { frame: 0, flipX: true })
    })
    presentScreen(drawn, 1)
    expect(calls).toEqual([
      ['image', 0, 0, 8, 8, 58 - 10, 50 - 35, 40, 40],
      ['translate', 58 - 25 + 40, 50 - 35],
      ['image', 0, 0, 8, 8, 0, 0, 40, 40],
    ])
    attachScreen(null)
  })

  it('can only be drawn on in draw()', () => {
    expect(() => screen.rect(0, 0, 1, 1, '#fff')).toThrow("only be drawn on in the game's draw()")
  })
})

describe('interpolation', () => {
  beforeEach(() => setSprites([data, { ...data, name: 'bat' }, { ...data, name: 'hero_idle' }]))
  /** Records a draw, paired with the one before; returns where each thing was before. */
  function step(previous: Command[], draw: () => void) {
    const next = recordScreen(draw)
    link(previous, next)
    return next
  }
  const froms = (cmds: Command[]) => cmds.map((c) => (c.kind === 'clear' ? null : (c.from ?? null)))

  it('moves what moved, between its two positions', () => {
    const { canvas, calls } = fakeCanvas(10, 10)
    attachScreen(canvas, 10, 10)
    const a = step([], () => screen.rect(0, 0, 1, 1, '#fff'))
    const b = step(a, () => screen.rect(4, 2, 1, 1, '#fff'))
    presentScreen(b, 0.5)
    expect(calls).toEqual([['rect', 2, 1, 1, 1]])
    attachScreen(null)
  })

  it('keeps each of two identical things on its own path, whatever the order', () => {
    const a = step([], () => {
      screen.sprite(sprite('bat'), 0, 0)
      screen.sprite(sprite('bat'), 50, 0)
    })
    const b = step(a, () => {
      screen.sprite(sprite('bat'), 51, 0)
      screen.sprite(sprite('bat'), 1, 0)
    })
    expect(froms(b)).toEqual([{ x: 50, y: 0 }, { x: 0, y: 0 }])
  })

  it('follows a sprite that turns into another, and leaves still things alone', () => {
    const a = step([], () => {
      screen.clear('#000')
      screen.rect(5, 5, 2, 2, '#fff')
      screen.sprite(sprite('hero'), 10, 10)
    })
    const b = step(a, () => {
      screen.clear('#000')
      screen.rect(5, 5, 2, 2, '#fff')
      screen.sprite(sprite('hero_idle'), 11.5, 10)
    })
    expect(froms(b)).toEqual([null, null, { x: 10, y: 10 }])
  })

  it('does not move what jumped, nor what is new', () => {
    const a = step([], () => screen.sprite(sprite('hero'), 0, 0))
    const b = step(a, () => {
      screen.sprite(sprite('hero'), JUMP + 1, 0)
      screen.sprite(sprite('bat'), 100, 100)
    })
    expect(froms(b)).toEqual([null, null])
  })
})

describe('runner', () => {
  it('picks the largest whole scale that fits, at least 1', () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement
    const r = new Runner({ width: 384, height: 216 }, canvas, () => {})
    r.fit(3024, 1800)
    expect([r.scale, canvas.width, canvas.height]).toEqual([7, 2688, 1512])
    r.fit(1920, 1080)
    expect([r.scale, canvas.width, canvas.height]).toEqual([5, 1920, 1080])
    r.fit(100, 100)
    expect([r.scale, canvas.width, canvas.height]).toEqual([1, 384, 216])
  })
})

describe('runner pacing', () => {
  /** Runs a game on a simulated display; returns how many updates ran on each frame. */
  function simulate(hz: number, frames: number, jitterMs: number, config: GameConfig = {}, canvas?: HTMLCanvasElement) {
    const g = globalThis as Record<string, unknown>
    g.window ??= { addEventListener() {}, removeEventListener() {} }
    g.requestAnimationFrame = () => 0
    g.cancelAnimationFrame = () => {}
    let updates = 0
    canvas ??= { width: 0, height: 0, getContext: () => ({}) } as unknown as HTMLCanvasElement
    const update = config.update
    const r = new Runner({ ...config, update: () => (updates++, update?.()) }, canvas, (err) => { throw err })
    r.fit(canvas.width * 100, canvas.height * 100)
    r.start()
    const loop = (r as unknown as { loop: (t: number) => void }).loop
    let seed = 1
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
    const start = (r as unknown as { last: number }).last
    const perFrame: number[] = []
    for (let i = 1; i <= frames; i++) {
      const before = updates
      loop(start + (i * 1000) / hz + random() * jitterMs)
      perFrame.push(updates - before)
    }
    r.stop()
    return perFrame
  }

  it('keeps a steady beat at 120 Hz despite jittery frame times', () => {
    const beat = simulate(120, 600, 1).slice(20).join('')
    expect(beat).toMatch(/^(01)+0?$|^(10)+1?$/)
  })

  it('keeps a steady beat at 180 Hz', () => {
    const beat = simulate(180, 900, 1).slice(20).join('')
    expect(beat.replace(/^0*1/, '')).toMatch(/^(001)*0{0,2}$/)
  })

  /** Display pixels the drawn thing moves on each frame, at ×100, at 144 Hz. */
  function stepsAt144(jitterMs: number) {
    let x = 0
    const { canvas, calls } = fakeCanvas(10, 10)
    simulate(144, 300, jitterMs, {
      width: 10,
      height: 10,
      update: () => (x += 1.5),
      draw: () => screen.rect(x, 0, 1, 1, '#fff'),
    }, canvas)
    const xs = calls.map((c) => c[1] as number)
    return xs.slice(30).map((v, i) => v - xs[29 + i])
  }

  it('moves things evenly on every displayed frame at 144 Hz', () => {
    // 1.5 pixels × 60 updates / 144 frames = 62.5 display pixels per frame at ×100.
    // Without interpolation, steps would be 0 or 150.
    expect(new Set(stepsAt144(0))).toEqual(new Set([62, 63]))
    // Jittery timestamps shift each frame a little (no steady beat to lock on at 144 Hz):
    // within ±0.1 game pixel here, under half a display pixel at ×5.
    const jittery = stepsAt144(0.5)
    expect(Math.min(...jittery)).toBeGreaterThan(62.5 - 15)
    expect(Math.max(...jittery)).toBeLessThan(62.5 + 15)
  })

  it('still runs 60 updates per second at other rates', () => {
    const total = simulate(144, 144 * 5, 1).reduce((a, b) => a + b, 0)
    expect(Math.abs(total - 300)).toBeLessThanOrEqual(1)
  })
})

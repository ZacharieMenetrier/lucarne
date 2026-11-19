import { beforeEach, describe, expect, it } from 'vitest'
import { Font, setFonts } from '../runtime/fonts'
import { input } from '../runtime/input'
import { setMaps, type MapData } from '../runtime/maps'
import { Runner } from '../runtime/runner'
import { attachScreen, screen, writtenText } from '../runtime/screen'
import { Sprite, setSprites, sprite } from '../runtime/sprites'
import { time } from '../runtime/time'
import { Dialogue, Menu } from '../runtime/ui'
import { Thing, camera, cameraMapName, drawWorld, modalThing, resetWorld, updateWorld, worldThings } from '../runtime/world'

const data = {
  name: 'hero',
  frameWidth: 8,
  frameHeight: 8,
  durations: [100, 50, 100],
  sheet: {} as CanvasImageSource,
}

// The browser APIs the runtime touches, enough for node.
const g = globalThis as Record<string, unknown>
g.window ??= { addEventListener() {}, removeEventListener() {} }
g.navigator ??= {}
g.requestAnimationFrame = () => 0
g.cancelAnimationFrame = () => {}

/** A 2D context that records fills and images, in display pixels. */
function fakeContext(calls: unknown[][]) {
  return {
    imageSmoothingEnabled: true,
    fillStyle: '',
    globalCompositeOperation: '',
    fillRect: (...a: number[]) => calls.push(['rect', ...a]),
    clearRect() {},
    drawImage: (...a: unknown[]) => calls.push(['image', ...a.slice(1)]),
    save() {},
    restore() {},
    translate: (...a: number[]) => calls.push(['translate', ...a]),
    scale() {},
  }
}

function fakeCanvas(width: number, height: number) {
  const calls: unknown[][] = []
  const ctx = fakeContext(calls)
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement
  return { canvas, ctx, calls }
}

// Fonts tint their sheet on small canvases of their own: those draw nothing here.
g.OffscreenCanvas = class {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return fakeContext([])
  }
}

/** A screen of `w` × `h` game pixels at ×`scale`, recording what is drawn. */
function screenAt(w: number, h: number, scale: number) {
  const fake = fakeCanvas(w * scale, h * scale)
  attachScreen(fake.canvas, w, h)
  return fake.calls
}

beforeEach(() => {
  resetWorld()
  setSprites([data])
  setMaps(16, [], [])
})

describe('sprites', () => {
  it('picks the frame for a time, looping', () => {
    const s = new Sprite(data)
    expect(s.duration).toBe(250)
    expect([0, 99, 100, 149, 150, 249, 250, 350].map((t) => s.frameAt(t))).toEqual([0, 0, 1, 1, 2, 2, 0, 1])
    expect(s.frameAt(-1)).toBe(2)
  })

  it('looks sprites up by name', () => {
    expect(sprite('hero').origin).toEqual({ x: 0, y: 0 })
    expect(() => sprite('cat')).toThrow('there are: hero')
  })
})

describe('screen', () => {
  it('keeps game pixels as the unit and scales to the canvas', () => {
    const calls = screenAt(384, 216, 5)
    expect([screen.width, screen.height]).toEqual([384, 216])
    drawWorld(1, () => {
      screen.clear('#000')
      screen.rect(10, 20, 3, 2, '#fff')
    })
    expect(calls).toEqual([
      ['rect', 0, 0, 1920, 1080],
      ['rect', 50, 100, 15, 10],
    ])
  })

  it('places fractions on display pixels, never resampling the art', () => {
    setSprites([{ ...data, origin: { x: 2, y: 7 } }])
    const calls = screenAt(384, 216, 5)
    const s = sprite('hero')
    // 1.5 game pixels at ×5: 7.5 display pixels, rounded to 8; the 8×8 art becomes 40×40.
    drawWorld(1, () => {
      screen.sprite(s, 11.5, 10, { frame: 0 })
      screen.sprite(s, 11.5, 10, { frame: 0, flipX: true })
    })
    expect(calls).toEqual([
      ['image', 0, 0, 8, 8, 58 - 10, 50 - 35, 40, 40],
      ['translate', 58 - 25 + 40, 50 - 35],
      ['image', 0, 0, 8, 8, 0, 0, 40, 40],
    ])
  })

  it('can only be drawn on while the world draws', () => {
    expect(() => screen.rect(0, 0, 1, 1, '#fff')).toThrow('can only be drawn on in draw()')
  })

  it('stretches the middle row and column of a panel, keeping edges and corners', () => {
    setSprites([{ ...data, name: 'panel', frameWidth: 5, frameHeight: 5, durations: [100] }])
    const calls = screenAt(100, 100, 1)
    drawWorld(1, () => screen.panel(sprite('panel'), 10, 20, 30, 12))
    // Source columns 0-1 | 2 | 3-4 (rows the same) onto 10-11 | 12-37 | 38-39.
    expect(calls.map((c) => c.slice(1))).toEqual([
      [0, 0, 2, 2, 10, 20, 2, 2], [2, 0, 1, 2, 12, 20, 26, 2], [3, 0, 2, 2, 38, 20, 2, 2],
      [0, 2, 2, 1, 10, 22, 2, 8], [2, 2, 1, 1, 12, 22, 26, 8], [3, 2, 2, 1, 38, 22, 2, 8],
      [0, 3, 2, 2, 10, 30, 2, 2], [2, 3, 1, 2, 12, 30, 26, 2], [3, 3, 2, 2, 38, 30, 2, 2],
    ])
  })
})

/** A thing that records its updates and draws a 1×1 rectangle where it is. */
class Dot extends Thing {
  updates = 0
  constructor(
    x: number,
    y: number,
    readonly log: string[] = [],
    readonly name = 'dot',
  ) {
    super(x, y)
  }
  update() {
    this.updates++
    this.log.push(this.name)
  }
  draw() {
    screen.rect(0, 0, 1, 1, this.name)
  }
}

describe('things', () => {
  it('update in the order they were created; one created meanwhile waits for the next update', () => {
    const log: string[] = []
    class Spawner extends Dot {
      update() {
        super.update()
        if (this.updates === 1) new Dot(0, 0, log, 'child')
      }
    }
    new Dot(0, 0, log, 'a')
    new Spawner(0, 0, log, 'spawner')
    new Dot(0, 0, log, 'b')
    updateWorld()
    expect(log).toEqual(['a', 'spawner', 'b'])
    updateWorld()
    expect(log.slice(3)).toEqual(['a', 'spawner', 'b', 'child'])
  })

  it('leave the world at the end of the update that removes them', () => {
    const log: string[] = []
    const a = new Dot(0, 0, log, 'a')
    class Remover extends Dot {
      update() {
        super.update()
        a.remove()
      }
    }
    new Remover(0, 0, log, 'remover')
    updateWorld()
    expect(log).toEqual(['a', 'remover'])
    expect(worldThings().map((t) => (t as Dot).name)).toEqual(['remover'])
    expect(a.removed).toBe(true)
  })

  it('are drawn between their last two positions, around themselves', () => {
    const calls = screenAt(100, 100, 10)
    class Mover extends Dot {
      update() {
        this.move(4, 2)
      }
    }
    new Mover(10, 10)
    updateWorld()
    updateWorld()
    drawWorld(0.5)
    // Halfway between (14, 12) and (18, 14), at ×10.
    expect(calls).toEqual([['rect', 160, 130, 10, 10]])
  })

  it('are drawn where they are when new or placed: no in-between', () => {
    const calls = screenAt(100, 100, 10)
    const dot = new Dot(10, 10)
    drawWorld(0.5)
    updateWorld()
    dot.place(50, 50)
    drawWorld(0.5)
    expect(calls).toEqual([
      ['rect', 100, 100, 10, 10],
      ['rect', 500, 500, 10, 10],
    ])
  })

  it('are drawn from the top of the world down, ties in creation order', () => {
    const calls = screenAt(100, 100, 1)
    new Dot(0, 50, [], 'low')
    new Dot(1, 10, [], 'high')
    new Dot(2, 50, [], 'low too')
    drawWorld(1)
    expect(calls.map((c) => c[1])).toEqual([1, 0, 2])
  })

  it('draw their UI over the world, on the screen itself', () => {
    const calls = screenAt(100, 100, 1)
    class Hud extends Thing {
      drawUI() {
        screen.rect(2, 3, 1, 1, '#fff')
      }
    }
    new Hud(40, 40)
    new Dot(10, 10)
    camera.x = 5
    drawWorld(1)
    expect(calls).toEqual([
      ['rect', 5, 10, 1, 1],
      ['rect', 2, 3, 1, 1],
    ])
  })
})

describe('camera', () => {
  it('keeps the thing it follows still in the middle while the world scrolls', () => {
    const calls = screenAt(100, 60, 5)
    class Walker extends Dot {
      update() {
        this.move(1.3, 0)
      }
    }
    const hero = new Walker(30, 30)
    camera.follow(hero)
    updateWorld()
    for (const alpha of [0, 0.3, 0.7, 1]) {
      drawWorld(alpha, () => screen.rect(0, 0, 1, 1, 'ground'))
    }
    const heroes = calls.filter((_, i) => i % 2 === 1)
    expect(new Set(heroes.map((c) => `${c[1]},${c[2]}`))).toEqual(new Set(['250,150']))
    // The ground moves under it: the camera goes from x = 30 - 50 to 31.3 - 50, at ×5.
    const grounds = calls.filter((_, i) => i % 2 === 0).map((c) => c[1])
    expect(grounds).toEqual([100, 98, 95, 94])
  })

  it('jumps with a thing it follows when the thing is placed', () => {
    const calls = screenAt(100, 60, 1)
    class Teleporter extends Dot {
      update() {
        this.place(500, 500)
      }
    }
    camera.follow(new Teleporter(30, 30))
    updateWorld()
    drawWorld(0.5, () => screen.rect(0, 0, 1, 1, 'ground'))
    expect(calls[0].slice(1, 3)).toEqual([-450, -470])
  })
})

describe('maps', () => {
  const sheet = { name: 'sheet' } as unknown as CanvasImageSource
  /** A map of w × h cells at cell (x, y), every cell the tile at (1, 2) of "ground". */
  const map = (name: string, x: number, y: number, w: number, h: number): MapData => ({
    name, x, y, width: w, height: h,
    cells: new Array(w * h).fill(null).map(() => ({ tileset: 'ground', col: 1, row: 2 })),
  })

  it('draws only the tiles on screen, under the things, on whole display pixels', () => {
    const calls = screenAt(32, 32, 2)
    setMaps(16, [{ name: 'ground', sheet }], [map('a', 0, 0, 10, 10)])
    new Dot(0, 0)
    camera.x = 8
    camera.y = 0
    drawWorld(1)
    const tiles = calls.filter((c) => c[0] === 'image')
    // Columns 0 to 2 (x 0 to 48, partly seen), rows 0 to 2.
    expect(tiles.length).toBe(9)
    expect(tiles[0].slice(1)).toEqual([16, 32, 16, 16, -16, 0, 32, 32])
    // The thing is drawn after the tiles.
    expect(calls.findIndex((c) => c[0] !== 'image')).toBe(9)
  })

  it('leaves empty cells and unknown tilesets undrawn', () => {
    const calls = screenAt(32, 32, 1)
    const m = map('a', 0, 0, 2, 2)
    m.cells[0] = null
    m.cells[1] = { tileset: 'gone', col: 0, row: 0 }
    setMaps(16, [{ name: 'ground', sheet }], [m])
    drawWorld(1)
    expect(calls.filter((c) => c[0] === 'image').length).toBe(2)
  })

  it('keep the camera inside the map of the thing it follows', () => {
    screenAt(100, 60, 1)
    setMaps(10, [], [map('a', 0, 0, 30, 20)])
    const hero = new Dot(20, 20)
    camera.follow(hero)
    expect([camera.x, camera.y]).toEqual([0, 0])
    hero.place(295, 195)
    updateWorld()
    expect([camera.x, camera.y]).toEqual([200, 140])
    hero.place(150, 100)
    updateWorld()
    expect([camera.x, camera.y]).toEqual([100, 70])
    expect(cameraMapName()).toBe('a')
  })

  it('snap the camera to the next map, with no in-between', () => {
    const calls = screenAt(100, 60, 1)
    setMaps(10, [], [map('a', 0, 0, 30, 20), map('b', 30, 0, 30, 20)])
    class Walker extends Dot {
      update() {
        this.move(2, 0)
      }
    }
    const hero = new Walker(299, 100)
    camera.follow(hero)
    expect(camera.x).toBe(200)
    updateWorld()
    expect(cameraMapName()).toBe('b')
    expect(camera.x).toBe(300)
    drawWorld(0.5)
    // The hero is drawn halfway (x 300), the camera where it is now, not halfway from the
    // last map: (300 - 300, 100 - 70).
    expect(calls.at(-1)!.slice(1, 3)).toEqual([0, 30])
  })

  it('settle the camera in its map when the game starts, even if it followed before', () => {
    attachScreen(null)
    setMaps(10, [], [map('a', 0, 0, 30, 20)])
    camera.follow(new Dot(20, 20))
    const r = new Runner({}, fakeCanvas(100, 60).canvas, (err) => { throw err }, { width: 100, height: 60 })
    r.start()
    expect([camera.x, camera.y]).toEqual([0, 0])
    r.stop()
  })

  it('let the camera follow freely between maps', () => {
    screenAt(100, 60, 1)
    setMaps(10, [], [map('a', 0, 0, 30, 20)])
    const hero = new Dot(1000, 1000)
    camera.follow(hero)
    expect([camera.x, camera.y]).toEqual([950, 970])
    expect(cameraMapName()).toBe(null)
  })
})

describe('modal things', () => {
  it('stop the world: only the last one updates, and the world clock stops', () => {
    const log: string[] = []
    new Dot(0, 0, log, 'world')
    class Modal extends Dot {
      modal = true
    }
    const first = new Modal(0, 0, log, 'first')
    const second = new Modal(0, 0, log, 'second')
    expect(updateWorld()).toBe(false)
    expect(log).toEqual(['second'])
    second.remove()
    updateWorld()
    first.remove()
    updateWorld()
    expect(log).toEqual(['second', 'first', 'world'])
    expect(modalThing()).toBe(null)
  })

  it('keep the UI clock running while the world clock stops', () => {
    const canvas = fakeCanvas(100, 100).canvas
    const r = new Runner({}, canvas, (err) => { throw err }, { width: 100, height: 100 })
    r.start()
    class Modal extends Thing {
      modal = true
    }
    r.step(6)
    const m = new Modal()
    r.step(6)
    m.remove()
    r.step(6)
    expect([time.ms, time.uiMs]).toEqual([200, 300])
    r.stop()
  })
})

describe('runner', () => {
  it('picks the largest whole scale that fits, at least 1', () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement
    const r = new Runner({}, canvas, () => {}, { width: 384, height: 216 })
    r.fit(3024, 1800)
    expect([r.scale, canvas.width, canvas.height]).toEqual([7, 2688, 1512])
    r.fit(1920, 1080)
    expect([r.scale, canvas.width, canvas.height]).toEqual([5, 1920, 1080])
    r.fit(100, 100)
    expect([r.scale, canvas.width, canvas.height]).toEqual([1, 384, 216])
  })

  it('steps a given number of updates with buttons held, the same way every time', () => {
    const run = () => {
      resetWorld()
      class Walker extends Thing {
        update() {
          this.move(input.x * 1.25, input.y)
        }
      }
      const w = new Walker(10, 10)
      const r = new Runner({}, fakeCanvas(100, 100).canvas, (err) => { throw err }, { width: 100, height: 100 })
      r.start()
      r.step(60, ['right'])
      r.step(10, ['down', 'left'])
      expect(r.paused).toBe(true)
      r.stop()
      return [w.x, w.y]
    }
    expect(run()).toEqual([10 + 75 - 12.5, 20])
    expect(run()).toEqual(run())
  })
})

describe('runner pacing', () => {
  /** Runs a game on a simulated display; returns how many updates ran on each frame. */
  function simulate(hz: number, frames: number, jitterMs: number, size?: { width: number; height: number }, canvas?: HTMLCanvasElement) {
    let updates = 0
    class Counter extends Thing {
      update() {
        updates++
      }
    }
    new Counter()
    canvas ??= fakeCanvas(10, 10).canvas
    const r = new Runner({}, canvas, (err) => { throw err }, size)
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

  it('does not take a 58.5 Hz display for a 60 Hz one', () => {
    // Counted as 60 Hz, it would run 60 updates per second of 58.5 frames: 2.5% fast.
    const total = simulate(58.5, 585, 0.2).reduce((a, b) => a + b, 0)
    expect(Math.abs(total - 600)).toBeLessThanOrEqual(1)
  })

  /** Display pixels a moving thing goes on each frame, at ×100. */
  function steps(hz: number, jitterMs: number) {
    resetWorld()
    const fake = fakeCanvas(10, 10)
    class Mover extends Thing {
      update() {
        this.move(1.5, 0)
      }
      draw() {
        screen.rect(0, 0, 1, 1, '#fff')
      }
    }
    new Mover()
    simulate(hz, 300, jitterMs, { width: 10, height: 10 }, fake.canvas)
    const xs = fake.calls.map((c) => c[1] as number)
    return { xs, steps: xs.slice(30).map((v, i) => v - xs[29 + i]) }
  }

  it('moves things evenly on every displayed frame at 144 Hz', () => {
    // 1.5 pixels × 60 updates / 144 frames = 62.5 display pixels per frame at ×100.
    // Without interpolation, steps would be 0 or 150.
    expect(new Set(steps(144, 0).steps)).toEqual(new Set([62, 63]))
    // Jittery timestamps shift each frame a little (no steady beat to lock on at 144 Hz):
    // within ±0.1 game pixel here, under half a display pixel at ×5.
    const jittery = steps(144, 0.5).steps
    expect(Math.min(...jittery)).toBeGreaterThan(62.5 - 15)
    expect(Math.max(...jittery)).toBeLessThan(62.5 + 15)
  })

  it('shows the last update as it is on a 60 Hz display, without a frame of delay', () => {
    resetWorld()
    let x = 0
    class Mover extends Thing {
      update() {
        this.move(1.5, 0)
        x = this.x
      }
      draw() {
        screen.rect(0, 0, 1, 1, '#fff')
      }
    }
    new Mover()
    const fake = fakeCanvas(10, 10)
    simulate(60, 120, 0.5, { width: 10, height: 10 }, fake.canvas)
    const last = fake.calls[fake.calls.length - 1][1] as number
    expect(last).toBe(Math.round(x * 100))
  })

  it('still runs 60 updates per second at other rates', () => {
    const total = simulate(144, 144 * 5, 1).reduce((a, b) => a + b, 0)
    expect(Math.abs(total - 300)).toBeLessThanOrEqual(1)
  })
})

/** A font of 4 × 6 cells: the next character starts 3 pixels after a space, 4 after "a", 5 after "b". */
function testFont() {
  setFonts([{
    name: 'test',
    cellWidth: 4,
    cellHeight: 6,
    columns: 2,
    characters: ' ab?',
    advances: [3, 4, 5, 4],
    sheet: {} as CanvasImageSource,
  }])
}

describe('text', () => {
  beforeEach(testFont)

  it('measures and wraps between words', () => {
    const f = new Font({ name: 't', cellWidth: 4, cellHeight: 6, columns: 2, characters: ' ab?', advances: [3, 4, 5, 4], sheet: {} as CanvasImageSource })
    expect(f.lineWidth('ab')).toBe(4 + 5)
    expect(f.lines('ab ab ab', 21)).toEqual(['ab ab', 'ab'])
    expect(f.lines('a\nb')).toEqual(['a', 'b'])
    expect(f.measure('ab ab ab', 21)).toEqual({ width: 21, height: 12 })
  })

  it('stamps each character on whole pixels, from its cell', () => {
    const calls = screenAt(100, 100, 2)
    drawWorld(1, () => screen.text('ab a\nzb', 10, 20, '#fff'))
    // Cells: " " 0, "a" 1, "b" 2, "?" 3 (2 per row). An unknown character draws "?".
    // "a" at 10, "b" at 10 + 4, a space (not drawn) at 19, "a" at 19 + 3, at ×2.
    expect(calls.map((c) => c.slice(1))).toEqual([
      [4, 0, 4, 6, 20, 40, 8, 12],
      [0, 6, 4, 6, 28, 40, 8, 12],
      [4, 0, 4, 6, 44, 40, 8, 12],
      [4, 6, 4, 6, 20, 52, 8, 12],
      [0, 6, 4, 6, 28, 52, 8, 12],
    ])
    expect(writtenText().map((t) => t.text)).toEqual(['ab a\nzb'])
  })

  it('needs a font in the game folder', () => {
    setFonts([])
    screenAt(10, 10, 1)
    expect(() => drawWorld(1, () => screen.text('a', 0, 0, '#fff'))).toThrow('No font in fonts/')
  })
})

describe('dialogue and menu', () => {
  beforeEach(testFont)

  function play() {
    const r = new Runner({}, fakeCanvas(200, 100).canvas, (err) => { throw err }, { width: 200, height: 100 })
    r.start()
    return r
  }

  it('shows a dialogue letter by letter, page by page, then closes', () => {
    const r = play()
    const d = new Dialogue(['ab ab', 'b ab ab'])
    r.step(4) // half a letter per update
    expect(writtenText().map((t) => t.text)).toEqual(['ab'])
    r.step(1, ['action']) // the whole page at once
    expect(d.done).toBe(true)
    expect(writtenText().map((t) => t.text)).toEqual(['ab ab'])
    r.step(1)
    r.step(1, ['action']) // next page
    r.step(1)
    r.step(1, ['action']) // shown at once
    r.step(1)
    r.step(1, ['action']) // closes
    expect(d.removed).toBe(true)
    r.stop()
  })

  it('moves a menu cursor and calls back with the choice', () => {
    const r = play()
    let chosen = -1
    new Menu(['a', 'b', 'ab'], (i) => (chosen = i))
    r.step(1, ['up']) // wraps to the last
    r.step(1)
    r.step(1, ['down'])
    r.step(1)
    r.step(1, ['down'])
    r.step(1, ['action'])
    expect(chosen).toBe(1)
    expect(modalThing()).toBe(null)
    r.stop()
  })
})

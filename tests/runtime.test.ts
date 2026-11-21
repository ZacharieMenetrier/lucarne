import { beforeEach, describe, expect, it } from 'vitest'
import { Font, setFonts } from '../runtime/fonts'
import { parseSettings, screenSize, serializeSettings, settingsError } from '../runtime/game'
import { input } from '../runtime/input'
import { map as mapRect, mapAt, setMaps, type MapData } from '../runtime/maps'
import { Runner } from '../runtime/runner'
import { attachScreen, screen, writtenText } from '../runtime/screen'
import { Sprite, setSprites, sprite } from '../runtime/sprites'
import { time } from '../runtime/time'
import { Dialogue, Menu } from '../runtime/ui'
import type { Box } from '../runtime/collision'
import { Actor, actorClasses, actorParents, actorValues, actorVariables, camera, cameraMapName, drawWorld, modalActor, placeActors, probe, registerActors, resetWorld, setActorFiles, spawn, updateWorld, worldActors } from '../runtime/world'

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
  setActorFiles({})
})

describe('settings', () => {
  it('count the screen in tiles: 20 × 11 of 16 pixels unless set', () => {
    const s = parseSettings(null)
    expect(s).toEqual({ columns: 20, rows: 11, tileSize: 16 })
    expect(screenSize(s)).toEqual({ width: 320, height: 176 })
    expect(parseSettings(serializeSettings({ columns: 24, rows: 13, tileSize: 8 }))).toEqual({ columns: 24, rows: 13, tileSize: 8 })
  })

  it('read an older game.json in pixels as the whole tiles that fit', () => {
    expect(parseSettings('{ "width": 384, "height": 216, "tileSize": 16 }')).toEqual({ columns: 24, rows: 13, tileSize: 16 })
    expect(parseSettings('{ "width": 8, "height": 400 }')).toEqual({ columns: 1, rows: 25, tileSize: 16 })
  })

  it('keep wrong values to their default, and the screen within 4096 pixels', () => {
    expect(parseSettings('{ "columns": 2.5, "rows": "9", "tileSize": 3 }')).toEqual({ columns: 20, rows: 11, tileSize: 16 })
    expect(parseSettings('{ "columns": 256, "rows": 256, "tileSize": 64 }')).toEqual({ columns: 64, rows: 64, tileSize: 64 })
    expect(settingsError({ columns: 20, rows: 11, tileSize: 16 })).toBe(null)
    expect(settingsError({ columns: 0, rows: 11, tileSize: 16 })).toMatch(/^Columns/)
    expect(settingsError({ columns: 100, rows: 11, tileSize: 64 })).toMatch(/6400 × 704/)
  })
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

/** An actor that records its updates and draws a 1×1 rectangle where it is. */
class Dot extends Actor {
  updates = 0
  log: string[] = []
  name = 'dot'

  update() {
    this.updates++
    this.log.push(this.name)
  }
  draw() {
    screen.rect(0, 0, 1, 1, this.name)
  }
}

describe('actors', () => {
  it('update in the order they were created; one created meanwhile waits for the next update', () => {
    const log: string[] = []
    class Spawner extends Dot {
      update() {
        super.update()
        if (this.updates === 1) spawn(Dot, { x: 0, y: 0, log, name: 'child' })
      }
    }
    spawn(Dot, { x: 0, y: 0, log, name: 'a' })
    spawn(Spawner, { x: 0, y: 0, log, name: 'spawner' })
    spawn(Dot, { x: 0, y: 0, log, name: 'b' })
    updateWorld()
    expect(log).toEqual(['a', 'spawner', 'b'])
    updateWorld()
    expect(log.slice(3)).toEqual(['a', 'spawner', 'b', 'child'])
  })

  it('leave the world at the end of the update that removes them', () => {
    const log: string[] = []
    const a = spawn(Dot, { x: 0, y: 0, log, name: 'a' })
    class Remover extends Dot {
      update() {
        super.update()
        a.remove()
      }
    }
    spawn(Remover, { x: 0, y: 0, log, name: 'remover' })
    updateWorld()
    expect(log).toEqual(['a', 'remover'])
    expect(worldActors().map((t) => (t as Dot).name)).toEqual(['remover'])
    expect(a.removed).toBe(true)
  })

  it('are drawn between their last two positions, around themselves', () => {
    const calls = screenAt(100, 100, 10)
    class Mover extends Dot {
      update() {
        this.move(4, 2)
      }
    }
    spawn(Mover, { x: 10, y: 10 })
    updateWorld()
    updateWorld()
    drawWorld(0.5)
    // Halfway between (14, 12) and (18, 14), at ×10.
    expect(calls).toEqual([['rect', 160, 130, 10, 10]])
  })

  it('are drawn where they are when new or placed: no in-between', () => {
    const calls = screenAt(100, 100, 10)
    const dot = spawn(Dot, { x: 10, y: 10 })
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
    spawn(Dot, { x: 0, y: 50, log: [], name: 'low' })
    spawn(Dot, { x: 1, y: 10, log: [], name: 'high' })
    spawn(Dot, { x: 2, y: 50, log: [], name: 'low too' })
    drawWorld(1)
    expect(calls.map((c) => c[1])).toEqual([1, 0, 2])
  })

  it('draw their UI over the world, on the screen itself', () => {
    const calls = screenAt(100, 100, 1)
    class Hud extends Actor {
      drawUI() {
        screen.rect(2, 3, 1, 1, '#fff')
      }
    }
    spawn(Hud, { x: 40, y: 40 })
    spawn(Dot, { x: 10, y: 10 })
    camera.x = 5
    drawWorld(1)
    expect(calls).toEqual([
      ['rect', 5, 10, 1, 1],
      ['rect', 2, 3, 1, 1],
    ])
  })
})

describe('camera', () => {
  it('keeps the actor it follows still in the middle while the world scrolls', () => {
    const calls = screenAt(100, 60, 5)
    class Walker extends Dot {
      update() {
        this.move(1.3, 0)
      }
    }
    const hero = spawn(Walker, { x: 30, y: 30 })
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

  it('jumps with an actor it follows when the actor is placed', () => {
    const calls = screenAt(100, 60, 1)
    class Teleporter extends Dot {
      update() {
        this.place(500, 500)
      }
    }
    camera.follow(spawn(Teleporter, { x: 30, y: 30 }))
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
    actors: [],
  })

  it('draws only the tiles on screen, under the actors, on whole display pixels', () => {
    const calls = screenAt(32, 32, 2)
    setMaps(16, [{ name: 'ground', sheet }], [map('a', 0, 0, 10, 10)])
    spawn(Dot, { x: 0, y: 0 })
    camera.x = 8
    camera.y = 0
    drawWorld(1)
    const tiles = calls.filter((c) => c[0] === 'image')
    // Columns 0 to 2 (x 0 to 48, partly seen), rows 0 to 2.
    expect(tiles.length).toBe(9)
    expect(tiles[0].slice(1)).toEqual([16, 32, 16, 16, -16, 0, 32, 32])
    // The actor is drawn after the tiles.
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

  it('keep the camera inside the map of the actor it follows', () => {
    screenAt(100, 60, 1)
    setMaps(10, [], [map('a', 0, 0, 30, 20)])
    const hero = spawn(Dot, { x: 20, y: 20 })
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
    const hero = spawn(Walker, { x: 299, y: 100 })
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
    camera.follow(spawn(Dot, { x: 20, y: 20 }))
    const r = new Runner({}, fakeCanvas(100, 60).canvas, (err) => { throw err }, { width: 100, height: 60 })
    r.start()
    expect([camera.x, camera.y]).toEqual([0, 0])
    r.stop()
  })

  it('tell the game where a map is, in game pixels', () => {
    setMaps(16, [], [map('a', -5, -5, 20, 12), map('b', 15, -5, 20, 12)])
    expect(mapRect('a')).toEqual({ name: 'a', x: -80, y: -80, width: 320, height: 192 })
    expect(mapAt(250, 0)?.name).toBe('b')
    expect(mapAt(-81, 0)).toBe(null)
    expect(() => mapRect('nowhere')).toThrow('No map named "nowhere"')
  })

  it('let the camera follow freely between maps', () => {
    screenAt(100, 60, 1)
    setMaps(10, [], [map('a', 0, 0, 30, 20)])
    const hero = spawn(Dot, { x: 1000, y: 1000 })
    camera.follow(hero)
    expect([camera.x, camera.y]).toEqual([950, 970])
    expect(cameraMapName()).toBe(null)
  })
})

describe('modal actors', () => {
  it('stop the world: only the last one updates, and the world clock stops', () => {
    const log: string[] = []
    spawn(Dot, { x: 0, y: 0, log, name: 'world' })
    class Modal extends Dot {
      modal = true
    }
    const first = spawn(Modal, { x: 0, y: 0, log, name: 'first' })
    const second = spawn(Modal, { x: 0, y: 0, log, name: 'second' })
    expect(updateWorld()).toBe(false)
    expect(log).toEqual(['second'])
    second.remove()
    updateWorld()
    first.remove()
    updateWorld()
    expect(log).toEqual(['second', 'first', 'world'])
    expect(modalActor()).toBe(null)
  })

  it('keep the UI clock running while the world clock stops', () => {
    const canvas = fakeCanvas(100, 100).canvas
    const r = new Runner({}, canvas, (err) => { throw err }, { width: 100, height: 100 })
    r.start()
    class Modal extends Actor {
      modal = true
    }
    r.step(6)
    const m = spawn(Modal)
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
      class Walker extends Actor {
        update() {
          this.move(input.x * 1.25, input.y)
        }
      }
      const w = spawn(Walker, { x: 10, y: 10 })
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
    class Counter extends Actor {
      update() {
        updates++
      }
    }
    spawn(Counter)
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

  /** Display pixels a moving actor goes on each frame, at ×100. */
  function steps(hz: number, jitterMs: number) {
    resetWorld()
    const fake = fakeCanvas(10, 10)
    class Mover extends Actor {
      update() {
        this.move(1.5, 0)
      }
      draw() {
        screen.rect(0, 0, 1, 1, '#fff')
      }
    }
    spawn(Mover)
    simulate(hz, 300, jitterMs, { width: 10, height: 10 }, fake.canvas)
    const xs = fake.calls.map((c) => c[1] as number)
    return { xs, steps: xs.slice(30).map((v, i) => v - xs[29 + i]) }
  }

  it('moves actors evenly on every displayed frame at 144 Hz', () => {
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
    class Mover extends Actor {
      update() {
        this.move(1.5, 0)
        x = this.x
      }
      draw() {
        screen.rect(0, 0, 1, 1, '#fff')
      }
    }
    spawn(Mover)
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
    const d = spawn(Dialogue, { pages: ['ab ab', 'b ab ab'] })
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
    spawn(Menu, { items: ['a', 'b', 'ab'], onChoose: (i) => (chosen = i) })
    r.step(1, ['up']) // wraps to the last
    r.step(1)
    r.step(1, ['down'])
    r.step(1)
    r.step(1, ['down'])
    r.step(1, ['action'])
    expect(chosen).toBe(1)
    expect(modalActor()).toBe(null)
    r.stop()
  })
})

describe('walls', () => {
  const sheet = {} as CanvasImageSource
  /** '#' a solid tile, 'v' a tile solid on its bottom half, '.' a tile that is not solid. */
  const solid = [
    { column: 0, row: 0, x: 0, y: 0, width: 16, height: 16 },
    { column: 1, row: 0, x: 0, y: 8, width: 16, height: 8 },
  ]
  function walls(rows: string[], x = 0, y = 0, name = 'a'): MapData {
    const cells = rows.join('').split('').map((c) => ({ tileset: 'ground', col: '#v.'.indexOf(c), row: 0 }))
    return { name, x, y, width: rows[0].length, height: rows.length, cells, actors: [] }
  }
  const world = (...maps: MapData[]) => setMaps(16, [{ name: 'ground', sheet, solid }], maps)

  /** A 10 × 6 box: its feet, centered on x, its bottom on y (a box the code gives it). */
  class Walker extends Actor {
    box: Box | null = { x: -5, y: -6, width: 10, height: 6 }
  }

  it('let actors through when the game has no maps, or when the actor has no box', () => {
    const w = spawn(Walker, { x: 8, y: 8 })
    expect(w.move(100, 0)).toBe(true)
    expect(w.x).toBe(108)
    world(walls(['.#.']))
    const ghost = spawn(Actor, { x: 8, y: 8 })
    expect(ghost.move(16, 0)).toBe(true)
    expect(ghost.x).toBe(24)
  })

  it('stop a box against a solid tile, and say so', () => {
    world(walls(['..#.']))
    const w = spawn(Walker, { x: 8, y: 12 })
    expect(w.move(4, 0)).toBe(true)
    expect(w.move(20, 0)).toBe(false)
    expect(w.x).toBe(27)
    // Stopped against it, it stays there, even by fractions.
    for (let i = 0; i < 10; i++) w.move(0.3, 0)
    expect(w.x).toBe(27)
  })

  it('slide along a wall: what is stopped on one axis, the other keeps', () => {
    world(walls(['..#.', '..#.', '....']))
    const w = spawn(Walker, { x: 20, y: 12 })
    expect(w.move(9, 3)).toBe(false)
    expect([w.x, w.y]).toEqual([27, 15])
  })

  it('collide with the solid part of a tile only', () => {
    world(walls(['....', '.v..', '....']))
    // Above the solid half: free.
    const above = spawn(Walker, { x: 4, y: 24 })
    expect(above.move(40, 0)).toBe(true)
    // In line with it: stopped at its left edge.
    const level = spawn(Walker, { x: 4, y: 30 })
    level.move(40, 0)
    expect(level.x).toBe(11)
    // Coming down onto it.
    const falling = spawn(Walker, { x: 24, y: 16 })
    falling.move(0, 20)
    expect(falling.y).toBe(24)
  })

  it('are everything outside the maps, but not between maps that touch', () => {
    world(walls(['....', '....']), walls(['....', '....'], 4, 0, 'b'))
    const w = spawn(Walker, { x: 20, y: 20 })
    w.move(-50, 0)
    expect(w.x).toBe(5)
    w.move(0, 50)
    expect(w.y).toBe(32)
    expect(w.move(100, 0)).toBe(true)
    expect(w.x).toBe(105)
    w.move(100, 0)
    expect(w.x).toBe(123)
  })

  it('stop any speed, however thin the wall', () => {
    const thin = [{ column: 0, row: 0, x: 7, y: 0, width: 2, height: 16 }]
    setMaps(16, [{ name: 'ground', sheet, solid: thin }], [walls(['.......', '...#...', '.......'])])
    const w = spawn(Walker, { x: 8, y: 28 })
    w.move(500, 0)
    expect(w.x).toBe(50)
  })

  it('let an actor placed inside a wall walk out of it', () => {
    world(walls(['....', '.#..', '....']))
    const w = spawn(Walker, { x: 24, y: 28 })
    expect(w.move(20, 0)).toBe(true)
    expect(w.x).toBe(44)
  })

  it('nudge an actor around a corner it only clips, at its own speed', () => {
    // A corridor one tile high, between walls, on the right.
    world(walls(['......', '...###', '......', '...###', '......']))
    // The corridor is y 32 to 48; feet from y 44 to 50 clip the wall below it by 2.
    const w = spawn(Walker, { x: 43, y: 50 })
    expect(w.move(1, 0)).toBe(false)
    expect(w.x).toBe(43)
    expect(w.y).toBe(49)
    w.move(1, 0)
    expect(w.y).toBe(48)
    expect(w.move(1, 0)).toBe(true)
    expect(w.x).toBe(44)
  })

  it('nudge across too, walking up into a doorway', () => {
    // A doorway one tile wide (x 16 to 32) in a wall from y 16 to 32.
    world(walls(['....', '#.##', '....']))
    // Feet from x 28 to 38 clip the wall right of the door by 6: past half of 10.
    const far = spawn(Walker, { x: 33, y: 38 })
    far.move(0, -10)
    expect([far.x, far.y]).toEqual([33, 38])
    // From x 25 to 35, by 3: nudged left as it walks.
    const w = spawn(Walker, { x: 30, y: 38 })
    expect(w.move(0, -2)).toBe(false)
    expect([w.x, w.y]).toEqual([28, 38])
    w.move(0, -2)
    expect([w.x, w.y]).toEqual([27, 38])
    expect(w.move(0, -2)).toBe(true)
    expect(w.y).toBe(36)
  })

  it('stop dead against a corner the actor is mostly in line with', () => {
    world(walls(['......', '...###', '......', '...###', '......']))
    // Feet from y 47 to 53 are 5 pixels into the wall below: past half of 6.
    const w = spawn(Walker, { x: 43, y: 53 })
    expect(w.move(10, 0)).toBe(false)
    expect([w.x, w.y]).toEqual([43, 53])
  })
})

describe('boxes', () => {
  class Hero extends Actor {
    box: Box | null = { x: -4, y: -4, width: 8, height: 4 }
  }
  class Rock extends Actor {
    box: Box | null = { x: -8, y: -8, width: 16, height: 8 }
  }
  class Coin extends Actor {}

  it('are offset from the feet as drawn', () => {
    setMaps(16, [], [{ name: 'a', x: 0, y: 0, width: 4, height: 4, cells: new Array(16).fill(null), actors: [] }])
    // The box from x - 4 to x + 4: stopped 4 pixels before the right edge of the map.
    const h = spawn(Hero, { x: 32, y: 32 })
    expect(h.move(100, 0)).toBe(false)
    expect(h.x).toBe(60)
  })

  it('stop actors against each other, and slide along them', () => {
    // The rock from x 92 to 108, y 92 to 100.
    spawn(Rock, { x: 100, y: 100 })
    const h = spawn(Hero, { x: 80, y: 99 })
    expect(h.move(20, 0)).toBe(false)
    expect(h.x).toBe(88)
    // Diagonally: x stops, y goes on.
    expect(h.move(5, 3)).toBe(false)
    expect([h.x, h.y]).toEqual([88, 102])
  })

  it('let actors without a box through, and through them', () => {
    const coin = spawn(Coin, { x: 90, y: 99 })
    const h = spawn(Hero, { x: 80, y: 99 })
    expect(h.move(20, 0)).toBe(true)
    expect(coin.move(30, 0)).toBe(true)
  })

  it('ignore removed actors, and let overlapping actors part', () => {
    const rock = spawn(Rock, { x: 100, y: 100 })
    const h = spawn(Hero, { x: 100, y: 100 })
    expect(h.move(0, 20)).toBe(true)
    rock.remove()
    const h2 = spawn(Hero, { x: 80, y: 100 })
    expect(h2.move(40, 0)).toBe(true)
  })

  it('belong to each actor: changing one changes no other', () => {
    const a = spawn(Hero)
    const b = spawn(Hero)
    a.box!.height = 2
    expect(b.box!.height).toBe(4)
  })
})

describe('spawn', () => {
  it('is the only way to create an actor', () => {
    class Hero extends Actor {}
    expect(() => new Hero()).toThrow('Actors are created with spawn(Hero, { x, y }), not with new.')
  })

  it('sets the values, then calls create(), which sees them', () => {
    const seen: number[] = []
    class Hero extends Actor {
      speed = 1
      create() {
        seen.push(this.speed, this.x)
      }
    }
    const h = spawn(Hero, { x: 5, speed: 3 })
    expect(seen).toEqual([3, 5])
    expect([h.x, h.y]).toEqual([5, 0])
  })
})

describe('actor files', () => {
  class Villager extends Actor {
    speed = 1
    lines = ['Hello!']
    shy = false
    /** Not variables: not of a simple kind, or an empty list (of what?). */
    home = { x: 0, y: 0 }
    friends: Actor[] = []
  }
  class Guard extends Villager {}
  class Helper extends Guard {}

  /** The game's actor files: their values, then their classes, as game.js registers them. */
  function files(values: Record<string, Record<string, unknown>>) {
    setActorFiles(values)
    registerActors({ villager: Villager, guard: Guard })
  }

  it('declare variables in the code: fields of a simple kind, the box first', () => {
    files({})
    expect(actorVariables(Villager)).toEqual([
      { name: 'box', kind: 'box', value: null },
      { name: 'speed', kind: 'number', value: 1 },
      { name: 'lines', kind: 'lines', value: ['Hello!'] },
      { name: 'shy', kind: 'switch', value: false },
    ])
  })

  it("set values over the code's, a parent's file first, the nearest last", () => {
    const box = { x: -4, y: -4, width: 8, height: 4 }
    files({ villager: { box, speed: 0.5, lines: ['Hi.'] }, guard: { lines: ['Halt!'] } })
    const v = spawn(Villager)
    expect([v.box, v.speed, v.lines]).toEqual([box, 0.5, ['Hi.']])
    const g = spawn(Guard, { speed: 2 })
    expect([g.box, g.speed, g.lines]).toEqual([box, 2, ['Halt!']])
    // A class with no file of its own (made in code/) takes its parents' files.
    expect(spawn(Helper).lines).toEqual(['Halt!'])
    expect(actorParents(Helper)).toEqual(['guard', 'villager'])
    expect(actorValues(Guard)).toEqual({ box, speed: 0.5, lines: ['Halt!'] })
    // A list set in a file is each actor's own.
    v.lines.push('More.')
    expect(spawn(Villager).lines).toEqual(['Hi.'])
  })

  it('name the file and the variable when a value does not fit the code', () => {
    files({ villager: { sped: 2 } })
    expect(() => spawn(Villager)).toThrow('actors/villager.json sets "sped", but the villager has no variable named so (its variables: box, speed, lines, shy). Declare it in actors/villager.ts')
    files({ villager: { speed: 'fast' } })
    expect(() => spawn(Guard)).toThrow('actors/villager.json: "speed" of the villager must be a number, not "fast".')
    files({ villager: { lines: [] } })
    expect(spawn(Villager).lines).toEqual([])
    files({ villager: { box: { x: 0, y: 0, width: 0, height: 4 } } })
    expect(() => spawn(Villager)).toThrow('"box" of the villager must be a box')
  })

  it('are checked when the game starts, even for an actor nothing places', () => {
    files({ guard: { shy: 'yes' } })
    expect(() => placeActors()).toThrow('actors/guard.json: "shy" of the guard must be true or false')
    files({ ghost: {} })
    expect(() => placeActors()).toThrow('actors/ghost.json has no actors/ghost.ts')
  })

  it('register only classes of actors', () => {
    setActorFiles({})
    expect(() => registerActors({ helper: () => 1 })).toThrow('actors/helper.ts must end with `export default class … extends Actor`')
    registerActors({ villager: Villager })
    expect([...actorClasses().keys()]).toEqual(['villager'])
  })

  it('let the editor create an actor outside the world, to draw it', () => {
    files({})
    const v = probe(Villager, { speed: 4 })
    expect(v.speed).toBe(4)
    expect(worldActors()).toEqual([])
  })
})

describe('placed actors', () => {
  class Villager extends Actor {
    lines = ['Hello!']
  }
  class Chest extends Actor {}
  const empty = (name: string, x: number, y: number, actors: MapData['actors']): MapData => ({
    name, x, y, width: 2, height: 2, cells: new Array(4).fill(null), actors,
  })
  beforeEach(() => registerActors({ villager: Villager, chest: Chest }))

  it('are created at their place in the world, map by map, after the actors already there', () => {
    const hero = spawn(Actor, { x: 1, y: 1 })
    setMaps(16, [], [
      empty('town', 10, 0, [{ actor: 'chest', x: 8, y: 16, values: {} }]),
      empty('house', 0, 2, [{ actor: 'villager', x: 4, y: 12, values: { lines: ['Hi.'] } }, { actor: 'chest', x: 0, y: 32, values: {} }]),
    ])
    placeActors()
    expect(worldActors().map((t) => [t.constructor.name, t.x, t.y])).toEqual([
      ['Actor', 1, 1],
      ['Villager', 4, 44],
      ['Chest', 0, 64],
      ['Chest', 168, 16],
    ])
    expect(worldActors()[0]).toBe(hero)
    expect((worldActors()[1] as Villager).lines).toEqual(['Hi.'])
  })

  it('say which map places an actor the game does not have, or sets what it does not declare', () => {
    setMaps(16, [], [empty('town', 0, 0, [{ actor: 'ghost', x: 8, y: 16, values: {} }])])
    expect(() => placeActors()).toThrow('maps/town.json places a ghost, but there is no actors/ghost.ts (the actors: villager, chest).')
    setMaps(16, [], [empty('town', 0, 0, [{ actor: 'chest', x: 8, y: 16, values: { gold: 3 } }])])
    expect(() => placeActors()).toThrow('maps/town.json sets "gold", but the chest has no variable named so')
  })
})

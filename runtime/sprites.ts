// The game's sprites (sprites/*.png + .json), by name.
//
//   const hero = sprite('hero')
//   screen.sprite(hero, x, y)        // its origin pixel lands on (x, y)
//
// The editor loads every sprite before the game's code runs, so `sprite()` works
// anywhere, even at the top of a file.

/** A sprite as the editor hands it to the engine. */
export interface SpriteData {
  name: string
  frameWidth: number
  frameHeight: number
  /** One name per sheet row. */
  directions: string[]
  /** One duration per sheet column, in milliseconds. */
  durations: number[]
  origin?: { x: number; y: number }
  /** The sheet: one row per direction, one column per frame. */
  sheet: CanvasImageSource
}

export class Sprite {
  readonly name: string
  /** Size of one frame, in pixels. */
  readonly width: number
  readonly height: number
  /** The pixel placed on the position given to `screen.sprite` (top left if not set). */
  readonly origin: { readonly x: number; readonly y: number }
  /** Names of the drawn directions (one row of the sheet each). */
  readonly directions: readonly string[]
  /** Duration of each frame, in milliseconds. */
  readonly durations: readonly number[]
  /** Duration of the whole animation, in milliseconds. */
  readonly duration: number
  /** @internal */
  readonly sheet: CanvasImageSource

  constructor(data: SpriteData) {
    this.name = data.name
    this.width = data.frameWidth
    this.height = data.frameHeight
    this.origin = data.origin ?? { x: 0, y: 0 }
    this.directions = data.directions
    this.durations = data.durations
    this.duration = data.durations.reduce((a, b) => a + b, 0)
    this.sheet = data.sheet
  }

  /** Number of animation frames. */
  get frames() {
    return this.durations.length
  }

  /** The frame shown `ms` milliseconds into the animation, looping. */
  frameAt(ms: number) {
    if (this.duration <= 0) return 0
    let t = ((ms % this.duration) + this.duration) % this.duration
    for (let i = 0; i < this.durations.length; i++) {
      t -= this.durations[i]
      if (t < 0) return i
    }
    return this.durations.length - 1
  }

  /** Sheet row of a direction, by name or index. */
  row(direction: string | number) {
    const row = typeof direction === 'number' ? direction : this.directions.indexOf(direction)
    if (!Number.isInteger(row) || row < 0 || row >= this.directions.length) {
      throw new Error(
        `The sprite "${this.name}" has no direction ${JSON.stringify(direction)} ` +
          `(it has: ${this.directions.join(', ')}).`,
      )
    }
    return row
  }
}

let loaded = new Map<string, Sprite>()

/** The sprite named `name` (sprites/<name>.png). */
export function sprite(name: string): Sprite {
  const s = loaded.get(name)
  if (!s) {
    const names = [...loaded.keys()].join(', ') || 'none'
    throw new Error(`No sprite named "${name}" in sprites/ (there are: ${names}).`)
  }
  return s
}

/** Called by the editor before the game's code runs. */
export function setSprites(list: SpriteData[]) {
  loaded = new Map(list.map((d) => [d.name, new Sprite(d)]))
}

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
  /** One duration per sheet column, in milliseconds. */
  durations: number[]
  origin?: { x: number; y: number }
  /** The sheet: one frame after the other, left to right. */
  sheet: CanvasImageSource
}

export class Sprite {
  readonly name: string
  /** Size of one frame, in pixels. */
  readonly width: number
  readonly height: number
  /** The pixel placed on the position given to `screen.sprite` (top left if not set). */
  readonly origin: { readonly x: number; readonly y: number }
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

/** The sprite named `name`, or null if the game has none. */
export function findSprite(name: string): Sprite | null {
  return loaded.get(name) ?? null
}

/** Called by the editor before the game's code runs. */
export function setSprites(list: SpriteData[]) {
  loaded = new Map(list.map((d) => [d.name, new Sprite(d)]))
}

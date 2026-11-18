// Runs a game: a fixed-step loop (60 updates per second) and a draw per displayed frame.
// Used by the editor, not by games. Only one game runs at a time.

import { DEFAULT_HEIGHT, DEFAULT_WIDTH, TICK_RATE, type GameConfig } from './game'
import { listenInput, sampleInput } from './input'
import { attachScreen } from './screen'
import { resetTime, tickTime } from './time'

const STEP = 1000 / TICK_RATE
/** After a long stall (hidden tab, breakpoint), catch up at most this many updates. */
const MAX_CATCH_UP = 5

export class Runner {
  readonly width: number
  readonly height: number
  private frame = 0
  private last = 0
  private lag = 0
  private _paused = false
  private stopped = false

  constructor(
    private readonly config: GameConfig,
    readonly canvas: HTMLCanvasElement,
    /** Called when the game's code throws; the game is stopped. */
    private readonly onError: (err: unknown) => void,
  ) {
    this.width = positiveInt(config.width, DEFAULT_WIDTH, 'width')
    this.height = positiveInt(config.height, DEFAULT_HEIGHT, 'height')
    canvas.width = this.width
    canvas.height = this.height
  }

  get paused() {
    return this._paused
  }

  start() {
    attachScreen(this.canvas)
    listenInput(true)
    resetTime()
    if (!this.guard(() => this.config.start?.())) return
    // A first frame right away, so the screen is never blank (even if paused at once).
    if (!this.guard(() => this.config.draw?.())) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.loop)
  }

  pause() {
    if (this.stopped || this._paused) return
    this._paused = true
    cancelAnimationFrame(this.frame)
    listenInput(false)
  }

  resume() {
    if (this.stopped || !this._paused) return
    this._paused = false
    listenInput(true)
    this.last = performance.now()
    this.lag = 0
    this.frame = requestAnimationFrame(this.loop)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    cancelAnimationFrame(this.frame)
    listenInput(false)
    attachScreen(null)
  }

  private loop = (time: number) => {
    this.lag = Math.min(this.lag + (time - this.last), STEP * MAX_CATCH_UP)
    this.last = time
    while (this.lag >= STEP) {
      this.lag -= STEP
      sampleInput()
      if (!this.guard(() => this.config.update?.())) return
      tickTime()
    }
    if (!this.guard(() => this.config.draw?.())) return
    this.frame = requestAnimationFrame(this.loop)
  }

  /** Runs a piece of the game's code; on error, stops the game and reports it. */
  private guard(fn: () => void) {
    try {
      fn()
      return true
    } catch (err) {
      this.stop()
      this.onError(err)
      return false
    }
  }
}

function positiveInt(value: unknown, fallback: number, name: string) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4096) {
    throw new Error(`The game's ${name} must be a whole number of pixels, between 1 and 4096.`)
  }
  return value
}

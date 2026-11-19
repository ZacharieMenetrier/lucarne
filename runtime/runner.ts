// Runs a game: a fixed-step loop (60 updates per second, each followed by the game's
// draw, recorded) and, on each displayed frame, the latest recording, with what moved drawn
// between its last two positions. Used by the editor, not by games. Only one game runs at
// a time.
//
// The game shows the same world everywhere: its width × height in game pixels. The
// runner scales it up by the largest whole number that fits the space it is given (see
// `fit`), and the canvas gets the display's own pixels. What is left around is the
// editor's black bars.

import { DEFAULT_HEIGHT, DEFAULT_WIDTH, TICK_RATE, type GameConfig } from './game'
import { listenInput, sampleInput } from './input'
import { link } from './interpolate'
import { attachScreen, presentScreen, recordScreen, type Command } from './screen'
import { resetTime, tickTime } from './time'

const STEP = 1000 / TICK_RATE
/** After a long stall (hidden tab, breakpoint), catch up at most this many updates. */
const MAX_CATCH_UP = 5
/** Display periods on which updates fall evenly: 60, 120, 180 and 240 Hz. */
const EVEN_PERIODS = [1, 2, 3, 4].map((k) => STEP / k)
/** How far the measured period may be from one of them (a display at 59.94 Hz still counts). */
const PERIOD_TOLERANCE = 0.03
/** Frames over which the display's period is measured. */
const PERIOD_FRAMES = 30

export class Runner {
  readonly width: number
  readonly height: number
  private frame = 0
  private last = 0
  private lag = 0
  private _paused = false
  private started = false
  private stopped = false
  private _scale = 1
  /** Durations of the last displayed frames, in milliseconds. */
  private readonly frameTimes: number[] = []
  /** What the game drew after its last update, paired with what it drew the update before. */
  private drawn: Command[] = []
  /** How far the displayed frame is between the last two updates (0 to 1). */
  private alpha = 0

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

  /** Display pixels per game pixel. */
  get scale() {
    return this._scale
  }

  /**
   * Fits the game in a space of that many display pixels: the largest whole scale that
   * fits (at least 1). Resizes the canvas to the game times that scale, and shows the
   * game again if it is running (a resized canvas is blank, and a paused game shows nothing).
   */
  fit(displayWidth: number, displayHeight: number) {
    const scale = Math.max(1, Math.floor(Math.min(displayWidth / this.width, displayHeight / this.height)))
    if (scale === this._scale && this.canvas.width === this.width * scale) return
    this._scale = scale
    this.canvas.width = this.width * scale
    this.canvas.height = this.height * scale
    if (!this.started || this.stopped) return
    attachScreen(this.canvas, this.width, this.height)
    presentScreen(this.drawn, this.alpha)
  }

  start() {
    this.started = true
    attachScreen(this.canvas, this.width, this.height)
    listenInput(true)
    resetTime()
    if (!this.guard(() => this.config.start?.())) return
    // A first frame right away, so the screen is never blank (even if paused at once).
    if (!this.record()) return
    presentScreen(this.drawn, 0)
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
    this.lag = Math.min(this.pace(this.lag, time - this.last), STEP * MAX_CATCH_UP)
    this.last = time
    // A hair under a whole update counts: three thirds of one may round just below it.
    while (this.lag >= STEP - 1e-6) {
      this.lag -= STEP
      sampleInput()
      if (!this.guard(() => this.config.update?.())) return
      tickTime()
      if (!this.record()) return
    }
    this.alpha = Math.min(1, Math.max(0, this.lag / STEP))
    presentScreen(this.drawn, this.alpha)
    this.frame = requestAnimationFrame(this.loop)
  }

  /** Records the game's draw, paired with the one before. False if the game failed. */
  private record() {
    return this.guard(() => {
      const next = recordScreen(() => this.config.draw?.())
      link(this.drawn, next)
      this.drawn = next
    })
  }

  /**
   * The time owed to updates after a frame that took `delta` milliseconds.
   *
   * Browsers report frame times with up to a millisecond of jitter. At 120 Hz an update is
   * due every other frame, and that jitter sometimes moves one a frame early or late: a
   * position stays on screen for 1 frame then 3 instead of 2 and 2, and moving things
   * hitch. So when the display's rate divides the update rate (60, 120, 180, 240 Hz), each
   * frame counts as exactly a whole number of the display's periods: updates fall on a
   * steady beat. At other rates (144 Hz) no beat is steady, and the measured time is used.
   */
  private pace(lag: number, delta: number) {
    const times = this.frameTimes
    times.push(delta)
    if (times.length > PERIOD_FRAMES) times.shift()
    // The average cancels the jitter out (a frame that ends late makes the next one short).
    // Dropped frames, far from the median, are left out of it.
    const median = [...times].sort((a, b) => a - b)[times.length >> 1]
    const usual = times.filter((t) => Math.abs(t - median) < median / 2)
    const measured = usual.reduce((a, b) => a + b, 0) / usual.length
    const period = EVEN_PERIODS.find((p) => Math.abs(measured - p) < p * PERIOD_TOLERANCE)
    if (period === undefined) return lag + delta
    // Whole periods only, the lag included, so rounding errors never shift the beat.
    return Math.round((lag + Math.round(delta / period) * period) / period) * period
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

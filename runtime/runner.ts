// Runs a game: a fixed-step loop (60 updates per second of the world's actors) and, on
// each displayed frame, the world drawn between its last two updates (see world.ts). Used
// by the editor, not by games. Only one game runs at a time.
//
// The game shows the same world everywhere: its width × height in game pixels. The
// runner scales it up by the largest whole number that fits the space it is given (see
// `fit`), and the canvas gets the display's own pixels. What is left around is the
// editor's black bars.

import { DEFAULT_SETTINGS, TICK_RATE, screenSize, type GameConfig } from './game'
import { forceInput, listenInput, sampleInput, type Button } from './input'
import { attachScreen } from './screen'
import { quietSounds, stopSounds } from './sounds'
import { resetTime, tickTime } from './time'
import { drawWorld, settleCamera, updateWorld } from './world'

const STEP = 1000 / TICK_RATE
/** After a long stall (hidden tab, breakpoint), catch up at most this many updates. */
const MAX_CATCH_UP = 5
/** Display periods on which updates fall evenly: 60, 120, 180 and 240 Hz. */
const EVEN_PERIODS = [1, 2, 3, 4].map((k) => STEP / k)
/**
 * How far the measured period may be from one of them: a display at 59.94 Hz still counts,
 * one at 58.5 Hz does not (counting it would make the game run 2.5% fast).
 */
const PERIOD_TOLERANCE = 0.01
/**
 * Frames over which the display's period is measured. Timestamps jitter by up to a
 * millisecond; averaged over 60 frames, that is under 1% even at 240 Hz (see
 * PERIOD_TOLERANCE).
 */
const PERIOD_FRAMES = 60

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
  /** How far the displayed frame is between the last two updates (0 to 1). */
  private alpha = 0
  /** The display's period, when updates fall on it evenly (see `pace`). */
  private period: number | undefined
  /** How long updates, drawing and frames take, in milliseconds (averaged). */
  readonly timings = { update: 0, draw: 0, frame: 0 }

  constructor(
    private readonly config: GameConfig,
    readonly canvas: HTMLCanvasElement,
    /** Called when the game's code throws; the game is stopped. */
    private readonly onError: (err: unknown) => void,
    /** The game's resolution, in game pixels (`screenSize` of game.json's settings). */
    size: { width: number; height: number } = screenSize(DEFAULT_SETTINGS),
  ) {
    this.width = size.width
    this.height = size.height
    canvas.width = this.width
    canvas.height = this.height
  }

  /** The game's own draw (its background), for whoever draws the world again. */
  get draw() {
    return () => this.config.draw?.()
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
    this.present()
  }

  start() {
    this.started = true
    attachScreen(this.canvas, this.width, this.height)
    listenInput(true)
    resetTime()
    if (!this.guard(() => this.config.start?.())) return
    settleCamera()
    // A first frame right away, so the screen is never blank (even if paused at once).
    if (!this.present()) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.loop)
  }

  pause() {
    if (this.stopped || this._paused) return
    this._paused = true
    cancelAnimationFrame(this.frame)
    listenInput(false)
    stopSounds()
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
    stopSounds()
    attachScreen(null)
  }

  /**
   * Runs `count` updates at once, with these buttons held instead of the player's, then
   * shows the result. The game stays paused: a script drives it, update by update, the
   * same way every time (the AI handle, tests). Its sounds are not heard, only listed
   * (`heardSounds`): played all at once, they would be noise.
   */
  step(count: number, buttons: Iterable<Button> = []) {
    if (this.stopped) return
    this.pause()
    forceInput(buttons)
    quietSounds(true)
    try {
      for (let i = 0; i < count; i++) if (!this.update()) return
    } finally {
      forceInput(null)
      quietSounds(false)
    }
    this.alpha = 1
    this.present()
  }

  private loop = (time: number) => {
    average(this.timings, 'frame', time - this.last)
    this.lag = Math.min(this.pace(this.lag, time - this.last), STEP * MAX_CATCH_UP)
    this.last = time
    // A hair under a whole update counts: three thirds of one may round just below it.
    while (this.lag >= STEP - 1e-6) {
      this.lag -= STEP
      if (!this.update()) return
    }
    // On a 60 Hz display each frame shows exactly one update: show it as it is, rather
    // than between it and the one before (which only adds a frame of delay).
    this.alpha = this.period === STEP ? 1 : Math.min(1, Math.max(0, this.lag / STEP))
    if (!this.present()) return
    this.frame = requestAnimationFrame(this.loop)
  }

  /** One update of the world. False if the game failed. */
  private update() {
    const start = performance.now()
    sampleInput()
    let ran = true
    if (!this.guard(() => (ran = updateWorld()))) return false
    tickTime(ran)
    average(this.timings, 'update', performance.now() - start)
    return true
  }

  /** Draws the world as it is shown on this frame. False if the game failed. */
  private present() {
    const start = performance.now()
    const ok = this.guard(() => drawWorld(this.alpha, this.draw))
    average(this.timings, 'draw', performance.now() - start)
    return ok
  }

  /**
   * The time owed to updates after a frame that took `delta` milliseconds.
   *
   * Browsers report frame times with up to a millisecond of jitter. At 120 Hz an update is
   * due every other frame, and that jitter sometimes moves one a frame early or late: a
   * position stays on screen for 1 frame then 3 instead of 2 and 2, and moving actors
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
    this.period = period
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

/** Keeps a running average of the last second or so (at 60 to 144 frames per second). */
function average(timings: Record<string, number>, key: string, value: number) {
  timings[key] = timings[key] === 0 ? value : timings[key] * 0.95 + value * 0.05
}

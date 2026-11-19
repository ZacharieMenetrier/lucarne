// The game's clocks. They count updates, so they run at the same speed on every display,
// and they stop while the game is paused.
//
// There are two: the world's (`time.ms`), which also stops while a modal UI (a menu, a
// dialogue) is open, so the world freezes behind it; and the UI's (`time.uiMs`), which
// keeps running then, so text still appears and cursors still blink.

import { TICK_RATE } from './game'

let ticks = 0
let uiTicks = 0

export const time = {
  /** Updates of the world since the game started (60 per second). */
  get ticks() {
    return ticks
  },
  /** Milliseconds of the world's time since the game started. */
  get ms() {
    return (ticks * 1000) / TICK_RATE
  },
  /** Milliseconds since the game started, modal UIs included: the UI's clock. */
  get uiMs() {
    return (uiTicks * 1000) / TICK_RATE
  },
}

/** Called by the loop: once when the game starts, then after each update. */
export function resetTime() {
  ticks = 0
  uiTicks = 0
}

/** One update went by; `world` is false when a modal UI stopped the world. */
export function tickTime(world: boolean) {
  uiTicks++
  if (world) ticks++
}

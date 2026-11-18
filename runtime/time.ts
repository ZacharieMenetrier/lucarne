// The game's clock. It counts updates, so it runs at the same speed on every display,
// and it stops while the game is paused.

import { TICK_RATE } from './game'

let ticks = 0

export const time = {
  /** Updates since the game started (60 per second). */
  get ticks() {
    return ticks
  },
  /** Milliseconds of game time since the game started. */
  get ms() {
    return (ticks * 1000) / TICK_RATE
  },
}

/** Called by the loop: once when the game starts, then after each update. */
export function resetTime() {
  ticks = 0
}

export function tickTime() {
  ticks++
}

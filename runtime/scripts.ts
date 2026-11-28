// Scripts: a game's code that takes time, written top to bottom with `await`.
//
//   async talk() {
//     line = 'Want a sword?'
//     await press('action')        // until the action button is pressed again
//     line = ''
//     await wait(30)               // half a second: 30 updates
//   }
//
// A script is any async function of the game. It only changes the game; what it shows is
// drawn by the game's `ui()` (see game.ts), from the values the script changed.
//
// The engine keeps scripts exact: a wait ends at the start of an update, before the actors
// update, and the script it wakes runs until its next wait (or its end) before anything else
// happens. Scripts that were waiting wake one at a time, in the order they started waiting.
// So a script moves the same way on every display, and when an AI steps the game. For this a
// script waits only on the engine (`wait`, `press`), never on `setTimeout` or the network.

import { input, takePress, type Button } from './input'

interface Waiter {
  /** Waits until this update, or for a press of this button. */
  until: number | Button
  resolve: () => void
  /** Who started the script: the actor whose update (or the game's start) called it. */
  by: string
}

let waiters: Waiter[] = []
/** Updates since the game started, as scripts count them. */
let updates = 0
/** Who is running now: new waits are theirs (see `Waiter.by`). */
let running = 'game'

/**
 * Waits for `count` updates (60 per second); `wait()` waits for the next one. It counts
 * while the game is paused too (`game.paused`): scripts are what runs then.
 */
export function wait(count = 1): Promise<void> {
  // Never less than the next update: a script that waits always lets the game go on.
  return waitFor(updates + Math.max(1, Math.ceil(count)))
}

/**
 * Waits until the button is pressed: a new press, after the wait started. The press that
 * started a conversation never also skips its first line. The script takes the press: the
 * actors don't see it (`input.pressed` is false), and neither does another script waiting
 * for that button, which keeps waiting. One press does one thing.
 */
export function press(button: Button): Promise<void> {
  return waitFor(button)
}

function waitFor(until: number | Button) {
  return new Promise<void>((resolve) => waiters.push({ until, resolve, by: running }))
}

/** Called by the world: the actor about to update ('game' for the game's own code). */
export function setRunning(by: string) {
  running = by
}

/**
 * Called by the loop at the start of each update, once its buttons are read: wakes the
 * scripts whose wait is over, one at a time, each running until its next wait.
 */
export async function wakeScripts() {
  updates++
  // Only the waits started before this update: one started now waits for the next.
  // The first to wait for a button takes its press (see `press`).
  const pressed = new Set<Button>()
  const due = waiters.filter((w) => {
    if (typeof w.until === 'number') return w.until <= updates
    if (!input.pressed(w.until) || pressed.has(w.until)) return false
    pressed.add(w.until)
    return true
  })
  if (due.length === 0) return
  for (const b of pressed) takePress(b)
  waiters = waiters.filter((w) => !due.includes(w))
  for (const w of due) {
    running = w.by
    w.resolve()
    // The script runs in promise steps (microtasks): let it take them until it waits on
    // the engine again, or is done.
    await settle()
  }
  running = 'game'
}

/** What each script is waiting on, in order: for the AI handle. */
export function waitingScripts(): { by: string; waiting: string }[] {
  return waiters.map((w) => ({
    by: w.by,
    waiting: typeof w.until === 'number' ? `wait ${w.until - updates}` : `press ${w.until}`,
  }))
}

/** Forgets every script: called when a game starts (they never wake). */
export function resetScripts() {
  waiters = []
  updates = 0
  running = 'game'
}

/**
 * Promise steps a woken script may take before the update goes on. Each `await` takes one
 * to three, so this lets a script go through scores of nested async functions (a
 * conversation calling `say` calling `showPage`…) to its next wait. Steps cost next to
 * nothing: 256 take about 10 µs.
 */
const SETTLE_STEPS = 256

/**
 * Lets the promises a script is waiting on settle, in promise steps only. It never waits
 * for the browser's next task: the browser may run a task late (Safari passes the messages
 * of a MessageChannel through another process), and an update that waited on one for every
 * script it woke made the game fall behind, then drop frames. Promise steps run in an
 * order the language fixes, the same on every browser: scripts stay exact.
 */
async function settle() {
  for (let i = 0; i < SETTLE_STEPS; i++) await null
}

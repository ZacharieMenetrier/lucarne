// What ▶ shows when the game has no code yet: a skylight at night, with a cat on the sill.
// It is itself a small Lucarne game, drawn with the engine's own `screen` and `input`.
// The arrows make the cat look around; the action key sends a shooting star.

import { Actor, game, input, screen, spawn } from '../../runtime/index'

const C = {
  ink: '#1a1c2c',
  wall: '#333c57',
  brick: '#29366f',
  stone: '#566c86',
  stoneLight: '#94b0c2',
  skyTop: '#1a1c2c',
  skyMid: '#29366f',
  skyLow: '#3b5dc9',
  star: '#f4f4f4',
  starDim: '#94b0c2',
  moon: '#ffcd75',
  eye: '#ffcd75',
}

const W = 320
const H = 180
const CX = 160
/** Center of the window's arch. */
const AY = 70
const OUTER = 44
const INNER = 40
const BOTTOM = 128
const SILL = BOTTOM

/** Half-width of a rounded-top shape on row `y`, or -1 outside it. */
function span(y: number, radius: number, bottom: number) {
  if (y > bottom || y <= AY - radius) return -1
  if (y >= AY) return radius
  return Math.floor(Math.sqrt(radius * radius - (AY - y) * (AY - y)))
}

function inSky(x: number, y: number) {
  const s = span(y, INNER, BOTTOM - 4)
  return s >= 0 && Math.abs(x - CX) <= s && Math.abs(x - CX) > 1 && Math.abs(y - (AY + 6)) > 1
}

/** Night sky in three bands, with checkered pixels where two bands meet. */
function skyColor(x: number, y: number) {
  const band = (y - (AY - INNER)) / (BOTTOM - 4 - (AY - INNER))
  const checker = (x + y) % 2 === 0
  if (band < 0.33) return C.skyTop
  if (band < 0.38) return checker ? C.skyTop : C.skyMid
  if (band < 0.7) return C.skyMid
  if (band < 0.76) return checker ? C.skyMid : C.skyLow
  return C.skyLow
}

/** Small deterministic random numbers, so the stars stay in place. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const rand = random(7)
const stars: { x: number; y: number; phase: number; speed: number }[] = []
while (stars.length < 16) {
  const x = Math.floor(CX - INNER + rand() * INNER * 2)
  const y = Math.floor(AY - INNER + rand() * 60)
  if (inSky(x, y) && Math.hypot(x - (CX + 18), y - (AY - 14)) > 11) {
    stars.push({ x, y, phase: rand() * Math.PI * 2, speed: 0.02 + rand() * 0.05 })
  }
}

const bricks: { x: number; y: number; w: number }[] = []
for (let i = 0; i < 26; i++) {
  const x = Math.floor(rand() * W)
  const y = Math.floor(rand() * H)
  if (Math.abs(x - CX) > OUTER + 10 || y > BOTTOM + 16) bricks.push({ x, y, w: 6 + Math.floor(rand() * 6) })
}

const CAT = [
  'x.......x',
  'xx.....xx',
  'xxxxxxxxx',
  'xxxxxxxxx',
  'xxxxxxxxx',
  '.xxxxxxx.',
  '..xxxxx..',
  '.xxxxxxx.',
  'xxxxxxxxx',
  'xxxxxxxxx',
  'xxxxxxxxx',
]
const CAT_X = CX + 14
const CAT_Y = SILL - CAT.length

let tick = 0
let look = 0
let lookTarget = 0
let shooting: { x: number; y: number } | null = null
let nextShooting = 180

function disc(cx: number, cy: number, r: number, color: (x: number, y: number) => string) {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y))
    for (let x = -half; x <= half; x++) screen.rect(cx + x, cy + y, 1, 1, color(cx + x, cy + y))
  }
}

/** What moves in the scene: the cat's eyes, the shooting stars. */
class Night extends Actor {
  update() {
    tick++
    if (input.x !== 0) lookTarget = Math.sign(input.x)
    else if (tick % 150 === 0) lookTarget = [-1, 0, 1, 0][Math.floor(tick / 150) % 4]
    if (tick % 6 === 0) look += Math.sign(lookTarget - look)

    if (input.pressed('action') || (!shooting && tick >= nextShooting)) {
      shooting = { x: CX - 10 + Math.floor(Math.random() * 50), y: AY - 36 }
      nextShooting = tick + 240 + Math.floor(Math.random() * 300)
    }
    if (shooting) {
      shooting.x -= 2
      shooting.y += 1
      if (shooting.y > BOTTOM) shooting = null
    }
  }
}

/** The scene's own resolution, whatever the game's settings. */
export const NO_GAME_SIZE = { width: W, height: H }

export const noGame = game({
  start() {
    tick = 0
    shooting = null
    nextShooting = 180
    spawn(Night)
  },

  draw() {
    screen.clear(C.wall)
    for (const b of bricks) screen.rect(b.x, b.y, b.w, 1, C.brick)

    // Window: stone frame, then the sky inside it.
    for (let y = AY - OUTER + 1; y <= BOTTOM; y++) {
      const o = span(y, OUTER, BOTTOM)
      screen.rect(CX - o, y, o * 2 + 1, 1, C.stone)
      const i = span(y, INNER, BOTTOM - 4)
      if (i >= 0) for (let x = CX - i; x <= CX + i; x++) screen.rect(x, y, 1, 1, skyColor(x, y))
    }

    // Stars twinkle; a few go out for a moment.
    for (const s of stars) {
      const v = Math.sin(tick * s.speed + s.phase)
      if (v > -0.7) screen.rect(s.x, s.y, 1, 1, v > 0.3 ? C.star : C.starDim)
    }

    // Crescent moon: a disc, cut by a second disc of sky.
    disc(CX + 18, AY - 14, 7, () => C.moon)
    disc(CX + 21, AY - 16, 6, skyColor)

    if (shooting) {
      const trail = [C.star, C.star, C.starDim, C.starDim, C.stone]
      trail.forEach((color, k) => {
        const x = shooting!.x + k * 2
        const y = shooting!.y - k
        if (inSky(x, y)) screen.rect(x, y, 2, 1, color)
      })
    }

    // Window bars.
    screen.rect(CX - 1, AY - INNER, 2, BOTTOM - (AY - INNER), C.stone)
    screen.rect(CX - INNER, AY + 5, INNER * 2 + 1, 2, C.stone)

    // Sill.
    screen.rect(CX - OUTER - 6, SILL, (OUTER + 6) * 2 + 1, 1, C.stoneLight)
    screen.rect(CX - OUTER - 6, SILL + 1, (OUTER + 6) * 2 + 1, 3, C.stone)

    // The cat, its tail swaying, its eyes following `look` and blinking now and then.
    CAT.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === 'x') screen.rect(CAT_X + x, CAT_Y + y, 1, 1, C.ink)
    })
    const sway = Math.round(Math.sin(tick / 40) * 1.5)
    for (const [x, y] of [[9, 10], [10, 10], [11, 9], [12, 8], [12, 7], [12 + sway, 6], [12 + sway, 5]]) {
      screen.rect(CAT_X + x, CAT_Y + y, 1, 1, C.ink)
    }
    const blinking = tick % 200 < 8
    if (!blinking) {
      screen.rect(CAT_X + 2 + look, CAT_Y + 3, 1, 1, C.eye)
      screen.rect(CAT_X + 6 + look, CAT_Y + 3, 1, 1, C.eye)
    }
  },
})

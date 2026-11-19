// A sprite = a PNG sheet + a JSON file, in sprites/.
//
// The sheet is a strip: the animation frames side by side, left to right, all
// the same size.
//
//   sprites/hero.png
//   sprites/hero.json  { "version": 1, "frameWidth": 16, "frameHeight": 16,
//                        "frames": [{ "duration": 100 }] }

import { Bitmap, blit, extract } from './bitmap'

export interface SpriteMeta {
  version: 1
  frameWidth: number
  frameHeight: number
  /** One entry per frame; duration in milliseconds. */
  frames: { duration: number }[]
  /** Origin pixel of the sprite (where it is anchored in the game), if set. */
  origin?: { x: number; y: number }
}

export interface Sprite {
  name: string
  meta: SpriteMeta
  /** The animation frames, in order. */
  frames: Bitmap[]
}

export const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/
export const MAX_SIZE = 512

export function defaultMeta(frameWidth: number, frameHeight: number): SpriteMeta {
  return {
    version: 1,
    frameWidth,
    frameHeight,
    frames: [{ duration: 100 }],
  }
}

export function newSprite(name: string, width: number, height: number): Sprite {
  return { name, meta: defaultMeta(width, height), frames: [new Bitmap(width, height)] }
}

function positiveInt(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback
}

/** Reads a sprite JSON, tolerating missing fields (and ignoring unknown ones). */
export function parseMeta(text: string): SpriteMeta {
  const raw = JSON.parse(text) as Partial<SpriteMeta>
  const frames = Array.isArray(raw.frames) && raw.frames.length
    ? raw.frames.map((f) => ({ duration: positiveInt(f?.duration, 100) }))
    : [{ duration: 100 }]
  const o = raw.origin
  const origin = o && Number.isInteger(o.x) && Number.isInteger(o.y) ? { x: o.x, y: o.y } : undefined
  return {
    version: 1,
    frameWidth: positiveInt(raw.frameWidth, 16),
    frameHeight: positiveInt(raw.frameHeight, 16),
    frames,
    ...(origin && { origin }),
  }
}

/** Readable JSON: one line per frame, for clean Git diffs. */
export function serializeMeta(meta: SpriteMeta): string {
  const obj = (o: object) =>
    `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`
  const list = (items: object[]) =>
    items.length === 1 ? `[${obj(items[0])}]` : `[\n${items.map((i) => `    ${obj(i)}`).join(',\n')}\n  ]`
  return [
    '{',
    `  "version": ${meta.version},`,
    `  "frameWidth": ${meta.frameWidth},`,
    `  "frameHeight": ${meta.frameHeight},`,
    `  "frames": ${list(meta.frames)}${meta.origin ? ',' : ''}`,
    ...(meta.origin ? [`  "origin": ${obj(meta.origin)}`] : []),
    '}',
    '',
  ].join('\n')
}

export function splitSheet(sheet: Bitmap, meta: SpriteMeta): Bitmap[] {
  const { frameWidth: w, frameHeight: h } = meta
  return meta.frames.map((_, i) => extract(sheet, { x: i * w, y: 0, w, h }))
}

export function composeSheet(sprite: Sprite): Bitmap {
  const { frameWidth: w, frameHeight: h, frames } = sprite.meta
  const sheet = new Bitmap(w * frames.length, h)
  sprite.frames.forEach((bmp, i) => blit(sheet, bmp, i * w, 0, false))
  return sheet
}

import { TRANSPARENT, type Color } from './color'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** An in-memory image: an array of colors, row by row. */
export class Bitmap {
  readonly data: Uint32Array

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint32Array,
  ) {
    this.data = data ?? new Uint32Array(width * height)
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  get(x: number, y: number): Color {
    return this.inBounds(x, y) ? this.data[y * this.width + x] : TRANSPARENT
  }

  set(x: number, y: number, c: Color) {
    if (this.inBounds(x, y)) this.data[y * this.width + x] = c
  }

  clone() {
    return new Bitmap(this.width, this.height, this.data.slice())
  }

  equals(other: Bitmap) {
    if (other.width !== this.width || other.height !== this.height) return false
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== other.data[i]) return false
    return true
  }
}

// ---------------------------------------------------------------------------
// Geometry

/** Bresenham line, both ends included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    points.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return points
}

/** Snaps a line to horizontal, vertical or 45°. */
export function constrainLine(x0: number, y0: number, x1: number, y1: number): Point {
  const dx = x1 - x0
  const dy = y1 - y0
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx > ady * 2) return { x: x1, y: y0 }
  if (ady > adx * 2) return { x: x0, y: y1 }
  const d = Math.max(adx, ady)
  return { x: x0 + Math.sign(dx) * d, y: y0 + Math.sign(dy) * d }
}

/** Rectangle between two corners, corners included. */
export function rectFromCorners(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 }
}

/** Part of the rectangle inside a w×h image. */
export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(w, r.x + r.w)
  const y1 = Math.min(h, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export function rectContains(r: Rect, p: Point) {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h
}

export function drawRect(bmp: Bitmap, r: Rect, color: Color, filled: boolean) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1
      if (filled || edge) bmp.set(x, y, color)
    }
  }
}

// ---------------------------------------------------------------------------
// Pixel operations

/** Flood fill (4 neighbors). Returns true if the image changed. */
export function floodFill(bmp: Bitmap, x: number, y: number, color: Color): boolean {
  if (!bmp.inBounds(x, y)) return false
  const { width, height, data } = bmp
  const target = data[y * width + x]
  if (target === color) return false
  const stack = [y * width + x]
  while (stack.length) {
    const i = stack.pop()!
    if (data[i] !== target) continue
    data[i] = color
    const px = i % width
    if (px > 0) stack.push(i - 1)
    if (px < width - 1) stack.push(i + 1)
    if (i >= width) stack.push(i - width)
    if (i < width * (height - 1)) stack.push(i + width)
  }
  return true
}

export function extract(bmp: Bitmap, r: Rect): Bitmap {
  const out = new Bitmap(r.w, r.h)
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) out.data[y * r.w + x] = bmp.get(r.x + x, r.y + y)
  }
  return out
}

export function clearRect(bmp: Bitmap, r: Rect) {
  drawRect(bmp, r, TRANSPARENT, true)
}

/** Copies `src` into `dst` at (dx, dy). Transparent `src` pixels are skipped when `masked`. */
export function blit(dst: Bitmap, src: Bitmap, dx: number, dy: number, masked = true) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const c = src.data[y * src.width + x]
      if (masked && c === TRANSPARENT) continue
      dst.set(dx + x, dy + y, c)
    }
  }
}

export function flipH(bmp: Bitmap): Bitmap {
  const out = new Bitmap(bmp.width, bmp.height)
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) out.set(bmp.width - 1 - x, y, bmp.get(x, y))
  }
  return out
}

export function flipV(bmp: Bitmap): Bitmap {
  const out = new Bitmap(bmp.width, bmp.height)
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) out.set(x, bmp.height - 1 - y, bmp.get(x, y))
  }
  return out
}

/** New size; the old image is placed at (ox, oy). */
export function resized(bmp: Bitmap, w: number, h: number, ox: number, oy: number): Bitmap {
  const out = new Bitmap(w, h)
  blit(out, bmp, ox, oy, false)
  return out
}

export function replaceColor(bmp: Bitmap, from: Color, to: Color): boolean {
  let changed = false
  for (let i = 0; i < bmp.data.length; i++) {
    if (bmp.data[i] === from) {
      bmp.data[i] = to
      changed = true
    }
  }
  return changed
}

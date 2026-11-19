// What the board and the world have in common on screen: zoom, panning, framing, and the
// resize handles at the corners of what they show (sprites, or maps).
// Zoom is a whole number of screen pixels per pixel, so every pixel stays crisp.

import type { Point, Rect } from './bitmap'
import type { Corner } from './board'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 128

/** Resize handles of the Move tool: side of the square, and how far from
 * its center a press still grabs it (CSS pixels). */
export const HANDLE_SIZE = 6
const HANDLE_REACH = 9
export const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/** What a viewport shows: named rectangles, in pixels, drawn in an order. */
export interface Layout {
  drawOrder(): string[]
  rectOf(name: string): Rect | null
  bounds(): Rect | null
  subscribe(fn: () => void): unknown
}

export abstract class Viewport {
  /** Continuous zoom (gestures), rounded for display. */
  zoomRaw = 8
  /** Position of the origin, in physical canvas pixels. */
  ox = 0
  oy = 0
  /** Resize handle under the pointer (Move tool). */
  hoverHandle: { name: string; corner: Corner } | null = null
  protected readonly ctx: CanvasRenderingContext2D
  private frame = 0

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
  ) {
    this.ctx = canvas.getContext('2d')!
    new ResizeObserver(() => this.resize()).observe(canvas)
    layout.subscribe(() => this.requestRender())
  }

  /** The background behind everything, as CSS. */
  abstract get boardColor(): string

  protected abstract render(): void

  get dpr() {
    return window.devicePixelRatio || 1
  }

  get zoom() {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(this.zoomRaw)))
  }

  private resize() {
    const w = Math.round(this.canvas.clientWidth * this.dpr)
    const h = Math.round(this.canvas.clientHeight * this.dpr)
    if (w === this.canvas.width && h === this.canvas.height) return
    // A hidden canvas has no size: nothing to frame yet.
    if (w === 0 || h === 0) return
    const first = this.canvas.width === 300 && this.canvas.height === 150
    // Keep the center in place.
    this.ox += (w - this.canvas.width) / 2
    this.oy += (h - this.canvas.height) / 2
    this.canvas.width = w
    this.canvas.height = h
    if (first) this.fit()
    this.render()
  }

  // --- Framing ----------------------------------------------------------------

  /** Shows everything. */
  fit() {
    const b = this.layout.bounds()
    if (b) this.fitRect(b, 0.85)
  }

  protected fitRect(r: Rect, ratio: number) {
    const { width: cw, height: ch } = this.canvas
    const z = Math.min((cw * ratio) / r.w, (ch * ratio) / r.h)
    this.zoomRaw = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(z)))
    this.centerOn(r)
  }

  protected centerOn(r: Rect) {
    const z = this.zoom
    this.ox = Math.round(this.canvas.width / 2 - (r.x + r.w / 2) * z)
    this.oy = Math.round(this.canvas.height / 2 - (r.y + r.h / 2) * z)
    this.requestRender()
  }

  /** Brings a sprite (or a map) into view; `zoomIn` frames it closely (double tap). */
  focus(name: string, zoomIn = false) {
    const r = this.layout.rectOf(name)
    if (!r) return
    const z = this.zoom
    const tooBig = r.w * z > this.canvas.width * 0.9 || r.h * z > this.canvas.height * 0.9
    if (zoomIn || tooBig) this.fitRect(r, zoomIn ? 0.7 : 0.85)
    else this.centerOn(r)
  }

  /** Centers a sprite (or a map) only if it is entirely off screen. */
  reveal(name: string) {
    const r = this.layout.rectOf(name)
    if (!r) return
    const z = this.zoom
    const x = this.ox + r.x * z
    const y = this.oy + r.y * z
    if (x + r.w * z < 0 || y + r.h * z < 0 || x > this.canvas.width || y > this.canvas.height) this.centerOn(r)
  }

  /** The point at the middle of the screen. */
  center(): Point {
    const z = this.zoom
    return { x: (this.canvas.width / 2 - this.ox) / z, y: (this.canvas.height / 2 - this.oy) / z }
  }

  // --- Coordinates ------------------------------------------------------------

  /** Position of an event, in physical canvas pixels. */
  toDevice(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect()
    return { x: (clientX - r.left) * this.dpr, y: (clientY - r.top) * this.dpr }
  }

  /** The pixel under a screen point. */
  toBoard(clientX: number, clientY: number) {
    const d = this.toDevice(clientX, clientY)
    return { x: Math.floor((d.x - this.ox) / this.zoom), y: Math.floor((d.y - this.oy) / this.zoom) }
  }

  /** Changes the zoom while keeping canvas point (dx, dy) fixed. */
  zoomAt(zoomRaw: number, dx: number, dy: number) {
    const before = this.zoom
    const sx = (dx - this.ox) / before
    const sy = (dy - this.oy) / before
    this.zoomRaw = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRaw))
    this.ox = Math.round(dx - sx * this.zoom)
    this.oy = Math.round(dy - sy * this.zoom)
    this.requestRender()
  }

  pan(dx: number, dy: number) {
    this.ox = Math.round(this.ox + dx)
    this.oy = Math.round(this.oy + dy)
    this.requestRender()
  }

  requestRender() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  /** Canvas position of a corner, in physical pixels. */
  protected cornerAt(name: string, corner: Corner) {
    const r = this.layout.rectOf(name)!
    const z = this.zoom
    return {
      x: this.ox + (r.x + (corner[1] === 'e' ? r.w : 0)) * z,
      y: this.oy + (r.y + (corner[0] === 's' ? r.h : 0)) * z,
    }
  }

  /** Resize handle under a screen point (the closest one), for the Move tool. */
  handleAt(clientX: number, clientY: number): { name: string; corner: Corner } | null {
    const d = this.toDevice(clientX, clientY)
    const reach = HANDLE_REACH * this.dpr
    let best: { name: string; corner: Corner } | null = null
    let bestDist = Infinity
    for (const name of this.layout.drawOrder()) {
      for (const corner of CORNERS) {
        const c = this.cornerAt(name, corner)
        const dist = Math.max(Math.abs(c.x - d.x), Math.abs(c.y - d.y))
        // Ties go to the one drawn on top (later in the order).
        if (dist <= reach && dist <= bestDist) {
          best = { name, corner }
          bestDist = dist
        }
      }
    }
    return best
  }

  /** Draws the resize handles of the Move tool at the corners of `names`. */
  protected drawHandles(names: string[], active: string | null, dragged: Corner | null, colors: { cursor: string; handle: string }) {
    const { ctx } = this
    const lw = Math.max(1, Math.round(this.dpr))
    const s = Math.round(HANDLE_SIZE * this.dpr)
    const hot = dragged ? { name: active, corner: dragged } : this.hoverHandle
    for (const name of names) {
      for (const c of CORNERS) {
        const p = this.cornerAt(name, c)
        const isHot = hot?.name === name && hot.corner === c
        ctx.fillStyle = isHot || name === active ? colors.cursor : colors.handle
        const k = isHot ? s + 2 * lw : s
        ctx.fillRect(Math.round(p.x - k / 2), Math.round(p.y - k / 2), k, k)
      }
    }
  }
}

/** Is a CSS color (#rrggbb) light? Lines and text over it are then dark. */
export function isLight(css: string) {
  const m = /^#([0-9a-f]{6})/i.exec(css)
  if (!m) return false
  const n = parseInt(m[1], 16)
  // Perceived brightness (ITU-R BT.601)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140
}

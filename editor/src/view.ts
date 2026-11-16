// Draws the board in the canvas: every sprite at the same scale, with its
// outline and name, plus zoom, panning, grid and selection.
// Zoom is a whole number of screen pixels per sprite pixel, so every pixel
// stays crisp. There is no checkerboard: transparent pixels show the board.

import { Bitmap, blit, type Rect } from './bitmap'
import { NAME_BAND } from './board'
import { colorToCss } from './color'
import type { Editor } from './editor'
import { toImageData } from './png'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 128

const ACCENT = '#41a6f6'
/** Lines and text that stay visible on the board color. */
const ON_DARK = { outline: 'rgba(255, 255, 255, 0.16)', label: '#8a8a99', grid: 'rgba(255, 255, 255, 0.07)', cursor: '#ffffff' }
const ON_LIGHT = { outline: 'rgba(0, 0, 0, 0.22)', label: '#5c5c6a', grid: 'rgba(0, 0, 0, 0.09)', cursor: '#000000' }

function isLight(css: string) {
  const m = /^#([0-9a-f]{6})/i.exec(css)
  if (!m) return false
  const n = parseInt(m[1], 16)
  // Perceived brightness (ITU-R BT.601)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140
}
const DANGER = '#e0566b'

interface Label {
  name: string
  x: number
  y: number
  w: number
  h: number
}

export class View {
  /** Continuous zoom (gestures), rounded for display. */
  zoomRaw = 8
  /** Position of the board origin, in physical canvas pixels. */
  ox = 0
  oy = 0
  showGrid = false

  private ctx: CanvasRenderingContext2D
  /** One canvas per sprite redrawn every frame. Never shared: Safari may
   * draw a canvas lazily, showing whatever it contains at the end. */
  private live = new Map<string, HTMLCanvasElement>()
  /** Pixels of sprites that are not being edited, ready to draw. */
  private cache = new WeakMap<Bitmap, HTMLCanvasElement>()
  private frame = 0
  /** Sprite names as drawn last time, in canvas pixels, for hit testing. */
  private labels: Label[] = []

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly editor: Editor,
  ) {
    this.ctx = canvas.getContext('2d')!
    new ResizeObserver(() => this.resize()).observe(canvas)
    editor.subscribe(() => this.requestRender())
  }

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

  /** Shows every sprite. */
  fit() {
    const b = this.editor.bounds()
    if (b) this.fitRect(b, 0.85)
  }

  private fitRect(r: Rect, ratio: number) {
    const { width: cw, height: ch } = this.canvas
    const z = Math.min((cw * ratio) / r.w, (ch * ratio) / r.h)
    this.zoomRaw = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(z)))
    this.centerOn(r)
  }

  private centerOn(r: Rect) {
    const z = this.zoom
    this.ox = Math.round(this.canvas.width / 2 - (r.x + r.w / 2) * z)
    this.oy = Math.round(this.canvas.height / 2 - (r.y + r.h / 2) * z)
    this.requestRender()
  }

  /** Brings a sprite into view; `zoomIn` frames it closely (double tap). */
  focus(name: string, zoomIn = false) {
    const r = this.editor.footprintOf(name)
    if (!r) return
    const z = this.zoom
    const tooBig = r.w * z > this.canvas.width * 0.9 || r.h * z > this.canvas.height * 0.9
    if (zoomIn || tooBig) this.fitRect(r, zoomIn ? 0.7 : 0.85)
    else this.centerOn(r)
  }

  /** Centers a sprite only if it is entirely off screen. */
  reveal(name: string) {
    const r = this.editor.rectOf(name)
    if (!r) return
    const z = this.zoom
    const x = this.ox + r.x * z
    const y = this.oy + r.y * z
    if (x + r.w * z < 0 || y + r.h * z < 0 || x > this.canvas.width || y > this.canvas.height) this.centerOn(r)
  }

  /** Board point at the middle of the screen. */
  center() {
    const z = this.zoom
    return { x: (this.canvas.width / 2 - this.ox) / z, y: (this.canvas.height / 2 - this.oy) / z }
  }

  // --- Coordinates ------------------------------------------------------------

  /** Position of an event, in physical canvas pixels. */
  toDevice(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect()
    return { x: (clientX - r.left) * this.dpr, y: (clientY - r.top) * this.dpr }
  }

  /** Board pixel under a screen point. */
  toBoard(clientX: number, clientY: number) {
    const d = this.toDevice(clientX, clientY)
    return { x: Math.floor((d.x - this.ox) / this.zoom), y: Math.floor((d.y - this.oy) / this.zoom) }
  }

  /** Sprite whose name is under a screen point. */
  labelAt(clientX: number, clientY: number): string | null {
    const d = this.toDevice(clientX, clientY)
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i]
      if (d.x >= l.x && d.x < l.x + l.w && d.y >= l.y && d.y < l.y + l.h) return l.name
    }
    return null
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

  /** Forgets cached sprite images (after changing pixels in place). */
  invalidate() {
    this.cache = new WeakMap()
    this.requestRender()
  }

  requestRender() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  // --- Rendering --------------------------------------------------------------

  private render() {
    const { ctx, canvas, editor } = this
    const dpr = this.dpr
    const style = getComputedStyle(canvas)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const bg = editor.background ?? (style.getPropertyValue('--stage-bg').trim() || '#202028')
    const ink = isLight(bg) ? ON_LIGHT : ON_DARK
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    this.labels = []

    const z = this.zoom
    const tool = editor.tool
    const hv = editor.hover
    const under = hv ? editor.hitTest(hv) : null
    // Pencil and eraser: the hovered pixel shows the result instead of a cursor.
    // During a stroke, only on the sprite being drawn.
    const previewOn =
      hv && under && (tool === 'pencil' || tool === 'eraser') && (!editor.dragging || under === editor.active)
        ? under
        : null
    canvas.classList.toggle('hide-cursor', previewOn !== null)
    canvas.classList.toggle('tool-move', tool === 'move')

    // Names live in the band kept free above each sprite.
    const band = NAME_BAND * z
    const fontSize = Math.min(Math.round(11 * dpr), Math.floor(band * 0.75))
    const lw = Math.max(1, Math.round(dpr))
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
    ctx.textBaseline = 'bottom'

    // Sprites on screen, with their rectangles in canvas pixels
    const visible = editor.drawOrder().flatMap((name) => {
      const pl = editor.sprites.get(name)!
      const bmp = pl.sprite.frames[0][0]
      const x = this.ox + pl.x * z
      const y = this.oy + pl.y * z
      const w = bmp.width * z
      const h = bmp.height * z
      if (x > canvas.width || y - band > canvas.height || x + w < 0 || y + h < 0) return []
      return [{ name, pl, bmp, x, y, w, h }]
    })

    for (const name of this.live.keys()) if (!editor.sprites.has(name)) this.live.delete(name)
    const blocked = editor.placeBlocked
    for (const { name, pl, bmp, x, y, w, h } of visible) {
      const isActive = name === editor.active

      // Pixels, with the selection, shape and pixel previews. The board
      // color goes under them so transparent pixels hide names underneath.
      ctx.fillStyle = bg
      ctx.fillRect(x, y, w, h)
      let img = bmp
      if ((isActive && (editor.floating || editor.overlay)) || name === previewOn) {
        img = bmp.clone()
        if (isActive && editor.floating) blit(img, editor.floating.bmp, editor.floating.x, editor.floating.y)
        if (isActive && editor.overlay) blit(img, editor.overlay, 0, 0)
        if (name === previewOn) img.set(hv!.x - pl.x, hv!.y - pl.y, tool === 'eraser' ? 0 : editor.color)
      }
      this.drawBitmap(img, x, y, z, isActive || img !== bmp ? name : null)
      if (isActive) this.cache.delete(bmp)

      // Grid
      if (this.showGrid && z >= 6 * dpr) {
        ctx.fillStyle = ink.grid
        for (let i = 1; i < bmp.width; i++) ctx.fillRect(x + i * z, y, 1, h)
        for (let i = 1; i < bmp.height; i++) ctx.fillRect(x, y + i * z, w, 1)
      }

      // Outline, just outside the pixels; red while dropped on another sprite
      ctx.strokeStyle = isActive ? (blocked ? DANGER : ACCENT) : ink.outline
      ctx.lineWidth = lw
      ctx.strokeRect(x - lw / 2, y - lw / 2, w + lw, h + lw)
    }

    // Names, in their band: shortened to the sprite's width, hidden when
    // zoomed out too far to read them. The band stays a handle either way.
    for (const { name, x, y, w } of visible) {
      this.labels.push({ name, x, y: y - band, w, h: band })
      if (fontSize < 7 * dpr) continue
      ctx.fillStyle = name === editor.active ? ACCENT : ink.label
      ctx.fillText(fitText(ctx, name, w), x, y - Math.max(2 * dpr, (band - fontSize) / 2))
    }

    // Hovered pixel outline (other drawing tools; the eraser, whose preview
    // is invisible on an empty pixel)
    if (hv && under && tool !== 'select' && tool !== 'pencil' && tool !== 'move') {
      ctx.strokeStyle = tool === 'eraser' ? ink.cursor : colorToCss(editor.color)
      ctx.lineWidth = lw
      ctx.strokeRect(this.ox + hv.x * z + 0.5, this.oy + hv.y * z + 0.5, z - 1, z - 1)
    }

    // Selection (marching ants)
    const sel = editor.selection
    const pl = editor.placed
    if (sel && pl) {
      const x = this.ox + (pl.x + sel.x) * z + 0.5
      const y = this.oy + (pl.y + sel.y) * z + 0.5
      const dash = 4 * dpr
      ctx.lineWidth = lw
      ctx.setLineDash([dash, dash])
      ctx.strokeStyle = '#000'
      ctx.lineDashOffset = -(performance.now() / 60) % (dash * 2)
      ctx.strokeRect(x, y, sel.w * z - 1, sel.h * z - 1)
      ctx.strokeStyle = '#fff'
      ctx.lineDashOffset -= dash
      ctx.strokeRect(x, y, sel.w * z - 1, sel.h * z - 1)
      ctx.setLineDash([])
      this.requestRender()
    }
  }

  /** Draws pixels; `live` names a sprite that changes every frame. */
  private drawBitmap(bmp: Bitmap, x: number, y: number, z: number, live: string | null) {
    let src: HTMLCanvasElement
    if (live) {
      src = this.live.get(live) ?? document.createElement('canvas')
      this.live.set(live, src)
      if (src.width !== bmp.width || src.height !== bmp.height) {
        src.width = bmp.width
        src.height = bmp.height
      }
      src.getContext('2d')!.putImageData(toImageData(bmp), 0, 0)
    } else {
      let cached = this.cache.get(bmp)
      if (!cached) {
        cached = document.createElement('canvas')
        cached.width = bmp.width
        cached.height = bmp.height
        cached.getContext('2d')!.putImageData(toImageData(bmp), 0, 0)
        this.cache.set(bmp, cached)
      }
      src = cached
    }
    this.ctx.imageSmoothingEnabled = false
    this.ctx.drawImage(src, x, y, bmp.width * z, bmp.height * z)
  }
}

/** Text shortened with an ellipsis to fit `max` pixels. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let n = text.length
  while (n > 1 && ctx.measureText(`${text.slice(0, n)}…`).width > max) n--
  return `${text.slice(0, n)}…`
}

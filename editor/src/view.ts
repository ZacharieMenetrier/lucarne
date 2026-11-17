// Draws the board in the canvas: every sprite at the same scale, with its
// outline and name, plus zoom, panning, grid and selection.
// Zoom is a whole number of screen pixels per sprite pixel, so every pixel
// stays crisp. There is no checkerboard: transparent pixels show the board.

import { colorToCss } from './color'
import { Bitmap, blit, type Rect } from './bitmap'
import type { Corner, Editor } from './editor'
import { toImageData } from './png'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 128

/** Lines and text that stay visible on the board color. */
const ON_DARK = { outline: 'rgba(255, 255, 255, 0.08)', active: 'rgba(255, 255, 255, 0.24)', grid: 'rgba(255, 255, 255, 0.07)', check: 'rgba(255, 255, 255, 0.05)', cursor: '#ffffff', handle: 'rgba(255, 255, 255, 0.35)' }
const ON_LIGHT = { outline: 'rgba(0, 0, 0, 0.1)', active: 'rgba(0, 0, 0, 0.3)', grid: 'rgba(0, 0, 0, 0.09)', check: 'rgba(0, 0, 0, 0.06)', cursor: '#000000', handle: 'rgba(0, 0, 0, 0.35)' }

/** Resize handles of the Move tool: side of the square, and how far from
 * its center a press still grabs it (CSS pixels). */
const HANDLE_SIZE = 6
const HANDLE_REACH = 9
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

function isLight(css: string) {
  const m = /^#([0-9a-f]{6})/i.exec(css)
  if (!m) return false
  const n = parseInt(m[1], 16)
  // Perceived brightness (ITU-R BT.601)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140
}
const DANGER = '#e0566b'

export class View {
  /** Continuous zoom (gestures), rounded for display. */
  zoomRaw = 8
  /** Position of the board origin, in physical canvas pixels. */
  ox = 0
  oy = 0
  showGrid = false
  showChecker = false
  private checkerPattern: { tint: string; size: number; pattern: CanvasPattern } | null = null
  /** Resize handle under the pointer (Move tool). */
  hoverHandle: { name: string; corner: Corner } | null = null

  private ctx: CanvasRenderingContext2D
  /** One canvas per sprite redrawn every frame. Never shared: Safari may
   * draw a canvas lazily, showing whatever it contains at the end. */
  private live = new Map<string, HTMLCanvasElement>()
  /** Pixels of sprites that are not being edited, ready to draw. */
  private cache = new WeakMap<Bitmap, HTMLCanvasElement>()
  private frame = 0

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
    const r = this.editor.rectOf(name)
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

  /** Canvas position of a sprite's corner, in physical pixels. */
  private cornerAt(name: string, corner: Corner) {
    const r = this.editor.rectOf(name)!
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
    for (const name of this.editor.drawOrder()) {
      for (const corner of CORNERS) {
        const c = this.cornerAt(name, corner)
        const dist = Math.max(Math.abs(c.x - d.x), Math.abs(c.y - d.y))
        // Ties go to the sprite drawn on top (later in the order).
        if (dist <= reach && dist <= bestDist) {
          best = { name, corner }
          bestDist = dist
        }
      }
    }
    return best
  }

  /** Board color as shown: the game's, else the editor's default. */
  get boardColor(): string {
    return this.editor.background ?? (getComputedStyle(this.canvas).getPropertyValue('--stage-bg').trim() || '#202028')
  }

  /** Fills a rectangle with the checkerboard (fixed-size squares anchored to the board origin). */
  private fillChecker(x: number, y: number, w: number, h: number, tint: string) {
    const { ctx } = this
    const size = Math.round(8 * this.dpr)
    if (this.checkerPattern?.tint !== tint || this.checkerPattern.size !== size) {
      const tile = document.createElement('canvas')
      tile.width = tile.height = size * 2
      const t = tile.getContext('2d')!
      t.fillStyle = tint
      t.fillRect(size, 0, size, size)
      t.fillRect(0, size, size, size)
      this.checkerPattern = { tint, size, pattern: ctx.createPattern(tile, 'repeat')! }
    }
    const { pattern } = this.checkerPattern
    pattern.setTransform(new DOMMatrix().translate(this.ox, this.oy))
    ctx.fillStyle = pattern
    ctx.fillRect(x, y, w, h)
  }

  // --- Rendering --------------------------------------------------------------

  private render() {
    const { ctx, canvas, editor } = this
    const dpr = this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const bg = this.boardColor
    const ink = isLight(bg) ? ON_LIGHT : ON_DARK
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (this.showChecker) this.fillChecker(0, 0, canvas.width, canvas.height, ink.check)

    const z = this.zoom
    const tool = editor.tool
    const hv = editor.hover
    const under = hv ? editor.hitTest(hv) : null
    // Pencil and eraser: the hovered pixel previews the result, on the sprite being edited only.
    const previewOn = hv && under && under === editor.active && (tool === 'pencil' || tool === 'eraser') ? under : null
    canvas.classList.toggle('tool-move', tool === 'move')
    canvas.classList.toggle('tool-draw', tool !== 'move')
    canvas.classList.toggle('on-active', under !== null && under === editor.active)
    const corner = tool === 'move' ? (editor.resizeCorner ?? this.hoverHandle?.corner ?? null) : null
    canvas.classList.toggle('resize-nwse', corner === 'nw' || corner === 'se')
    canvas.classList.toggle('resize-nesw', corner === 'ne' || corner === 'sw')

    const lw = Math.max(1, Math.round(dpr))

    // Sprites on screen, with their rectangles in canvas pixels
    const visible = editor.drawOrder().flatMap((name) => {
      const pl = editor.sprites.get(name)!
      const bmp = editor.shownFrame(name)
      const x = this.ox + pl.x * z
      const y = this.oy + pl.y * z
      const w = bmp.width * z
      const h = bmp.height * z
      if (x > canvas.width || y > canvas.height || x + w < 0 || y + h < 0) return []
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
      if (this.showChecker) this.fillChecker(x, y, w, h, ink.check)
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
      ctx.strokeStyle = isActive ? (blocked ? DANGER : ink.active) : ink.outline
      ctx.lineWidth = lw
      ctx.strokeRect(x - lw / 2, y - lw / 2, w + lw, h + lw)
    }

    // Origin (Origin tool only): crosshair across the sprite through the origin
    // pixel, and the pixel outlined. White over black so it shows on any color.
    if (tool === 'origin') {
      for (const { pl, bmp, x, y, w, h } of visible) {
        const o = pl.sprite.meta.origin
        if (!o || o.x >= bmp.width || o.y >= bmp.height) continue
        const px = x + o.x * z
        const py = y + o.y * z
        const cx = Math.round(px + z / 2 - lw / 2)
        const cy = Math.round(py + z / 2 - lw / 2)
        for (const [color, g] of [['#000', lw], ['#fff', 0]] as const) {
          ctx.fillStyle = color
          ctx.fillRect(cx - g, y, lw + 2 * g, h)
          ctx.fillRect(x, cy - g, w, lw + 2 * g)
        }
        ctx.lineWidth = lw
        ctx.strokeStyle = '#000'
        ctx.strokeRect(px + lw / 2, py + lw / 2, z - lw, z - lw)
        ctx.strokeStyle = '#fff'
        ctx.strokeRect(px + lw * 1.5, py + lw * 1.5, z - lw * 3, z - lw * 3)
      }
    }

    // Resize handles at the corners of every sprite (Move tool)
    if (tool === 'move') {
      const s = Math.round(HANDLE_SIZE * dpr)
      const hot = editor.resizeCorner ? { name: editor.active, corner: editor.resizeCorner } : this.hoverHandle
      for (const { name } of visible) {
        for (const c of CORNERS) {
          const p = this.cornerAt(name, c)
          const isHot = hot?.name === name && hot.corner === c
          ctx.fillStyle = isHot || name === editor.active ? ink.cursor : ink.handle
          const k = isHot ? s + 2 * lw : s
          ctx.fillRect(Math.round(p.x - k / 2), Math.round(p.y - k / 2), k, k)
        }
      }
    }

    // Hovered pixel outline for the other tools, on the sprite being edited only.
    if (hv && under && under === editor.active && tool !== 'select' && tool !== 'move' && tool !== 'pencil' && tool !== 'eraser') {
      ctx.strokeStyle = colorToCss(editor.color)
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

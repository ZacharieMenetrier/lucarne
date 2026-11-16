// Draws the sprite in the canvas: zoom, panning, grid, selection.
// Zoom is a whole number of screen pixels per sprite pixel, so every pixel
// stays crisp.

import { Bitmap, blit } from './bitmap'
import { colorToCss } from './color'
import type { Editor } from './editor'
import { toImageData } from './png'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 128

export class View {
  /** Continuous zoom (gestures), rounded for display. */
  zoomRaw = 8
  /** Offset of the sprite origin, in physical canvas pixels. */
  ox = 0
  oy = 0
  showGrid = true

  private ctx: CanvasRenderingContext2D
  private sheet = document.createElement('canvas')
  private sheetCtx: CanvasRenderingContext2D
  private frame = 0
  private fitted: string | null = null

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly editor: Editor,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.sheetCtx = this.sheet.getContext('2d')!
    new ResizeObserver(() => this.resize()).observe(canvas)
    editor.subscribe(() => {
      // Refit when the sprite or its size changes.
      const bmp = editor.bmp
      const key = editor.sprite && bmp ? `${editor.sprite.name}:${bmp.width}x${bmp.height}` : null
      if (key !== this.fitted) {
        this.fitted = key
        this.fit()
      }
      this.requestRender()
    })
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

  /** Centers the sprite, fitting it in 80% of the area. */
  fit() {
    const bmp = this.editor.bmp
    if (!bmp) return
    const { width: cw, height: ch } = this.canvas
    this.zoomRaw = Math.max(MIN_ZOOM, Math.floor(Math.min(cw / bmp.width, ch / bmp.height) * 0.8))
    this.center()
  }

  center() {
    const bmp = this.editor.bmp
    if (!bmp) return
    this.ox = Math.round((this.canvas.width - bmp.width * this.zoom) / 2)
    this.oy = Math.round((this.canvas.height - bmp.height * this.zoom) / 2)
    this.requestRender()
  }

  /** Position of an event, in physical canvas pixels. */
  toDevice(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect()
    return { x: (clientX - r.left) * this.dpr, y: (clientY - r.top) * this.dpr }
  }

  /** Sprite pixel under a screen point. */
  toSprite(clientX: number, clientY: number) {
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

  private render() {
    const { ctx, canvas, editor } = this
    const style = getComputedStyle(canvas)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = style.getPropertyValue('--stage-bg') || '#202028'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const bmp = editor.bmp
    if (!bmp) return canvas.classList.remove('hide-cursor')
    const z = this.zoom
    const w = bmp.width * z
    const h = bmp.height * z

    // Transparency checkerboard
    // Cells aligned to sprite pixels when they are large enough.
    const cell = z >= 6 * this.dpr ? z : Math.max(4, Math.round(8 * this.dpr))
    ctx.save()
    ctx.beginPath()
    ctx.rect(this.ox, this.oy, w, h)
    ctx.clip()
    ctx.fillStyle = '#3a3a44'
    ctx.fillRect(this.ox, this.oy, w, h)
    ctx.fillStyle = '#2e2e36'
    for (let y = 0; y < h; y += cell) {
      for (let x = (y / cell) % 2 ? cell : 0; x < w; x += cell * 2) {
        ctx.fillRect(this.ox + x, this.oy + y, cell, cell)
      }
    }
    ctx.restore()

    // Image + floating selection + preview
    // Pencil and eraser: the hovered pixel shows the result instead of a cursor.
    const hv = editor.hover
    const onSprite = !!hv && bmp.inBounds(hv.x, hv.y)
    const pixelPreview = onSprite && (editor.tool === 'pencil' || editor.tool === 'eraser')
    canvas.classList.toggle('hide-cursor', pixelPreview)
    let composite = bmp
    if (editor.floating || editor.overlay || pixelPreview) {
      composite = bmp.clone()
      if (editor.floating) blit(composite, editor.floating.bmp, editor.floating.x, editor.floating.y)
      if (editor.overlay) blit(composite, editor.overlay, 0, 0)
      if (pixelPreview) composite.set(hv!.x, hv!.y, editor.tool === 'eraser' ? 0 : editor.color)
    }
    this.drawBitmap(composite, this.ox, this.oy, z)

    // Grid
    if (this.showGrid && z >= 6 * this.dpr) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
      for (let x = 1; x < bmp.width; x++) ctx.fillRect(this.ox + x * z, this.oy, 1, h)
      for (let y = 1; y < bmp.height; y++) ctx.fillRect(this.ox, this.oy + y * z, w, 1)
    }

    // Sprite border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(this.ox - 0.5, this.oy - 0.5, w + 1, h + 1)

    // Hovered pixel outline (other tools, and the eraser, whose preview is
    // invisible on the checkerboard)
    if (onSprite && editor.tool !== 'select' && editor.tool !== 'pencil') {
      ctx.strokeStyle = editor.tool === 'eraser' ? '#ffffff' : colorToCss(editor.color)
      ctx.lineWidth = Math.max(1, this.dpr)
      ctx.strokeRect(this.ox + hv!.x * z + 0.5, this.oy + hv!.y * z + 0.5, z - 1, z - 1)
    }

    // Selection (marching ants)
    const sel = editor.selection
    if (sel) {
      const x = this.ox + sel.x * z + 0.5
      const y = this.oy + sel.y * z + 0.5
      const lw = Math.max(1, this.dpr)
      const dash = 4 * this.dpr
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

  private drawBitmap(bmp: Bitmap, x: number, y: number, z: number) {
    if (this.sheet.width !== bmp.width || this.sheet.height !== bmp.height) {
      this.sheet.width = bmp.width
      this.sheet.height = bmp.height
    }
    this.sheetCtx.putImageData(toImageData(bmp), 0, 0)
    this.ctx.imageSmoothingEnabled = false
    this.ctx.drawImage(this.sheet, x, y, bmp.width * z, bmp.height * z)
  }
}

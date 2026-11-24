// Draws the board in the canvas: every sprite at the same scale, with its
// outline and name, plus zoom, panning, grid and selection.
// Zoom is a whole number of screen pixels per sprite pixel, so every pixel
// stays crisp. There is no checkerboard: transparent pixels show the board.

import { TRANSPARENT, colorToCss, hexToColor } from './color'
import { Bitmap, blit } from './bitmap'
import type { Editor } from './editor'
import { toImageData } from './png'
import { isFont, isTileset } from './sprite'
import { FONT_CHARACTERS, FONT_COLUMNS, Font, measureGlyphs } from '../../runtime/fonts'
import { fontCell } from './font'

/** Written under the font being edited, with its own pixels: what it looks like as text. */
const SPECIMEN = 'The quick brown fox jumps over the lazy dog. 0123456789 Élève, garçon, où ? « Déjà ! »'
import { Viewport, isLight } from './viewport'

export { MAX_ZOOM, MIN_ZOOM } from './viewport'

/** Lines and text that stay visible on the board color. */
const ON_DARK = { outline: 'rgba(255, 255, 255, 0.08)', active: 'rgba(255, 255, 255, 0.24)', grid: 'rgba(255, 255, 255, 0.07)', check: 'rgba(255, 255, 255, 0.05)', cursor: '#ffffff', handle: 'rgba(255, 255, 255, 0.35)', font: '#ffffff', guide: 'rgba(255, 255, 255, 0.16)' }
const ON_LIGHT = { outline: 'rgba(0, 0, 0, 0.1)', active: 'rgba(0, 0, 0, 0.3)', grid: 'rgba(0, 0, 0, 0.09)', check: 'rgba(0, 0, 0, 0.06)', cursor: '#000000', handle: 'rgba(0, 0, 0, 0.35)', font: '#000000', guide: 'rgba(0, 0, 0, 0.18)' }

const DANGER = '#e0566b'

export class View extends Viewport {
  showGrid = false
  showChecker = false
  private checkerPattern: { tint: string; size: number; pattern: CanvasPattern } | null = null
  private hatchPattern: { size: number; pattern: CanvasPattern } | null = null

  /** One canvas per sprite redrawn every frame. Never shared: Safari may
   * draw a canvas lazily, showing whatever it contains at the end. */
  private live = new Map<string, HTMLCanvasElement>()
  /** Pixels of sprites that are not being edited, ready to draw. */
  private cache = new WeakMap<Bitmap, HTMLCanvasElement>()
  /** A font's image in the board's ink color, by its image (and that color). */
  private fontInk = new WeakMap<Bitmap, { color: string; bmp: Bitmap }>()

  constructor(
    canvas: HTMLCanvasElement,
    private readonly editor: Editor,
  ) {
    super(canvas, editor)
  }

  /** Forgets cached sprite images (after changing pixels in place). */
  invalidate() {
    this.cache = new WeakMap()
    this.fontInk = new WeakMap()
    this.requestRender()
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

  protected render() {
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
      // A font is ink only (the game chooses its color): shown in the board's ink.
      // The font being edited changes in place: its ink is made again every frame, as its
      // pixels are drawn (see drawBitmap).
      if (isFont(name)) img = this.inked(img, ink.font, isActive || img !== bmp)
      this.drawBitmap(img, x, y, z, isActive || img !== bmp ? name : null)
      if (isActive) this.cache.delete(bmp)

      // Grid
      if (this.showGrid && z >= 6 * dpr) {
        ctx.fillStyle = ink.grid
        for (let i = 1; i < bmp.width; i++) ctx.fillRect(x + i * z, y, 1, h)
        for (let i = 1; i < bmp.height; i++) ctx.fillRect(x, y + i * z, w, 1)
      }

      // A tileset's tiles, always shown: they are what maps are made of.
      if (isTileset(name)) {
        const t = editor.tileSize * z
        ctx.fillStyle = ink.active
        if (t >= 4 * dpr) {
          for (let i = t; i < w; i += t) ctx.fillRect(Math.round(x + i), y, lw, h)
          for (let i = t; i < h; i += t) ctx.fillRect(x, Math.round(y + i), w, lw)
        }
      }

      // A font's cells, always shown, with the character each is for when it is empty.
      if (isFont(name)) this.drawFontCells(img, x, y, z, ink, isActive)

      // Outline, just outside the pixels; red while dropped on another sprite
      ctx.strokeStyle = isActive ? (blocked ? DANGER : ink.active) : ink.outline
      ctx.lineWidth = lw
      ctx.strokeRect(x - lw / 2, y - lw / 2, w + lw, h + lw)
    }

    // Origin (Origin tool only): the origin pixel outlined, with four short ticks. White over black so it shows on any color.
    if (tool === 'origin') {
      for (const { pl, bmp, x, y } of visible) {
        const o = pl.sprite.meta.origin
        if (!o || o.x >= bmp.width || o.y >= bmp.height) continue
        const px = x + o.x * z
        const py = y + o.y * z
        const cx = Math.round(px + z / 2 - lw / 2)
        const cy = Math.round(py + z / 2 - lw / 2)
        // Four short ticks just outside the pixel, like a reticle: marks the spot
        // without covering the art.
        const tick = Math.max(3 * lw, Math.round(z * 0.75))
        for (const [color, g] of [['#000', lw], ['#fff', 0]] as const) {
          ctx.fillStyle = color
          ctx.fillRect(cx - g, py - tick - g, lw + 2 * g, tick + g)
          ctx.fillRect(cx - g, py + z, lw + 2 * g, tick + g)
          ctx.fillRect(px - tick - g, cy - g, tick + g, lw + 2 * g)
          ctx.fillRect(px + z, cy - g, tick + g, lw + 2 * g)
        }
        ctx.lineWidth = lw
        ctx.strokeStyle = '#000'
        ctx.strokeRect(px + lw / 2, py + lw / 2, z - lw, z - lw)
        ctx.strokeStyle = '#fff'
        ctx.strokeRect(px + lw * 1.5, py + lw * 1.5, z - lw * 3, z - lw * 3)
      }
    }

    // Solid boxes of the tilesets (Box tool only): hatched, so the art shows through.
    if (tool === 'box') {
      for (const { name, pl, x, y } of visible) {
        if (!isTileset(name)) continue
        for (const b of pl.sprite.meta.solid ?? []) {
          const bx = x + (b.column * editor.tileSize + b.x) * z
          const by = y + (b.row * editor.tileSize + b.y) * z
          this.drawSolid(bx, by, b.width * z, b.height * z, lw)
        }
      }
    }

    // Resize handles at the corners of every sprite (Move tool)
    if (tool === 'move') this.drawHandles(visible.map((v) => v.name), editor.active, editor.resizeCorner, ink)

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

  /** A font's image with its ink in one color (`fresh`: an image that changes every frame). */
  private inked(bmp: Bitmap, color: string, fresh: boolean): Bitmap {
    const known = fresh ? undefined : this.fontInk.get(bmp)
    if (known?.color === color) return known.bmp
    const c = hexToColor(color)
    const out = new Bitmap(bmp.width, bmp.height)
    for (let i = 0; i < bmp.data.length; i++) out.data[i] = bmp.data[i] === TRANSPARENT ? TRANSPARENT : c
    if (!fresh) this.fontInk.set(bmp, { color, bmp: out })
    return out
  }

  /** A font's grid of cells, the character an empty cell is for, and under the font being
   * edited, a line written with it. */
  private drawFontCells(img: Bitmap, x: number, y: number, z: number, ink: typeof ON_DARK, active: boolean) {
    const { ctx } = this
    const cell = fontCell(img)
    const cw = cell.width * z
    const chh = cell.height * z
    const lw = Math.max(1, Math.round(this.dpr))
    const w = img.width * z
    const h = img.height * z
    ctx.fillStyle = ink.active
    if (cw >= 4 * this.dpr) for (let i = cw; i < w - 1; i += cw) ctx.fillRect(Math.round(x + i), y, lw, h)
    if (chh >= 4 * this.dpr) for (let i = chh; i < h - 1; i += chh) ctx.fillRect(x, Math.round(y + i), w, lw)
    const isInk = (px: number, py: number) => img.get(px, py) !== TRANSPARENT
    const glyphs = measureGlyphs(cell.width, cell.height, isInk)
    if (chh >= 12 * this.dpr) {
      ctx.fillStyle = ink.guide
      ctx.font = `${Math.round(chh * 0.7)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ;[...FONT_CHARACTERS].forEach((ch, i) => {
        if (glyphs[i]) return
        ctx.fillText(ch, x + ((i % FONT_COLUMNS) + 0.5) * cw, y + (Math.floor(i / FONT_COLUMNS) + 0.5) * chh)
      })
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
    }
    if (!active || !glyphs.some(Boolean)) return
    // The specimen: stamped from the font's pixels, as the game does, a line under it.
    const src = document.createElement('canvas')
    src.width = img.width
    src.height = img.height
    src.getContext('2d')!.putImageData(toImageData(img), 0, 0)
    const font = new Font({ name: '', sheet: src, width: img.width, height: img.height, ink: isInk })
    ctx.imageSmoothingEnabled = false
    font.lines(SPECIMEN, img.width).forEach((line, row) => {
      let cx = 0
      const top = y + h + (row + 1) * font.lineHeight * z
      for (const ch of line) {
        const g = font.glyph(ch)
        if (g) ctx.drawImage(src, g.x, g.y, g.width, cell.height, x + cx * z, top, g.width * z, chh)
        cx += font.advance(ch)
      }
    })
  }

  /** A solid box: red hatching anchored to the board, and its outline. */
  private drawSolid(x: number, y: number, w: number, h: number, lw: number) {
    const { ctx } = this
    const size = Math.max(6, Math.round(6 * this.dpr))
    if (this.hatchPattern?.size !== size) {
      const tile = document.createElement('canvas')
      tile.width = tile.height = size
      const t = tile.getContext('2d')!
      t.strokeStyle = DANGER
      t.lineWidth = Math.max(1, Math.round(this.dpr))
      t.beginPath()
      // A diagonal, and the corners that continue it, so the stripes join across tiles.
      for (const o of [-size, 0, size]) {
        t.moveTo(o, size)
        t.lineTo(o + size, 0)
      }
      t.stroke()
      this.hatchPattern = { size, pattern: ctx.createPattern(tile, 'repeat')! }
    }
    const { pattern } = this.hatchPattern
    pattern.setTransform(new DOMMatrix().translate(this.ox, this.oy))
    ctx.fillStyle = 'rgba(224, 86, 107, 0.18)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = pattern
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = DANGER
    ctx.lineWidth = lw
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
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

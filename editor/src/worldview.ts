// Draws the world in its canvas: every map at its place, at the same scale, with its tiles
// (taken from the tilesets on the board, as they are now), the tile grid, the actors placed
// on the maps (drawn by the game's own code, see actortypes.ts), the block of tiles or the
// actor about to be placed, and the frame of one screen of the game.

import type { Bitmap } from './bitmap'
import { toImageData } from './png'
import type { ActorPicture } from './actortypes'
import { Viewport, isLight } from './viewport'
import type { World } from './world'

const ON_DARK = { outline: 'rgba(255, 255, 255, 0.16)', active: 'rgba(255, 255, 255, 0.5)', grid: 'rgba(255, 255, 255, 0.07)', empty: 'rgba(255, 255, 255, 0.04)', cursor: '#ffffff', handle: 'rgba(255, 255, 255, 0.35)' }
const ON_LIGHT = { outline: 'rgba(0, 0, 0, 0.18)', active: 'rgba(0, 0, 0, 0.5)', grid: 'rgba(0, 0, 0, 0.09)', empty: 'rgba(0, 0, 0, 0.05)', cursor: '#000000', handle: 'rgba(0, 0, 0, 0.35)' }
const DANGER = '#e0566b'
/** What is selected, on the maps as in the panel's list: the editor's accent. */
const SELECTED = '#41a6f6'

export class WorldView extends Viewport {
  /** Tileset pixels, ready to draw (dropped when a tileset changes: see `invalidate`). */
  private cache = new WeakMap<Bitmap, HTMLCanvasElement>()

  constructor(
    canvas: HTMLCanvasElement,
    private readonly world: World,
    /** A tileset's pixels, by its name (without "tiles/"), as drawn on the board now. */
    private readonly tileset: (name: string) => Bitmap | null,
    /** The board color (the game's, else the editor's). */
    private readonly background: () => string,
    /** An actor's picture; null when it draws nothing, undefined when the game has no
     * such actor file (or its code could not be run). */
    private readonly picture: (actor: string) => ActorPicture | null | undefined,
  ) {
    super(canvas, world)
    this.zoomRaw = 2
  }

  get boardColor() {
    return this.background()
  }

  /** Forgets tileset images (a tileset was drawn on). */
  invalidate() {
    this.cache = new WeakMap()
    this.requestRender()
  }

  /** A tileset's pixels as a canvas, kept while they do not change. */
  sheet(name: string): HTMLCanvasElement | null {
    const bmp = this.tileset(name)
    if (!bmp) return null
    let c = this.cache.get(bmp)
    if (!c) {
      c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')!.putImageData(toImageData(bmp), 0, 0)
      this.cache.set(bmp, c)
    }
    return c
  }

  protected render() {
    const { ctx, canvas, world } = this
    const dpr = this.dpr
    const z = this.zoom
    const t = world.tileSize
    const tz = t * z
    const lw = Math.max(1, Math.round(dpr))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    const bg = this.boardColor
    const ink = isLight(bg) ? ON_LIGHT : ON_DARK
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const tool = world.tool
    const hv = world.hover
    const under = hv ? world.hitTest(hv) : null
    canvas.classList.toggle('tool-move', tool === 'move')
    canvas.classList.toggle('tool-draw', tool !== 'move' && tool !== 'select')
    canvas.classList.toggle('on-active', under !== null)
    const corner = tool === 'move' ? (world.resizeCorner ?? this.hoverHandle?.corner ?? null) : null
    canvas.classList.toggle('resize-nwse', corner === 'nw' || corner === 'se')
    canvas.classList.toggle('resize-nesw', corner === 'ne' || corner === 'sw')

    const visible = world.drawOrder().flatMap((name) => {
      const r = world.rectOf(name)!
      const x = this.ox + r.x * z
      const y = this.oy + r.y * z
      const w = r.w * z
      const h = r.h * z
      if (x > canvas.width || y > canvas.height || x + w < 0 || y + h < 0) return []
      return [{ name, map: world.maps.get(name)!, x, y, w, h }]
    })

    const blocked = world.placeBlocked
    for (const { name, map, x, y, w, h } of visible) {
      // Empty cells show a faint fill, so a map's extent reads even before it has tiles.
      ctx.fillStyle = bg
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = ink.empty
      ctx.fillRect(x, y, w, h)

      // Only the cells on screen.
      const c0 = Math.max(0, Math.floor(-x / tz))
      const r0 = Math.max(0, Math.floor(-y / tz))
      const c1 = Math.min(map.width - 1, Math.floor((canvas.width - x) / tz))
      const r1 = Math.min(map.height - 1, Math.floor((canvas.height - y) / tz))
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const tile = map.cells[row * map.width + col]
          const sheet = tile && this.sheet(tile.tileset)
          if (!sheet) continue
          ctx.fillStyle = bg
          ctx.fillRect(x + col * tz, y + row * tz, tz, tz)
          ctx.drawImage(sheet, tile.col * t, tile.row * t, t, t, x + col * tz, y + row * tz, tz, tz)
        }
      }

      if (tz >= 8 * dpr) {
        ctx.fillStyle = ink.grid
        for (let i = 1; i < map.width; i++) ctx.fillRect(Math.round(x + i * tz), y, lw, h)
        for (let i = 1; i < map.height; i++) ctx.fillRect(x, Math.round(y + i * tz), w, lw)
      }

      const isActive = name === world.active
      ctx.strokeStyle = isActive && blocked ? DANGER : name === world.selectedMap ? SELECTED : isActive ? ink.active : ink.outline
      ctx.lineWidth = lw
      ctx.strokeRect(x - lw / 2, y - lw / 2, w + lw, h + lw)
    }

    // The actors, from the back to the front, as the game draws them. Painting tiles,
    // they fade a little: they are there, but out of the way.
    const mode = world.mode
    if (mode === 'tiles') ctx.globalAlpha = 0.45
    for (const t of world.actorsInDepthOrder()) this.drawActor(t.placement.actor, t.x, t.y, ink)
    ctx.globalAlpha = 1
    if (mode === 'maps') {
      for (const t of world.selection) {
        const p = world.placed(t)
        if (p) this.outline(world.actorRect(p), SELECTED)
      }
      // The Eraser: the actor a click would remove.
      if (hv && tool === 'remove') {
        const hit = world.actorAt(hv)
        const p = hit && world.placed(hit)
        if (p) this.outline(world.actorRect(p), ink.cursor)
      }
      const box = world.selectBox
      if (box) {
        ctx.fillStyle = 'rgba(65, 166, 246, 0.12)'
        ctx.fillRect(this.ox + box.x * z, this.oy + box.y * z, box.w * z, box.h * z)
        ctx.strokeStyle = '#41a6f6'
        ctx.lineWidth = lw
        ctx.strokeRect(Math.round(this.ox + box.x * z) + lw / 2, Math.round(this.oy + box.y * z) + lw / 2, Math.round(box.w * z), Math.round(box.h * z))
      }
    }

    // The actor about to be placed, under the pointer: where it would stand.
    if (hv && tool === 'place' && world.placing && !world.dragging) {
      const at = world.placeAt(world.placing, hv)
      if (world.mapForActor(at)) {
        ctx.globalAlpha = 0.6
        this.drawActor(world.placing, at.x, at.y, ink)
        ctx.globalAlpha = 1
      }
    }

    // The block about to be stamped, under the pointer.
    if (hv && under && tool === 'tile' && world.brush) {
      const sheet = this.sheet(world.brush.tileset)
      const map = world.maps.get(under)!
      const c = world.cellOf(hv)
      if (sheet) {
        ctx.globalAlpha = 0.7
        for (const [cell, tile] of world.stampAt(c)) {
          if (cell.x < map.x || cell.y < map.y || cell.x >= map.x + map.width || cell.y >= map.y + map.height) continue
          ctx.drawImage(sheet, tile.col * t, tile.row * t, t, t, this.ox + cell.x * tz, this.oy + cell.y * tz, tz, tz)
        }
        ctx.globalAlpha = 1
      }
      const b = world.brush
      ctx.strokeStyle = ink.cursor
      ctx.lineWidth = lw
      ctx.strokeRect(this.ox + c.x * tz + lw / 2, this.oy + c.y * tz + lw / 2, b.w * tz - lw, b.h * tz - lw)
    } else if (hv && under && (tool === 'eraser' || tool === 'picker')) {
      const c = world.cellOf(hv)
      ctx.strokeStyle = ink.cursor
      ctx.lineWidth = lw
      ctx.strokeRect(this.ox + c.x * tz + lw / 2, this.oy + c.y * tz + lw / 2, tz - lw, tz - lw)
    }

    // One screen of the game around the pointer, kept inside the map as the camera is.
    if (hv && under && mode === 'tiles') {
      const r = world.rectOf(under)!
      const sw = world.screen.columns * world.tileSize
      const sh = world.screen.rows * world.tileSize
      const sx = Math.max(r.x, Math.min(hv.x - sw / 2, r.x + r.w - sw))
      const sy = Math.max(r.y, Math.min(hv.y - sh / 2, r.y + r.h - sh))
      const dash = 4 * dpr
      ctx.lineWidth = lw
      ctx.setLineDash([dash, dash])
      ctx.strokeStyle = ink.active
      ctx.strokeRect(Math.round(this.ox + sx * z) + lw / 2, Math.round(this.oy + sy * z) + lw / 2, sw * z - lw, sh * z - lw)
      ctx.setLineDash([])
    }

    if (tool === 'move') this.drawHandles(visible.map((v) => v.name), world.active, world.resizeCorner, ink)
  }

  /**
   * Draws an actor with its feet at (x, y), in world pixels: its picture, or a dashed frame
   * when it draws nothing, or a red one when the game has no such actor file.
   */
  private drawActor(actor: string, x: number, y: number, ink: typeof ON_DARK) {
    const { ctx, world } = this
    const z = this.zoom
    const lw = Math.max(1, Math.round(this.dpr))
    const p = this.picture(actor)
    const b = world.boundsOf(actor)
    const left = Math.round(this.ox + (x + b.x) * z)
    const top = Math.round(this.oy + (y + b.y) * z)
    const w = Math.round(b.w * z)
    const h = Math.round(b.h * z)
    if (p) {
      ctx.drawImage(p.image, left, top, w, h)
      return
    }
    ctx.strokeStyle = p === undefined ? DANGER : ink.active
    ctx.lineWidth = lw
    ctx.setLineDash([3 * lw, 3 * lw])
    ctx.strokeRect(left + lw / 2, top + lw / 2, w - lw, h - lw)
    ctx.setLineDash([])
  }

  /** A frame just around a rectangle of the world. */
  private outline(r: { x: number; y: number; w: number; h: number }, color: string) {
    const { ctx } = this
    const z = this.zoom
    const lw = Math.max(1, Math.round(this.dpr))
    const left = Math.round(this.ox + r.x * z)
    const top = Math.round(this.oy + r.y * z)
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.strokeRect(left - lw * 1.5, top - lw * 1.5, Math.round(r.w * z) + lw * 3, Math.round(r.h * z) + lw * 3)
  }
}

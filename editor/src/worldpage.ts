// The world editor's page (#world): the whole world, every map at its place, the tools to
// stamp tiles and to move and resize maps, the list of maps, and the tilesets to pick tiles
// from. Tilesets are drawn on the board, with the pixel editor: this page only picks them.

import type { App } from './app'
import { confirmDialog, h, openDialog, toast } from './dialog'
import { icon } from './icons'
import { attachInput } from './input'
import { newMap } from './map'
import { createActionsMenu, createMenu, currentPage, goTo, onPage } from './menu'
import type { Project } from './project'
import { NAME_RE, isTileset, tilesetKey, tilesetName } from './sprite'
import { World, type WorldTool } from './world'
import { WorldView } from './worldview'

const TOOLS: { id: WorldTool; label: string; key: string; icon: string }[] = [
  { id: 'tile', label: 'Tile', key: 'B', icon: 'pencil' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { id: 'picker', label: 'Eyedropper', key: 'I', icon: 'picker' },
  { id: 'move', label: 'Move map', key: 'V', icon: 'move' },
]
const TOOL_KEYS: Record<string, WorldTool> = { b: 'tile', e: 'eraser', i: 'picker', v: 'move' }

export class WorldPage {
  readonly world = new World()
  private readonly view: WorldView
  private readonly root: HTMLElement
  private readonly status: HTMLElement
  private readonly mapList: HTMLElement
  private readonly pickers: HTMLElement
  /** Chooses the tileset shown in the panel. */
  private readonly tilesetSelect: HTMLSelectElement
  /** The tileset shown in the panel: one at a time, so that it gets the panel's whole width. */
  private shown: string | null = null
  private pending = new Set<string>()
  private timer = 0
  private chain: Promise<void> = Promise.resolve()
  private framed = false

  constructor(
    private readonly project: Project,
    private readonly app: App,
  ) {
    const canvas = h('canvas', { className: 'world-canvas' })
    this.status = h('span', { className: 'save-status', 'data-status': 'saved' }, 'Saved')
    this.mapList = h('div', { className: 'world-list' })
    this.pickers = h('div', { className: 'world-pickers' })
    new ResizeObserver(() => this.fitPickers()).observe(this.pickers)
    this.tilesetSelect = h('select', {
      className: 'world-tileset-select',
      'aria-label': 'Tileset shown',
      onchange: () => {
        this.shown = this.tilesetSelect.value
        this.renderPickers()
      },
    })
    const tools = h('nav', { className: 'world-tools', 'aria-label': 'Tools' },
      ...TOOLS.map((t) => h('button', {
        className: 'tool',
        title: `${t.label} (${t.key})`,
        'aria-label': t.label,
        'data-world-tool': t.id,
        html: icon(t.icon),
        onclick: () => this.world.setTool(t.id),
      })))
    const button = (title: string, name: string, run: () => void, extra: Record<string, unknown> = {}) =>
      h('button', { type: 'button', className: 'icon', title, 'aria-label': title, html: icon(name), onclick: run, ...extra })
    this.root = h('div', { id: 'world-page' },
      h('header', { className: 'page-bar' },
        createMenu(),
        h('h1', {}, 'World'),
        h('span', { className: 'spacer' }),
        this.status,
        button('Show every map (0)', 'fit', () => this.view.fit()),
        h('button', { type: 'button', className: 'run-game', title: 'Play game (⌘↵)', 'aria-label': 'Play game', html: icon('play'), onclick: () => this.app.play() })),
      h('div', { className: 'world-body' },
        tools,
        h('main', { className: 'world-stage' }, canvas),
        h('aside', { className: 'world-side' },
          // Tilesets first: picking tiles is what this panel is used for the most.
          h('section', { className: 'world-tilesets' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Tilesets'), this.tilesetSelect),
            this.pickers),
          h('section', { className: 'world-maps' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Maps'),
              h('button', { type: 'button', className: 'small icon-btn', title: 'New map', 'aria-label': 'New map', html: icon('add'), onclick: () => void this.newMap() })),
            this.mapList))))
    document.body.append(this.root)

    this.view = new WorldView(canvas, this.world, (name) => this.tilesetBitmap(name), () => this.app.view.boardColor)
    this.world.onEdit = (name) => this.schedule(name)
    this.world.onMessage = toast
    this.world.subscribe(() => this.render())
    this.bindKeys(attachInput(canvas, this.view, this.world))

    app.mapsUsing = (tileset) => this.world.mapsUsing(tileset)
    app.onTilesetRenamed = async (from, to) => {
      for (const name of this.world.renameTileset(from, to)) this.pending.add(name)
      await this.flush()
    }
    app.beforePlay = () => this.flush()
    window.addEventListener('beforeunload', (e) => {
      if (this.pending.size) e.preventDefault()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush()
    })
  }

  /** Loads every map of the game, then follows the page. */
  async load() {
    for (const name of await this.project.listMaps()) {
      try {
        this.world.maps.set(name, await this.project.loadMap(name))
      } catch (err) {
        toast((err as Error).message)
      }
    }
    this.renderMaps()
    onPage((page) => {
      if (page !== 'world') return
      // Settings and tilesets may have changed on the other pages.
      this.world.tileSize = this.project.settings.tileSize
      this.world.screen = { width: this.project.settings.width, height: this.project.settings.height }
      this.view.invalidate()
      this.renderPickers()
      this.world.emit()
      if (!this.framed) requestAnimationFrame(() => this.view.fit())
      this.framed = true
    })
  }

  /** Every map's size, in game pixels (the resolution cannot grow beyond the smallest). */
  get mapSizes() {
    const t = this.world.tileSize
    return [...this.world.maps.values()].map((m) => ({ name: m.name, width: m.width * t, height: m.height * t }))
  }

  private tilesetBitmap(name: string) {
    return this.app.editor.sprites.get(tilesetKey(name))?.sprite.frames[0] ?? null
  }

  // --- Saving ---------------------------------------------------------------

  private schedule(name: string) {
    this.pending.add(name)
    this.setStatus('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
  }

  /** Saves the maps changed, right away. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.pending.size) return this.chain
    const names = [...this.pending]
    this.pending.clear()
    this.setStatus('saving')
    this.chain = this.chain
      .then(async () => {
        for (const n of names) {
          const m = this.world.maps.get(n)
          if (m) await this.project.saveMap(m)
        }
      })
      .then(
        () => this.setStatus(this.pending.size ? 'pending' : 'saved'),
        (err: Error) => {
          for (const n of names) this.pending.add(n)
          this.setStatus('error')
          toast(`Could not save: ${err.message}`)
        },
      )
    return this.chain
  }

  private setStatus(s: 'saved' | 'pending' | 'saving' | 'error') {
    this.status.dataset.status = s
    this.status.textContent = { saved: 'Saved', pending: 'Edited', saving: 'Saving…', error: 'Error' }[s]
  }

  // --- Maps -----------------------------------------------------------------

  private nameError(name: string, current?: string) {
    if (!NAME_RE.test(name)) return 'Name: lowercase letters, digits, “-” and “_” (e.g. town).'
    if (name !== current && this.world.maps.has(name)) return 'A map with this name already exists.'
    return null
  }

  private uniqueName(base: string) {
    if (!this.world.maps.has(base)) return base
    for (let i = 2; ; i++) if (!this.world.maps.has(`${base}${i}`)) return `${base}${i}`
  }

  /** A new map, one screen big, in free space near the middle of the view. */
  async newMap() {
    const input = h('input', { type: 'text', value: this.uniqueName('map'), autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const { w, h: hh } = this.world.minCells
    const body = h('div', { className: 'fields' },
      h('label', {}, 'Name', input),
      h('p', { className: 'muted' }, `It starts one screen big (${w} × ${hh} tiles). Drag its corners with the Move tool (V) to make it bigger.`))
    queueMicrotask(() => input.select())
    const res = await openDialog('New map', body, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Create', value: 'ok', kind: 'primary' },
    ], () => this.nameError(input.value.trim()))
    if (res !== 'ok') return
    const name = input.value.trim()
    const spot = this.world.freeSpot(w, hh, this.view.center())
    const map = newMap(name, spot.x, spot.y, w, hh)
    try {
      await this.project.saveMap(map)
    } catch (err) {
      return toast(`Could not create: ${(err as Error).message}`)
    }
    this.world.addMap(map)
    this.renderMaps()
    this.view.focus(name)
  }

  private async renameMap(from: string) {
    const input = h('input', { type: 'text', value: from, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    queueMicrotask(() => input.select())
    const res = await openDialog('Rename map', h('div', { className: 'fields' }, h('label', {}, 'Name', input)), [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Rename', value: 'ok', kind: 'primary' },
    ], () => this.nameError(input.value.trim(), from))
    const to = input.value.trim()
    if (res !== 'ok' || to === from || !this.world.maps.has(from)) return
    await this.flush()
    try {
      await this.project.saveMap({ ...this.world.maps.get(from)!, name: to })
      await this.project.deleteMap(from)
    } catch (err) {
      return toast(`Could not rename: ${(err as Error).message}`)
    }
    this.world.renameMap(from, to)
    this.renderMaps()
  }

  private async deleteMap(name: string) {
    const ok = await confirmDialog('Delete map', `“${name}” (maps/${name}.json) will be deleted from the game folder. Git keeps the history of versions already committed.`, 'Delete', true)
    if (!ok || !this.world.maps.has(name)) return
    this.pending.delete(name)
    try {
      await this.project.deleteMap(name)
    } catch (err) {
      return toast(`Could not delete: ${(err as Error).message}`)
    }
    this.world.removeMap(name)
    this.renderMaps()
  }

  // --- Interface ------------------------------------------------------------

  private bindKeys(input: { setSpace(down: boolean): void }) {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement
      if (currentPage() !== 'world' || document.body.dataset.playing === 'true' || target.closest('input, select, textarea, dialog')) return
      const k = e.key.toLowerCase()
      if (e.key === ' ') {
        input.setSpace(true)
        e.preventDefault()
        return
      }
      if (e.metaKey || e.ctrlKey) {
        if (k === 'z') e.shiftKey ? this.world.redo() : this.world.undo()
        else if (k === 'y') this.world.redo()
        else if (k === 's') void this.flush()
        else return
        e.preventDefault()
        return
      }
      if (e.altKey || e.shiftKey) return
      if (TOOL_KEYS[k]) this.world.setTool(TOOL_KEYS[k])
      else if (e.key === '0') this.view.fit()
      else if (e.key === 'Escape') goTo('editor')
      else return
      e.preventDefault()
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') input.setSpace(false)
    })
  }

  private render() {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-world-tool]')) {
      el.classList.toggle('active', el.dataset.worldTool === this.world.tool)
    }
    for (const el of this.mapList.querySelectorAll<HTMLElement>('.sprite-item')) {
      el.classList.toggle('active', el.dataset.name === this.world.active)
    }
    // Tiles picked from another tileset (eyedropper on the map): show that one.
    const b = this.world.brush
    if (b && b.tileset !== this.shown && this.view.sheet(b.tileset)) {
      this.shown = b.tileset
      this.renderPickers()
      return
    }
    this.drawPickerSelections()
  }

  private renderMaps() {
    this.mapList.replaceChildren()
    for (const name of [...this.world.maps.keys()].sort()) {
      const menu = createActionsMenu(`Options for ${name}`, [
        { label: 'Rename', run: () => void this.renameMap(name) },
        { label: 'Delete', run: () => void this.deleteMap(name), danger: true },
      ])
      this.mapList.append(
        h('div', { className: 'sprite-row' },
          h('button', {
            className: 'sprite-item',
            'data-name': name,
            onclick: () => {
              this.world.active = name
              this.view.focus(name)
              this.world.emit()
            },
          }, h('span', { className: 'sprite-label' }, name)),
          menu.el),
      )
    }
    if (!this.world.maps.size) this.mapList.append(h('p', { className: 'muted' }, 'No maps yet: + makes one.'))
    this.render()
  }

  /** The picture of the tileset shown, at the panel's width, to pick tiles from, and the
   *  list to switch to another one. */
  private renderPickers() {
    this.pickers.replaceChildren()
    const names = [...this.app.editor.sprites.keys()].filter(isTileset).map(tilesetName).sort()
    this.tilesetSelect.replaceChildren(...names.map((n) => h('option', { value: n }, n)))
    this.tilesetSelect.hidden = !names.length
    if (!names.length) {
      this.shown = null
      this.pickers.append(h('p', { className: 'muted' }, 'No tilesets yet. Make one on the board, in the Tilesets panel.'))
      return
    }
    // The one shown stays shown; otherwise the brush's, otherwise the first.
    const brush = this.world.brush?.tileset
    const name = this.shown && names.includes(this.shown) ? this.shown : brush && names.includes(brush) ? brush : names[0]
    this.shown = name
    this.tilesetSelect.value = name
    const sheet = this.view.sheet(name)
    if (!sheet) return
    const t = this.world.tileSize
    const canvas = h('canvas', { className: 'world-picker', 'data-tileset': name })
    let start: { col: number; row: number } | null = null
    const cellOf = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const cols = Math.floor(sheet.width / t)
      const rows = Math.floor(sheet.height / t)
      return {
        col: Math.max(0, Math.min(cols - 1, Math.floor(((e.clientX - r.left) / r.width) * cols))),
        row: Math.max(0, Math.min(rows - 1, Math.floor(((e.clientY - r.top) / r.height) * rows))),
      }
    }
    const pick = (a: { col: number; row: number }, b: { col: number; row: number }) =>
      this.world.setBrush({ tileset: name, col: Math.min(a.col, b.col), row: Math.min(a.row, b.row), w: Math.abs(a.col - b.col) + 1, h: Math.abs(a.row - b.row) + 1 })
    canvas.addEventListener('pointerdown', (e) => {
      start = cellOf(e)
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // Pointer already released: not important.
      }
      pick(start, start)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (start) pick(start, cellOf(e))
    })
    const end = () => (start = null)
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    this.pickers.append(canvas)
    this.fitPickers()
  }

  /** Sizes the tileset pictures to the panel's whole width, then redraws them. The canvas
   *  is backed by exactly one pixel per screen pixel and drawn without smoothing, so the
   *  pixels stay crisp at any scale: some are one screen pixel wider than others, which
   *  only shows at very small scales, where a whole-number scale would leave a wide gap. */
  private fitPickers() {
    const dpr = window.devicePixelRatio || 1
    const width = Math.floor(this.pickers.clientWidth * dpr)
    if (!width) return // Page hidden: fitted when it shows (the panel is observed).
    for (const canvas of this.pickers.querySelectorAll<HTMLCanvasElement>('canvas')) {
      const sheet = this.view.sheet(canvas.dataset.tileset!)
      if (!sheet) continue
      canvas.width = width
      canvas.height = Math.round((sheet.height * width) / sheet.width)
      canvas.style.width = `${canvas.width / dpr}px`
      canvas.style.height = `${canvas.height / dpr}px`
    }
    this.drawPickerSelections()
  }

  /** Redraws the tileset pictures, with their grid and the tiles picked. */
  private drawPickerSelections() {
    const t = this.world.tileSize
    const b = this.world.brush
    for (const canvas of this.pickers.querySelectorAll<HTMLCanvasElement>('canvas')) {
      const name = canvas.dataset.tileset!
      const sheet = this.view.sheet(name)
      if (!sheet) continue
      const ctx = canvas.getContext('2d')!
      const k = canvas.width / sheet.width
      const px = (v: number) => Math.round(v * k)
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(sheet, 0, 0, canvas.width, canvas.height)
      const lw = Math.max(1, Math.round(window.devicePixelRatio || 1))
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      for (let x = t; x < sheet.width; x += t) ctx.fillRect(px(x), 0, lw, canvas.height)
      for (let y = t; y < sheet.height; y += t) ctx.fillRect(0, px(y), canvas.width, lw)
      if (b && b.tileset === name) {
        for (const [color, inset] of [['#000', 0], ['#fff', lw]] as const) {
          ctx.strokeStyle = color
          ctx.lineWidth = lw
          const x0 = px(b.col * t), y0 = px(b.row * t)
          const x1 = px((b.col + b.w) * t), y1 = px((b.row + b.h) * t)
          ctx.strokeRect(x0 + lw / 2 + inset, y0 + lw / 2 + inset, x1 - x0 - lw - 2 * inset, y1 - y0 - lw - 2 * inset)
        }
      }
    }
  }
}

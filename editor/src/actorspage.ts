// The Actors page (#actors), between Pixels and World: what each actor is for every actor
// of its kind, beyond its code. On the left, the game's actors (its actor files); in the
// middle, the one picked, drawn large on the pixel grid by its own `draw()`, its feet marked
// with a cross; on the right, its variables, the box first. Selecting the box shows it on
// the actor, with handles: drag an edge or a corner to resize it, its inside to move it,
// anywhere else to draw a new one. Otherwise the box is not drawn and a drag does nothing:
// a stray touch on the iPad cannot redraw it. What is set here is saved in
// actors/<name>.json (see actors.ts).
//
// It is a page of its own rather than a mode of the World page: what an actor is, is the
// same wherever it is placed, so it is drawn on the actor, not checked on a map. What one
// placed actor does differently is set on the World page.

import type { App } from './app'
import { ActorFiles, boxFromDrag, boxHandle, boxWhenOn, dragBox, fileLayers, resolve, staleNames, type Cell, type Handle } from './actors'
import { actorThumb, loadActorKinds, type ActorKind, type ActorKinds } from './actortypes'
import { h, toast } from './dialog'
import { Inspector } from './inspector'
import { createEditorSwitch, createMenu, currentPage, goTo, onPage } from './menu'
import { isPlaying } from './play'
import type { Project } from './project'
import type { Box } from '../../runtime/collision'
import { icon } from './icons'

/** Room left around the actor, its box and its feet, in game pixels: to draw a box past it. */
const MARGIN = 6
/** Pixel lines show from this many screen pixels per game pixel up. */
const GRID_FROM = 6
/** The box, red like the walls of tilesets, seen through. */
const BOX_FILL = 'rgba(255, 77, 109, 0.4)'
/** How far from an edge of the box still holds it, and the size of its handles, in screen pixels (CSS). */
const REACH = 8
const HANDLE = 7
/** The cursor over each part of the box. */
const CURSORS: Record<Handle, string> = {
  move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
}

/** The part of the actor's surroundings shown, in game pixels relative to its feet. */
interface Region {
  x: number
  y: number
  w: number
  h: number
}

export class ActorsPage {
  /** Every actor file's values: the world page reads them too, as they are edited. */
  readonly files = new ActorFiles()
  private readonly root: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly status: HTMLElement
  private readonly list: HTMLElement
  private readonly search: HTMLInputElement
  private readonly variables: HTMLElement
  private readonly inspector = new Inspector()
  private kinds: ActorKinds | null = null
  /** The actor shown. */
  private selected: string | null = null
  /** The actor whose variables the inspector shows, to keep its box selected when read again. */
  private shown: string | null = null
  private region: Region = { x: -8, y: -16, w: 16, h: 20 }
  /** Screen pixels per game pixel, and where the region's top left is on the canvas. */
  private scale = 1
  private ox = 0
  private oy = 0
  /** The box being drawn, moved or resized, while the pointer is down. */
  private drag: { handle: Handle | null; from: { x: number; y: number }; start: Box | null; box: Box; moved: boolean } | null = null
  private reading = false
  /** Actor files changed and not saved yet. */
  private readonly pending = new Set<string>()
  /** A value other than the box was saved: the pictures may have changed. */
  private redraw = false
  private timer = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly project: Project,
    private readonly app: App,
  ) {
    this.canvas = h('canvas', { className: 'world-canvas actors-canvas' })
    this.status = h('span', { className: 'save-status', 'data-status': 'saved' }, 'Saved')
    this.list = h('div', { className: 'world-list' })
    this.variables = h('section', { className: 'actors-variables' },
      h('div', { className: 'panel-head' }, h('h2', {}, 'Variables')),
      this.inspector.root)
    this.search = h('input', {
      type: 'search',
      className: 'world-search',
      placeholder: 'Search',
      'aria-label': 'Search actors',
      autocapitalize: 'off',
      autocomplete: 'off',
      spellcheck: false,
      oninput: () => this.filter(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        this.search.value = ''
        this.filter()
        this.search.blur()
      },
    })
    this.root = h('div', { id: 'actors-page' },
      h('header', { className: 'page-bar' },
        createMenu(),
        createEditorSwitch(),
        h('span', { className: 'spacer' }),
        this.status,
        this.app.createSyncButton(),
        h('button', { type: 'button', className: 'run-game', title: 'Play the game (⌘↵)', html: `${icon('play')}<span>Play</span>`, onclick: () => this.app.play() })),
      h('div', { className: 'actors-body' },
        h('aside', { className: 'world-side actors-list' },
          h('section', { className: 'world-actors' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Actors')),
            this.search,
            this.list)),
        h('main', { className: 'world-stage' }, this.canvas),
        h('aside', { className: 'world-side' }, this.variables)))
    document.body.append(this.root)

    this.files.onEdit = (name) => {
      this.pending.add(name)
      this.schedule()
      this.renderSide()
      this.frame()
      this.fit()
    }
    this.inspector.onSet = (name, value) => {
      if (!this.selected) return
      this.files.set(this.selected, name, value)
      // The box does not change the picture: no need to run the code again.
      if (name !== 'box') this.redraw = true
    }
    this.inspector.onSelect = () => {
      this.drag = null
      this.draw()
    }
    new ResizeObserver(() => this.fit()).observe(this.canvas)
    this.bindPointer()
    this.bindKeys()

    const before = app.savePages
    app.savePages = async () => {
      await before()
      await this.flush()
    }
    window.addEventListener('beforeunload', (e) => {
      if (this.pending.size) e.preventDefault()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush()
    })
    // The code is written in another app: coming back may bring new actors or pictures.
    window.addEventListener('focus', () => {
      if (currentPage() === 'actors') void this.readActors()
    })
  }

  /** Reads the actor files, then follows the page. */
  async load() {
    try {
      for (const [name, values] of await this.project.loadActorFiles()) this.files.files.set(name, values)
    } catch (err) {
      toast((err as Error).message)
    }
    onPage((page) => {
      // Leaving the page saves: the world page and the game read the files.
      if (page !== 'actors') return void this.flush()
      this.fit()
      void this.readActors()
    })
  }

  // --- Saving ---------------------------------------------------------------

  private schedule() {
    this.setStatus('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
  }

  /** Saves the actor files changed, right away. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.pending.size) return this.chain
    const names = [...this.pending]
    this.pending.clear()
    const redraw = this.redraw
    this.redraw = false
    this.setStatus('saving')
    this.chain = this.chain
      .then(async () => {
        for (const name of names) await this.project.saveActorFile(name, this.files.values(name))
      })
      .then(
        () => {
          this.setStatus(this.pending.size ? 'pending' : 'saved')
          // A variable may change how the actor looks: draw it again, as saved.
          if (redraw && currentPage() === 'actors') void this.readActors()
        },
        (err: Error) => {
          for (const name of names) this.pending.add(name)
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

  // --- The actors -----------------------------------------------------------

  /** Runs the game's code to know its actors and draw them. */
  private async readActors() {
    if (this.reading) return
    this.reading = true
    try {
      await this.app.saveSprites()
      await this.flush()
      const kinds = await loadActorKinds(this.project)
      if (!kinds) return
      this.kinds = kinds
    } catch (err) {
      this.kinds = { error: (err as Error).message }
    } finally {
      this.reading = false
    }
    const names = this.names()
    if (!this.selected || !names.includes(this.selected)) this.selected = names[0] ?? null
    this.renderList()
    this.select(this.selected)
  }

  private names() {
    return this.kinds && 'kinds' in this.kinds ? this.kinds.kinds.map((k) => k.name) : []
  }

  private kind(): ActorKind | null {
    return (this.kinds && 'kinds' in this.kinds && this.kinds.kinds.find((k) => k.name === this.selected)) || null
  }

  private select(name: string | null) {
    // Another actor: its box is not selected. The same one, read again (coming back to the
    // app, after a save), keeps it.
    if (name !== this.shown) this.inspector.select(null)
    this.shown = name
    this.selected = name
    this.drag = null
    for (const el of this.list.querySelectorAll<HTMLElement>('.sprite-item')) el.classList.toggle('active', el.dataset.name === name)
    this.frame()
    this.renderSide()
    this.fit()
  }

  private renderList() {
    const k = this.kinds
    const note = (...text: (string | Node)[]) => h('p', { className: 'muted' }, ...text)
    this.list.replaceChildren()
    if (!k) return
    if ('missing' in k) {
      this.list.append(note('The game has no actors yet. Write ', h('code', {}, 'actors/hero.ts'), ', a class that extends Actor as its default export: it appears here.'))
      return
    }
    if ('error' in k) {
      this.list.append(note("The game's code does not run, so its actors cannot be shown:"), h('pre', { className: 'world-error' }, k.error))
      return
    }
    if (!k.kinds.length) {
      this.list.append(note('Write ', h('code', {}, 'actors/hero.ts'), ', a class that extends Actor as its default export: it appears here.'))
      return
    }
    for (const kind of k.kinds) {
      this.list.append(
        h('div', { className: 'sprite-row', 'data-row': kind.name },
          h('button', {
            className: 'sprite-item',
            'data-name': kind.name,
            title: kind.error ? `${kind.name}: ${kind.error}` : kind.name,
            onclick: () => this.select(kind.name),
          }, actorThumb(kind.picture), h('span', { className: 'sprite-label' }, kind.name))),
      )
    }
    this.filter()
  }

  private filter() {
    const q = this.search.value.trim().toLowerCase()
    for (const row of this.list.querySelectorAll<HTMLElement>('[data-row]')) row.hidden = !row.dataset.row!.includes(q)
  }

  // --- Its values -------------------------------------------------------------

  /** The box as the game will see it (null: none). */
  private box(): Box | null {
    const kind = this.kind()
    const variable = kind?.variables.find((v) => v.name === 'box')
    if (!kind || !variable) return null
    return resolve('box', variable.value, fileLayers(kind, this.files)).value as Box | null
  }

  /** Is the box selected in the inspector: drawn on the actor, to edit there? */
  private editing() {
    return this.inspector.selected === 'box' && !!this.kind()
  }

  /** Sets the box in this actor's file (null: none), or clears it (undefined): inherited. */
  private setBox(box: Box | null | undefined) {
    if (this.selected) this.files.set(this.selected, 'box', box)
  }

  /** The right panel: the variables, the box first, as the game will see them. */
  private renderSide() {
    const kind = this.kind()
    // Shown even with an error, when the code ran: the error may be a value to fix here.
    this.variables.hidden = !kind || (kind.error !== undefined && !kind.variables.length)
    if (!kind) return this.inspector.show([])
    const stale = staleNames(this.files.values(kind.name), kind.variables)
    if (!kind.variables.length && !stale.length) {
      this.inspector.show([])
      this.inspector.root.replaceChildren(h('p', { className: 'muted actors-info' }, 'No variables'))
      return
    }
    const layers = fileLayers(kind, this.files)
    this.inspector.show(kind.variables.map((variable) => {
      const r = resolve(variable.name, variable.value, layers)
      const row = { variable, value: r.value, from: r.from, own: r.from === kind.name }
      if (variable.kind !== 'box') return row
      const inherited = resolve('box', variable.value, layers.slice(0, -1)).value as Box | null
      return { ...row, whenOn: boxWhenOn(inherited, kind.picture) }
    }), stale)
  }

  // --- The actor, large -----------------------------------------------------

  /** Chooses what is shown: the actor's picture, its box and its feet, with room around. */
  private frame() {
    const p = this.kind()?.picture
    const box = this.box()
    let x0 = 0, y0 = 0, x1 = 1, y1 = 1
    const add = (x: number, y: number, w: number, hh: number) => {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x + w)
      y1 = Math.max(y1, y + hh)
    }
    if (p) add(p.x, p.y, p.w, p.h)
    if (box) add(box.x, box.y, box.width, box.height)
    // An actor that draws nothing still gets room for a box.
    if (!p && !box) add(-8, -16, 16, 16)
    this.region = { x: x0 - MARGIN, y: y0 - MARGIN, w: x1 - x0 + 2 * MARGIN, h: y1 - y0 + 2 * MARGIN }
  }

  /** Sizes the canvas to the stage, at a whole scale, the region centered. */
  private fit() {
    const dpr = window.devicePixelRatio || 1
    const w = Math.floor(this.canvas.clientWidth * dpr)
    const hh = Math.floor(this.canvas.clientHeight * dpr)
    if (!w || !hh) return // Page hidden: fitted when it shows.
    this.canvas.width = w
    this.canvas.height = hh
    const r = this.region
    this.scale = Math.max(1, Math.floor(Math.min((w * 0.9) / r.w, (hh * 0.9) / r.h)))
    this.ox = Math.round((w - r.w * this.scale) / 2)
    this.oy = Math.round((hh - r.h * this.scale) / 2)
    this.draw()
  }

  /** The point under the pointer, in game pixels (fractional) relative to the feet. */
  private pointAt(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    return {
      x: ((e.clientX - rect.left) * dpr - this.ox) / this.scale + this.region.x,
      y: ((e.clientY - rect.top) * dpr - this.oy) / this.scale + this.region.y,
    }
  }

  /** The pixel under the pointer, relative to the feet, kept inside the region. */
  private cellAt(e: PointerEvent): Cell {
    const p = this.pointAt(e)
    const r = this.region
    return { x: Math.max(r.x, Math.min(r.x + r.w - 1, Math.floor(p.x))), y: Math.max(r.y, Math.min(r.y + r.h - 1, Math.floor(p.y))) }
  }

  /** The part of the box under the pointer, if it is being edited. */
  private handleAt(e: PointerEvent): Handle | null {
    const box = this.box()
    if (!box) return null
    const reach = (REACH * (window.devicePixelRatio || 1)) / this.scale
    return boxHandle(box, this.pointAt(e), reach)
  }

  private bindPointer() {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      // A tap on the actor leaves the row being worked on.
      if (!this.editing()) return this.inspector.select(null)
      const handle = this.handleAt(e)
      const start = this.box()
      const from = handle ? this.pointAt(e) : this.cellAt(e)
      this.drag = { handle, from, start, box: handle && start ? start : boxFromDrag(from, from), moved: false }
      try {
        c.setPointerCapture(e.pointerId)
      } catch {
        // Pointer already released: not important.
      }
      this.draw()
    })
    c.addEventListener('pointermove', (e) => {
      const d = this.drag
      if (!d) {
        const handle = this.editing() ? this.handleAt(e) : null
        c.style.cursor = handle ? CURSORS[handle] : ''
        return
      }
      d.moved = true
      if (d.handle && d.start) {
        const p = this.pointAt(e)
        d.box = dragBox(d.start, d.handle, p.x - d.from.x, p.y - d.from.y)
      } else d.box = boxFromDrag(d.from, this.cellAt(e))
      this.draw()
    })
    c.addEventListener('pointerup', () => {
      const d = this.drag
      this.drag = null
      // A tap away from the box, without a drag, leaves it rather than drawing a 1 × 1 box.
      if (d && !d.handle && !d.moved) this.inspector.select(null)
      else if (d) this.setBox(d.box)
      this.draw()
    })
    c.addEventListener('pointercancel', () => {
      this.drag = null
      this.draw()
    })
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement
      if (currentPage() !== 'actors' || isPlaying() || target.closest('input, select, textarea, dialog')) return
      const k = e.key.toLowerCase()
      if (e.metaKey || e.ctrlKey) {
        if (k === 'z') e.shiftKey ? this.files.redo() : this.files.undo()
        else if (k === 'y') this.files.redo()
        else if (k === 's') void this.flush()
        else return
      } else if (this.editing()) {
        // The box selected: the keys edit it, as on the canvas.
        const box = this.box()
        const n = e.shiftKey ? 10 : 1
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }
        if (e.key === 'Escape') this.inspector.select(null)
        else if (e.key === 'Delete' || e.key === 'Backspace') this.setBox(undefined)
        else if (arrows[e.key] && box) this.setBox(dragBox(box, 'move', ...arrows[e.key]))
        else return
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.step(e.key === 'ArrowUp' ? -1 : 1)
      else if (e.key === 'Escape' && this.inspector.selected) this.inspector.select(null)
      else if (e.key === 'Escape') goTo('editor')
      else return
      e.preventDefault()
    })
  }

  /** The previous or next actor in the list (among those the search shows). */
  private step(d: number) {
    const names = [...this.list.querySelectorAll<HTMLElement>('[data-row]:not([hidden]) .sprite-item')].map((el) => el.dataset.name!)
    if (!names.length) return
    const i = this.selected ? names.indexOf(this.selected) : -1
    this.select(names[Math.max(0, Math.min(names.length - 1, i + d))])
  }

  private draw() {
    const ctx = this.canvas.getContext('2d')
    if (!ctx || !this.canvas.width) return
    const { width: W, height: H } = this.canvas
    const s = this.scale
    const r = this.region
    const X = (x: number) => this.ox + (x - r.x) * s
    const Y = (y: number) => this.oy + (y - r.y) * s
    const dpr = window.devicePixelRatio || 1
    const lw = Math.max(1, Math.round(dpr))
    // Drawing a box only while it is selected: the crosshair says so.
    this.canvas.classList.toggle('editing', this.editing())
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, H)
    if (!this.kind()) return

    ctx.fillStyle = this.app.view.boardColor
    ctx.fillRect(X(r.x), Y(r.y), r.w * s, r.h * s)
    const p = this.kind()?.picture
    if (p) ctx.drawImage(p.image, X(p.x), Y(p.y), p.w * s, p.h * s)

    if (s >= GRID_FROM) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      for (let x = r.x + 1; x < r.x + r.w; x++) ctx.fillRect(X(x), Y(r.y), lw, r.h * s)
      for (let y = r.y + 1; y < r.y + r.h; y++) ctx.fillRect(X(r.x), Y(y), r.w * s, lw)
    }

    const box = this.editing() ? (this.drag?.box ?? this.box()) : null
    if (box) {
      const bx = X(box.x), by = Y(box.y), bw = box.width * s, bh = box.height * s
      ctx.fillStyle = BOX_FILL
      ctx.fillRect(bx, by, bw, bh)
      // Black, then white inside it: an edge that shows on any color of actor.
      ctx.lineWidth = lw
      for (const [color, inset] of [['#000', 0], ['#fff', lw]] as const) {
        ctx.strokeStyle = color
        ctx.strokeRect(bx + lw / 2 + inset, by + lw / 2 + inset, bw - lw - 2 * inset, bh - lw - 2 * inset)
      }
      // Handles at the corners and the middle of the edges, white with a dark edge.
      const hs = Math.round(HANDLE * dpr)
      for (const hx of [bx, bx + bw / 2, bx + bw]) {
        for (const hy of [by, by + bh / 2, by + bh]) {
          if (hx === bx + bw / 2 && hy === by + bh / 2) continue
          const x = Math.round(hx - hs / 2), y = Math.round(hy - hs / 2)
          ctx.fillStyle = '#000'
          ctx.fillRect(x - lw, y - lw, hs + 2 * lw, hs + 2 * lw)
          ctx.fillStyle = '#fff'
          ctx.fillRect(x, y, hs, hs)
        }
      }
    }

    // The feet: the actor's position, where its sprite's origin is drawn.
    const fx = X(0), fy = Y(0)
    const arm = Math.max(6 * lw, s)
    for (const [color, w] of [['rgba(0, 0, 0, 0.6)', 3 * lw], ['#fff', lw]] as const) {
      ctx.fillStyle = color
      ctx.fillRect(fx - arm, fy - w / 2, 2 * arm, w)
      ctx.fillRect(fx - w / 2, fy - arm, w, 2 * arm)
    }
  }
}

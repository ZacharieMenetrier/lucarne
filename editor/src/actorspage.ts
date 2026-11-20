// The Actors page (#actors), between Pixels and World: what each class of actors is in the
// world, beyond its code. For now, its box: picked in the list on the right, the actor is
// drawn large on the pixel grid, by its own `draw()`, its feet marked with a cross, and a
// drag over it draws its box. Boxes are saved in actors.json, by class name (see actors.ts).
//
// It is a page of its own rather than a mode of the World page: an actor's body is the
// same wherever it is placed, so it is drawn on the actor, not checked on a map.

import type { App } from './app'
import { ActorBoxes, boxFromDrag, type Cell } from './actors'
import { actorThumb, loadActorKinds, type ActorKind, type ActorKinds } from './actortypes'
import { h, toast } from './dialog'
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

/** The part of the actor's surroundings shown, in game pixels relative to its feet. */
interface Region {
  x: number
  y: number
  w: number
  h: number
}

export class ActorsPage {
  private readonly model = new ActorBoxes()
  private readonly root: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly status: HTMLElement
  private readonly list: HTMLElement
  private readonly search: HTMLInputElement
  private readonly info: HTMLElement
  private readonly remove: HTMLButtonElement
  private kinds: ActorKinds | null = null
  /** The class shown. */
  private selected: string | null = null
  private region: Region = { x: -8, y: -16, w: 16, h: 20 }
  /** Screen pixels per game pixel, and where the region's top left is on the canvas. */
  private scale = 1
  private ox = 0
  private oy = 0
  /** The box being drawn, while the pointer is down. */
  private drag: { from: Cell; box: Box } | null = null
  private reading = false
  private dirty = false
  private timer = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly project: Project,
    private readonly app: App,
  ) {
    this.canvas = h('canvas', { className: 'world-canvas actors-canvas' })
    this.status = h('span', { className: 'save-status', 'data-status': 'saved' }, 'Saved')
    this.list = h('div', { className: 'world-list' })
    this.info = h('p', { className: 'muted actors-info' })
    this.remove = h('button', {
      type: 'button',
      className: 'small',
      title: 'Remove the box (Delete)',
      onclick: () => this.removeBox(),
    }, 'Remove box')
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
        h('button', { type: 'button', className: 'run-game', title: 'Play the game (⌘↵)', html: `${icon('play')}<span>Play</span>`, onclick: () => this.app.play() })),
      h('div', { className: 'actors-body' },
        h('main', { className: 'world-stage' }, this.canvas),
        h('aside', { className: 'world-side' },
          h('section', { className: 'world-actors' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Actors')),
            this.search,
            this.list),
          h('section', { className: 'actors-box' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Box')),
            this.info,
            this.remove))))
    document.body.append(this.root)

    this.model.onEdit = () => {
      this.schedule()
      this.renderInfo()
      this.draw()
    }
    new ResizeObserver(() => this.fit()).observe(this.canvas)
    this.bindPointer()
    this.bindKeys()

    const before = app.beforePlay
    app.beforePlay = async () => {
      await before()
      await this.flush()
    }
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) e.preventDefault()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush()
    })
    // The code is written in another app: coming back may bring new classes or pictures.
    window.addEventListener('focus', () => {
      if (currentPage() === 'actors') void this.readActors()
    })
  }

  /** Reads actors.json, then follows the page. */
  async load() {
    try {
      for (const [name, box] of await this.project.loadActors()) this.model.boxes.set(name, box)
    } catch (err) {
      toast((err as Error).message)
    }
    onPage((page) => {
      if (page !== 'actors') return
      this.fit()
      void this.readActors()
    })
  }

  // --- Saving ---------------------------------------------------------------

  private schedule() {
    this.dirty = true
    this.setStatus('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
  }

  /** Saves actors.json, right away, if it changed. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.dirty) return this.chain
    this.dirty = false
    this.setStatus('saving')
    this.chain = this.chain
      .then(() => this.project.saveActors(this.model.boxes))
      .then(
        () => this.setStatus(this.dirty ? 'pending' : 'saved'),
        (err: Error) => {
          this.dirty = true
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

  // --- The classes ----------------------------------------------------------

  /** Runs the game's code to know its classes of actors and draw them. */
  private async readActors() {
    if (this.reading) return
    this.reading = true
    try {
      await this.app.saveSprites()
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
    this.selected = name
    this.drag = null
    for (const el of this.list.querySelectorAll<HTMLElement>('.sprite-item')) el.classList.toggle('active', el.dataset.name === name)
    this.frame()
    this.renderInfo()
    this.fit()
  }

  private renderList() {
    const k = this.kinds
    const note = (...text: (string | Node)[]) => h('p', { className: 'muted' }, ...text)
    this.list.replaceChildren()
    if (!k) return
    if ('missing' in k) {
      this.list.append(note('The game has no code yet. Write ', h('code', {}, 'code/main.ts'), ' and export a class that extends Actor: it appears here.'))
      return
    }
    if ('error' in k) {
      this.list.append(note("The game's code does not run, so its actors cannot be shown:"), h('pre', { className: 'world-error' }, k.error))
      return
    }
    if (!k.kinds.length) {
      this.list.append(note('Export a class that extends Actor from ', h('code', {}, 'code/main.ts'), ' to give it a box here.'))
      return
    }
    for (const kind of k.kinds) {
      this.list.append(
        h('div', { className: 'sprite-row', 'data-row': kind.name.toLowerCase() },
          h('button', {
            className: 'sprite-item',
            'data-name': kind.name,
            title: kind.error ? `${kind.name} could not be drawn: ${kind.error}` : kind.name,
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

  private renderInfo() {
    const name = this.selected
    const box = name ? this.model.get(name) : null
    this.remove.hidden = !box
    if (!name) this.info.textContent = 'Pick an actor to draw its box.'
    else if (box) this.info.textContent = `${box.width} × ${box.height} pixels, its top left at (${box.x}, ${box.y}) from the feet. Walls and the other actors' boxes stop it. Drag on it to draw it again.`
    else this.info.textContent = `${name} has no box: it goes through everything, and nothing bumps into it. Drag on it to draw one.`
  }

  private removeBox() {
    if (this.selected) this.model.set(this.selected, null)
  }

  // --- The actor, large -----------------------------------------------------

  /** Chooses what is shown: the actor's picture, its box and its feet, with room around. */
  private frame() {
    const p = this.kind()?.picture
    const box = this.selected ? this.model.get(this.selected) : null
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

  /** The pixel under the pointer, relative to the feet, kept inside the region. */
  private cellAt(e: PointerEvent): Cell {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const r = this.region
    const x = Math.floor(((e.clientX - rect.left) * dpr - this.ox) / this.scale) + r.x
    const y = Math.floor(((e.clientY - rect.top) * dpr - this.oy) / this.scale) + r.y
    return { x: Math.max(r.x, Math.min(r.x + r.w - 1, x)), y: Math.max(r.y, Math.min(r.y + r.h - 1, y)) }
  }

  private bindPointer() {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => {
      if (!this.selected || e.button !== 0) return
      const from = this.cellAt(e)
      this.drag = { from, box: boxFromDrag(from, from) }
      try {
        c.setPointerCapture(e.pointerId)
      } catch {
        // Pointer already released: not important.
      }
      this.draw()
    })
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return
      this.drag.box = boxFromDrag(this.drag.from, this.cellAt(e))
      this.draw()
    })
    c.addEventListener('pointerup', () => {
      const d = this.drag
      this.drag = null
      if (d && this.selected) this.model.set(this.selected, d.box)
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
        if (k === 'z') e.shiftKey ? this.model.redo() : this.model.undo()
        else if (k === 'y') this.model.redo()
        else if (k === 's') void this.flush()
        else return
      } else if (e.key === 'Delete' || e.key === 'Backspace') this.removeBox()
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.step(e.key === 'ArrowUp' ? -1 : 1)
      else if (e.key === 'Escape') goTo('editor')
      else return
      e.preventDefault()
    })
  }

  /** The previous or next class in the list (among those the search shows). */
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
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, H)
    if (!this.selected) return

    ctx.fillStyle = this.app.view.boardColor
    ctx.fillRect(X(r.x), Y(r.y), r.w * s, r.h * s)
    const p = this.kind()?.picture
    if (p) ctx.drawImage(p.image, X(p.x), Y(p.y), p.w * s, p.h * s)

    if (s >= GRID_FROM) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      for (let x = r.x + 1; x < r.x + r.w; x++) ctx.fillRect(X(x), Y(r.y), lw, r.h * s)
      for (let y = r.y + 1; y < r.y + r.h; y++) ctx.fillRect(X(r.x), Y(y), r.w * s, lw)
    }

    const box = this.drag?.box ?? this.model.get(this.selected)
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

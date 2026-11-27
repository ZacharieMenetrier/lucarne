// The world editor's page (#world): the whole world, every map at its place, and two
// modes, chosen with the switch on top of the tools: Maps (arrange the world) and Tiles
// (stamp tiles, picked in the tilesets: they are drawn on the board, with the pixel
// editor). The mode sets both the tools and the panel; the page remembers it.
//
// The Maps panel reads from the top down, like the Tiles one: what can be added (the
// game's actors, to place), what is there (each map, its actors listed under it, an actor
// that draws nothing too), and what is selected (its values). A click on a row selects
// that map or actor whatever the tool: the tool only says what a click on the maps does.

import type { App } from './app'
import { fileLayers, resolve, sameValue, staleNames, type ActorFiles } from './actors'
import { Inspector, type Row } from './inspector'
import { confirmDialog, h, openDialog, toast } from './dialog'
import { icon } from './icons'
import { attachInput } from './input'
import { newMap } from './map'
import { createActionsMenu, createEditorSwitch, createMenu, currentPage, goTo, onPage } from './menu'
import type { Project } from './project'
import { NAME_RE, isTileset, tilesetKey, tilesetName } from './sprite'
import { actorThumb, loadActorKinds, type ActorKind, type ActorKinds, type ActorPicture } from './actortypes'
import { MODE_TOOLS, World, modeOf, type WorldMode, type WorldTool } from './world'
import { WorldView } from './worldview'

const MODES: { id: WorldMode; label: string; key: string; icon: string }[] = [
  { id: 'maps', label: 'Maps', key: '1', icon: 'map' },
  { id: 'tiles', label: 'Tiles', key: '2', icon: 'grid' },
]
const TOOLS: Record<WorldTool, { label: string; key: string; icon: string }> = {
  tile: { label: 'Tile', key: 'B', icon: 'pencil' },
  eraser: { label: 'Eraser', key: 'E', icon: 'eraser' },
  picker: { label: 'Eyedropper', key: 'I', icon: 'picker' },
  select: { label: 'Select', key: 'V', icon: 'pointer' },
  place: { label: 'Place', key: 'P', icon: 'add' },
  remove: { label: 'Eraser', key: 'E', icon: 'eraser' },
  move: { label: 'Move map', key: 'M', icon: 'move' },
}
/** Where the page keeps the mode it was in (for this browser). */
const MODE_KEY = 'lucarne.world.mode'
/** Whether actors snap to half tiles: remembered by this browser, on until turned off. */
const SNAP_KEY = 'lucarne.world.snap'

export class WorldPage {
  readonly world = new World()
  private readonly view: WorldView
  private readonly root: HTMLElement
  private readonly status: HTMLElement
  private readonly mapList: HTMLElement
  private readonly pickers: HTMLElement
  private readonly tilesetsPanel: HTMLElement
  private readonly actorsPanel: HTMLElement
  private readonly mapsPanel: HTMLElement
  private readonly actorList: HTMLElement
  private readonly actorSearch: HTMLInputElement
  /** The actors selected on the maps: what they are, and their values. */
  private readonly selectedPanel: HTMLElement
  private readonly selectedTitle: HTMLElement
  private readonly selectedInfo: HTMLElement
  /** The maps folded in the list: their actors are not listed. */
  private readonly folded = new Set<string>()
  /** What the list of maps shows, to build it again only when that changes. */
  private treeKey = ''
  private readonly inspector = new Inspector()
  /** The game's actors, as its code was when last read. */
  private kinds: ActorKinds | null = null
  private byName = new Map<string, ActorKind>()
  private pictures = new Map<string, ActorPicture | null>()
  /** Chooses the tileset shown in the panel. */
  private readonly tilesetSelect: HTMLSelectElement
  private readonly tilesetSwitch: HTMLLabelElement
  private readonly tilesetLabel: HTMLSpanElement
  /** The tileset shown in the panel: one at a time, so that it gets the panel's whole width. */
  private shown: string | null = null
  private pending = new Set<string>()
  private timer = 0
  private chain: Promise<void> = Promise.resolve()
  private framed = false

  constructor(
    private readonly project: Project,
    private readonly app: App,
    /** The actor files' values, as the Actors page edits them: what placed actors inherit. */
    private readonly files: ActorFiles,
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
    // A quiet chip in the panel head: the native select lies invisible over it, so a click
    // still opens the system list (and keeps its 16px font, which stops iOS from zooming).
    this.tilesetLabel = h('span', { className: 'chip-select-label' })
    this.tilesetSwitch = h('label', { className: 'chip-select' },
      this.tilesetLabel, h('span', { className: 'chip-select-icon', html: icon('expand') }), this.tilesetSelect)
    this.actorSearch = h('input', {
      type: 'search',
      className: 'world-search',
      placeholder: 'Search',
      'aria-label': 'Search actors',
      autocapitalize: 'off',
      autocomplete: 'off',
      spellcheck: false,
      oninput: () => this.filterActors(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        this.actorSearch.value = ''
        this.filterActors()
        this.actorSearch.blur()
      },
    })
    const tools = h('nav', { className: 'world-tools', 'aria-label': 'Tools' },
      // The mode first: it says what the tools below work on.
      h('div', { className: 'mode-switch', role: 'radiogroup', 'aria-label': 'Mode' },
        ...MODES.map((m) => h('button', {
          type: 'button',
          role: 'radio',
          title: `${m.label} (${m.key})`,
          'aria-label': m.label,
          'data-world-mode': m.id,
          html: icon(m.icon),
          onclick: () => this.setMode(m.id),
        }))),
      ...(Object.keys(TOOLS) as WorldTool[]).map((id) => h('button', {
        className: 'tool',
        title: `${TOOLS[id].label} (${TOOLS[id].key})`,
        'aria-label': TOOLS[id].label,
        'data-world-tool': id,
        html: icon(TOOLS[id].icon),
        onclick: () => this.world.setTool(id),
      })))
    const button = (title: string, name: string, run: () => void, extra: Record<string, unknown> = {}) =>
      h('button', { type: 'button', className: 'icon', title, 'aria-label': title, html: icon(name), onclick: run, ...extra })
    this.root = h('div', { id: 'world-page' },
      h('header', { className: 'page-bar' },
        createMenu(),
        createEditorSwitch(),
        h('span', { className: 'spacer' }),
        this.status,
        this.app.createSyncButton(),
        h('button', { type: 'button', className: 'run-game', title: 'Play the game (⌘↵)', html: `${icon('play')}<span>Play</span>`, onclick: () => this.app.play() })),
      h('div', { className: 'world-body' },
        tools,
        h('main', { className: 'world-stage' }, canvas,
          h('div', { className: 'view-controls', role: 'toolbar', 'aria-label': 'View' },
            button('Show every map (0)', 'fit', () => this.view.fit()),
            this.snapButton = button('Snap actors to half tiles (off: by the pixel)', 'snap', () => this.toggleSnap(), { 'aria-pressed': 'true' }))),
        h('aside', { className: 'world-side' },
          // One panel per mode: what that mode's tools take from, with the whole height.
          this.tilesetsPanel = h('section', { className: 'world-tilesets' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Tilesets'), this.tilesetSwitch),
            this.pickers),
          this.actorsPanel = h('section', { className: 'world-actors', hidden: true },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Actors')),
            this.actorSearch,
            this.actorList = h('div', { className: 'world-list' })),
          this.mapsPanel = h('section', { className: 'world-maps', hidden: true },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Maps'),
              h('button', { type: 'button', className: 'small icon-btn', title: 'New map', 'aria-label': 'New map', html: icon('add'), onclick: () => void this.newMap() })),
            this.mapList),
          this.selectedPanel = h('section', { className: 'world-selected', hidden: true },
            h('div', { className: 'panel-head' }, this.selectedTitle = h('h2', {})),
            this.selectedInfo = h('p', { className: 'muted actors-info' }),
            this.inspector.root))))
    document.body.append(this.root)

    this.view = new WorldView(canvas, this.world, (name) => this.tilesetBitmap(name), () => this.app.view.boardColor, (actor) => this.pictureOf(actor))
    this.world.actorBounds = (actor) => {
      const p = this.pictures.get(actor)
      return p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null
    }
    this.world.actorFrame = (actor) => this.pictures.get(actor)?.frame ?? null
    this.inspector.onSet = (name, value) => this.world.setValue(name, value)
    this.world.onEdit = (name) => this.schedule(name)
    this.world.onMessage = toast
    this.world.subscribe(() => this.render())
    this.bindKeys(attachInput(canvas, this.view, this.world))
    this.world.snap = readSnap()
    this.world.setMode(readMode())

    app.mapsUsing = (tileset) => this.world.mapsUsing(tileset)
    app.onTilesetRenamed = async (from, to) => {
      for (const name of this.world.renameTileset(from, to)) this.pending.add(name)
      await this.flush()
    }
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
      if (currentPage() === 'world') void this.readActors()
    })
  }

  /** An actor's picture: undefined when the game has no such actor (or its code does not run). */
  private pictureOf(actor: string) {
    // Not read yet: no picture, but not missing either (a red frame would flash).
    if (!this.kinds) return null
    return this.pictures.has(actor) ? this.pictures.get(actor)! : undefined
  }

  private reading = false

  /** Runs the game's code to know its actors and draw them. */
  private async readActors() {
    if (this.reading) return
    this.reading = true
    try {
      await this.app.saveSprites()
      const kinds = await loadActorKinds(this.project)
      if (!kinds) return
      this.kinds = kinds
      this.byName = new Map('kinds' in kinds ? kinds.kinds.map((k) => [k.name, k]) : [])
      this.pictures = new Map([...this.byName].map(([name, k]) => [name, k.picture]))
      // The list of maps shows their pictures: built again with them.
      this.treeKey = ''
      this.renderActors()
      this.world.emit()
    } catch (err) {
      this.kinds = { error: (err as Error).message }
      this.byName = new Map()
      this.renderActors()
    } finally {
      this.reading = false
    }
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
      this.world.screen = { columns: this.project.settings.columns, rows: this.project.settings.rows }
      this.view.invalidate()
      this.renderPickers()
      this.world.emit()
      void this.readActors()
      if (!this.framed) requestAnimationFrame(() => this.view.fit())
      this.framed = true
    })
  }

  /** Every map's size, in game pixels (the resolution cannot grow beyond the smallest). */
  get mapSizes() {
    return [...this.world.maps.values()].map((m) => ({ name: m.name, width: m.width, height: m.height }))
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
      h('p', { className: 'muted' }, `It starts one screen big (${w} × ${hh} tiles). Drag its corners in the Maps mode (1) to make it bigger.`))
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
    if (res === 'ok') await this.renameMapTo(from, input.value.trim())
  }

  /** Renames a map, in the game folder too (an invalid name is said, and nothing changes). */
  private async renameMapTo(from: string, to: string) {
    if (to === from || !this.world.maps.has(from)) return
    const error = this.nameError(to, from)
    if (error) return toast(error)
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
        const actors = this.world.mode === 'maps'
        if (actors && k === 'c') this.world.copy()
        else if (actors && k === 'x') {
          this.world.copy()
          this.world.deleteSelection()
        } else if (actors && k === 'v') this.world.paste()
        else if (actors && k === 'd') this.world.duplicate()
        else if (actors && k === 'a') this.world.selectAll()
        else if (k === 'z') e.shiftKey ? this.world.redo() : this.world.undo()
        else if (k === 'y') this.world.redo()
        else if (k === 's') void this.flush()
        else return
        e.preventDefault()
        return
      }
      const w = this.world
      if (e.key.startsWith('Arrow') && w.mode === 'maps' && w.selection.size && !e.altKey && !e.metaKey && !e.ctrlKey) {
        // The step they snap to, or a pixel with snapping off; with Shift, a whole tile.
        const d = e.shiftKey ? w.tileSize : w.snap ? w.actorStep : 1
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        w.nudge(dx, dy)
        e.preventDefault()
        return
      }
      if (e.altKey || e.shiftKey) return
      const mode = MODES.find((m) => m.key === e.key)
      const tool = (MODE_TOOLS[w.mode] as WorldTool[]).find((t) => TOOLS[t].key.toLowerCase() === k)
        // A key of another mode's tool (B for the pencil) goes there; V means this mode's,
        // and E, this mode's eraser (the tiles' one from the Maps mode).
        ?? (Object.keys(TOOLS) as WorldTool[]).find((t) => TOOLS[t].key.toLowerCase() === k && k !== 'v')
      if (mode) this.setMode(mode.id)
      else if (tool) this.setTool(tool)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && w.mode === 'maps') {
        // A map selected is deleted as from its menu: asked first, it is a file.
        if (w.selectedMap) void this.deleteMap(w.selectedMap)
        else w.deleteSelection()
      }
      else if (e.key === '0') this.view.fit()
      else if (e.key === 'Escape') {
        if (w.mode === 'maps' && w.tool !== 'select') w.setTool('select')
        else if (w.mode === 'maps' && (w.selection.size || w.selectedMap)) w.deselect()
        else goTo('editor')
      } else return
      e.preventDefault()
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') input.setSpace(false)
      this.world.shift = e.shiftKey
    })
    // Shift adds to the selection: known at the moment of the click.
    window.addEventListener('keydown', (e) => (this.world.shift = e.shiftKey), true)
    window.addEventListener('pointerdown', (e) => (this.world.shift = e.shiftKey), true)
    window.addEventListener('blur', () => (this.world.shift = false))
  }

  private snapButton!: HTMLButtonElement

  private toggleSnap() {
    this.world.snap = !this.world.snap
    saveSnap(this.world.snap)
    toast(this.world.snap ? 'Actors snap to half tiles' : 'Actors go anywhere, by the pixel')
    this.world.emit()
  }

  private render() {
    // Only actors snap: the toggle shows in Maps mode.
    this.snapButton.hidden = this.world.mode !== 'maps'
    this.snapButton.classList.toggle('active', this.world.snap)
    this.snapButton.setAttribute('aria-pressed', String(this.world.snap))
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-world-tool]')) {
      el.classList.toggle('active', el.dataset.worldTool === this.world.tool)
    }
    const mode = this.world.mode
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-world-tool]')) {
      el.hidden = modeOf(el.dataset.worldTool as WorldTool) !== mode
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-world-mode]')) {
      const on = el.dataset.worldMode === mode
      el.classList.toggle('active', on)
      el.setAttribute('aria-checked', String(on))
    }
    const panels: [HTMLElement, WorldMode][] = [[this.tilesetsPanel, 'tiles'], [this.actorsPanel, 'maps'], [this.mapsPanel, 'maps']]
    for (const [panel, m] of panels) {
      if (panel.hidden !== (m !== mode)) {
        panel.hidden = m !== mode
        if (m === 'tiles' && m === mode) this.fitPickers()
      }
    }
    for (const el of this.actorList.querySelectorAll<HTMLElement>('.sprite-item')) {
      el.classList.toggle('active', mode === 'maps' && this.world.tool === 'place' && el.dataset.name === this.world.placing)
    }
    for (const el of this.actorList.querySelectorAll<HTMLElement>('[data-count]')) {
      const n = this.world.countOf(el.dataset.count!)
      el.textContent = n ? String(n) : ''
      el.hidden = n === 0
    }
    this.renderTree()
    this.renderSelected()
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
    this.treeKey = ''
    this.render()
  }

  /**
   * The list of maps, each with its actors under it (unless folded), in the order the game
   * draws them. Built again only when what it lists changes; the selection is marked on
   * every render.
   */
  private renderTree() {
    const w = this.world
    const names = [...w.maps.keys()].sort()
    const key = names.map((n) => `${n}${this.folded.has(n) ? '-' : '+'}:${w.maps.get(n)!.actors.map((t) => t.actor).join(',')}`).join('|')
    if (key !== this.treeKey) {
      this.treeKey = key
      this.mapList.replaceChildren()
      for (const name of names) {
        const map = w.maps.get(name)!
        const folded = this.folded.has(name)
        const menu = createActionsMenu(`Options for ${name}`, [
          { label: 'Rename', run: () => void this.renameMap(name) },
          { label: 'Delete', run: () => void this.deleteMap(name), danger: true },
        ])
        this.mapList.append(
          h('div', { className: 'tree-row tree-map', 'data-map': name },
            h('button', {
              type: 'button',
              className: `tree-fold${folded ? ' folded' : ''}`,
              title: folded ? 'Show its actors' : 'Hide its actors',
              'aria-label': folded ? `Show the actors of ${name}` : `Hide the actors of ${name}`,
              'aria-expanded': String(!folded),
              hidden: !map.actors.length,
              html: icon('expand'),
              onclick: () => {
                if (folded) this.folded.delete(name)
                else this.folded.add(name)
                this.render()
              },
            }),
            h('button', {
              type: 'button',
              className: 'tree-item',
              onclick: () => {
                w.selectMap(name)
                this.view.reveal(name)
              },
            }, h('span', { className: 'tree-label' }, name),
              h('span', { className: 'tree-count muted' }, folded && map.actors.length ? String(map.actors.length) : '')),
            menu.el))
        if (folded) continue
        map.actors.forEach((t, i) => {
          this.mapList.append(
            h('button', {
              type: 'button',
              className: 'tree-row tree-item tree-actor',
              'data-map': name,
              'data-index': String(i),
              onclick: () => {
                const placement = w.maps.get(name)?.actors[i]
                if (!placement) return
                // Shift adds to the selection, as on the maps.
                const base = w.shift ? [...w.selection] : []
                w.select(base.includes(placement) ? base.filter((x) => x !== placement) : [...base, placement])
                w.active = name
                this.view.reveal(name)
              },
            }, actorThumb(this.pictures.get(t.actor) ?? null), h('span', { className: 'tree-label' }, t.actor)))
        })
      }
      if (!w.maps.size) this.mapList.append(h('p', { className: 'muted' }, 'No maps yet: + makes one.'))
    }
    for (const el of this.mapList.querySelectorAll<HTMLElement>('.tree-map')) {
      el.classList.toggle('active', el.dataset.map === w.selectedMap)
    }
    for (const el of this.mapList.querySelectorAll<HTMLElement>('.tree-actor')) {
      const t = w.maps.get(el.dataset.map!)?.actors[Number(el.dataset.index)]
      el.classList.toggle('active', !!t && w.selection.has(t))
    }
  }

  /**
   * The inspector of the actors selected: their variables, as the game will see them, each
   * set here for these actors alone. Several actors are edited together when they are of the
   * same kind; a value they do not share shows as differing.
   */
  private renderSelected() {
    const w = this.world
    const placed = [...w.selection]
    // Only actors: a map has nothing to set here (it is renamed from its menu in the list,
    // resized by its corners), so selecting one shows no panel.
    this.selectedPanel.hidden = w.mode !== 'maps' || !placed.length
    if (this.selectedPanel.hidden) return
    const names = new Set(placed.map((t) => t.actor))
    const name = placed[0].actor
    const kind = this.byName.get(name)
    const count = placed.length > 1 ? `${placed.length} ${names.size > 1 ? 'actors' : `${name}s`}` : name
    this.selectedTitle.textContent = count
    this.selectedTitle.title = `A value set here is for ${placed.length > 1 ? 'these alone' : 'this one alone'}; the others come from actors/${name}.json or the code.`
    const info = (text: string) => {
      this.selectedInfo.textContent = text
      this.inspector.show([])
    }
    if (names.size > 1) return info('Of several kinds: select one kind to set values.')
    if (!kind) return info(`The game has no actors/${name}.ts.`)
    if (kind.error) return info(kind.error)
    const variables = kind.variables.filter((v) => v.kind !== 'box')
    const stale = [...new Set(placed.flatMap((t) => staleNames(t.values, kind.variables)))].sort()
    if (!variables.length && !stale.length) return info('No variables')
    this.selectedInfo.textContent = ''
    const files = fileLayers(kind, this.files)
    this.inspector.show(variables.map((variable): Row => {
      const each = placed.map((t) => resolve(variable.name, variable.value, [...files, { from: 'here', values: t.values }]))
      return {
        variable,
        value: each[0].value,
        from: each[0].from,
        own: each.some((r) => r.from === 'here'),
        mixed: each.some((r) => !sameValue(r.value, each[0].value)),
      }
    }), stale)
  }

  /** Shows the actors whose name holds what is typed in the search field. */
  private filterActors() {
    const q = this.actorSearch.value.trim().toLowerCase()
    for (const row of this.actorList.querySelectorAll<HTMLElement>('[data-row]')) row.hidden = !row.dataset.row!.includes(q)
  }

  private setMode(mode: WorldMode) {
    this.world.setMode(mode)
    saveMode(mode)
  }

  private setTool(tool: WorldTool) {
    this.world.setTool(tool)
    saveMode(this.world.mode)
  }

  /** The game's actors, to pick the one to place. */
  private renderActors() {
    const k = this.kinds
    const note = (...text: (string | Node)[]) => h('p', { className: 'muted' }, ...text)
    this.actorList.replaceChildren()
    if (!k) return
    if ('missing' in k) {
      this.actorList.append(note('The game has no actors yet. Write ', h('code', {}, 'actors/hero.ts'), ', a class that extends Actor as its default export: it appears here.'))
      return
    }
    if ('error' in k) {
      this.actorList.append(note("The game's code does not run, so its actors cannot be shown:"), h('pre', { className: 'world-error' }, k.error))
      return
    }
    if (!k.kinds.length) {
      this.actorList.append(note('Write ', h('code', {}, 'actors/hero.ts'), ', a class that extends Actor as its default export, to place it on the maps.'))
      return
    }
    for (const kind of k.kinds) {
      const thumb = actorThumb(kind.picture)
      this.actorList.append(
        h('div', { className: 'sprite-row', 'data-row': kind.name },
          h('button', {
            className: 'sprite-item',
            'data-name': kind.name,
            title: kind.error ? `${kind.name}: ${kind.error}` : `Place ${kind.name} (P)`,
            onclick: () => this.world.setPlacing(kind.name),
          }, thumb, h('span', { className: 'sprite-label' }, kind.name)),
          // How many are placed: a click selects them all, to find them or move them.
          h('button', {
            type: 'button',
            className: 'actor-count',
            'data-count': kind.name,
            title: `Select every ${kind.name}`,
            onclick: () => this.world.selectAllOf(kind.name),
          })),
      )
    }
    this.filterActors()
    this.render()
  }

  /** The picture of the tileset shown, at the panel's width, to pick tiles from, and the
   *  list to switch to another one. */
  private renderPickers() {
    this.pickers.replaceChildren()
    const names = [...this.app.editor.sprites.keys()].filter(isTileset).map(tilesetName).sort()
    this.tilesetSelect.replaceChildren(...names.map((n) => h('option', { value: n }, n)))
    this.tilesetSwitch.hidden = !names.length
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
    this.tilesetLabel.textContent = name
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

/** The mode the page was last in (Tiles the first time, or without storage). */
function readMode(): WorldMode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    // The Actors mode is part of Maps now.
    if (m === 'actors') return 'maps'
    if (m && MODES.some((x) => x.id === m)) return m as WorldMode
  } catch {
    // Private window, or storage blocked: the default mode.
  }
  return 'tiles'
}

function saveMode(mode: WorldMode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Not remembered, which is fine.
  }
}

function readSnap(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'off'
  } catch {
    return true
  }
}

function saveSnap(on: boolean) {
  try {
    if (on) localStorage.removeItem(SNAP_KEY)
    else localStorage.setItem(SNAP_KEY, 'off')
  } catch {
    // Not remembered, which is fine.
  }
}

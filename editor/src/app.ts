// The interface: toolbars, palette, sprite list, shortcuts, autosave.

import type { Bitmap } from './bitmap'
import { BOARD_GAP, findFreeSpot, shelfLayout } from './board'
import { colorToHex, hexToColor, isHex } from './color'
import { confirmDialog, h, openDialog, toast } from './dialog'
import { Editor, MAX_FPS, MIN_FPS, type ToolId } from './editor'
import { icon } from './icons'
import { isConfigured, loadSettings, syncWithGitHub, type Conflict, type Side } from './github'
import { fetchLospecPalette, lospecSlug, type LospecPalette } from './lospec'
import { createActionsMenu, createMenu, currentPage } from './menu'
import { BUNDLED_PALETTES, bundledColors } from './palettes'
import { attachInput } from './input'
import { PALETTE_WARNING, normalizeHex, type Project } from './project'
import { Player, isPlaying } from './play'
import { MAX_SIZE, NAME_RE, newSprite, type Sprite } from './sprite'
import { toImageData } from './png'
import { View } from './view'

const TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'picker', label: 'Eyedropper', key: 'I' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'rectFill', label: 'Filled rectangle', key: '⇧R' },
  { id: 'select', label: 'Select', key: 'M' },
  { id: 'origin', label: 'Origin', key: 'O' },
  { id: 'move', label: 'Move sprite', key: 'V' },
]

/** Tiles per palette row. A palette always holds whole rows. */
const PALETTE_COLS = 8

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ---------------------------------------------------------------------------
// Autosave

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

class Saver {
  status: SaveStatus = 'saved'
  private sprites = new Set<string>()
  private board = false
  private timer = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly project: Project,
    private readonly editor: Editor,
    private readonly onStatus: (s: SaveStatus) => void,
  ) {}

  private get dirty() {
    return this.sprites.size > 0 || this.board
  }

  get busy() {
    return this.dirty || this.status === 'saving'
  }

  sprite(name: string) {
    this.sprites.add(name)
    this.schedule()
  }

  boardMoved() {
    this.board = true
    this.schedule()
  }

  private schedule() {
    this.set('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
  }

  /** Saves pending changes right away. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.dirty) return this.chain
    const snapshots = [...this.sprites].map((n) => this.editor.snapshot(n)).filter((s): s is Sprite => s !== null)
    const board = this.board ? this.editor.boardFile() : null
    this.sprites.clear()
    this.board = false
    this.set('saving')
    this.chain = this.chain
      .then(async () => {
        for (const s of snapshots) await this.project.saveSprite(s)
        if (board) await this.project.saveBoard(board)
      })
      .then(
        () => this.set(this.dirty ? 'pending' : 'saved'),
        (err: Error) => {
          for (const s of snapshots) this.sprites.add(s.name)
          if (board) this.board = true
          this.set('error')
          toast(`Could not save: ${err.message}`)
        },
      )
    return this.chain
  }

  /** Drops pending changes to a sprite (deleted). */
  discard(name: string) {
    this.sprites.delete(name)
    if (!this.dirty) {
      clearTimeout(this.timer)
      this.set('saved')
    }
  }

  private set(s: SaveStatus) {
    this.status = s
    this.onStatus(s)
  }
}

// ---------------------------------------------------------------------------

export class App {
  readonly editor: Editor
  readonly view: View
  private readonly saver: Saver
  private spriteNames: string[] = []
  private thumbs = new Map<string, HTMLCanvasElement>()
  private thumbTimer = 0
  private staleThumbs = new Set<string>()
  private rememberedSprite: string | null = null
  private framesKey = ''
  /** A frame was just dragged: the click that follows must not select. */
  private frameDragged = false

  constructor(private readonly project: Project) {
    this.editor = new Editor(project.palette)
    this.view = new View($<HTMLCanvasElement>('canvas'), this.editor)
    try {
      this.view.showChecker = localStorage.getItem('lucarne.checker') === '1'
    } catch {}
    this.saver = new Saver(project, this.editor, (s) => this.renderStatus(s))
    this.editor.onEdit = (name) => {
      this.saver.sprite(name)
      this.scheduleThumb(name)
    }
    this.editor.onMoved = () => this.saver.boardMoved()
    this.editor.onReveal = (name) => this.view.reveal(name)
    this.editor.onMessage = toast
  }

  async start() {
    this.buildTopbar()
    this.buildTools()
    this.buildSelectionBar()
    this.buildFrames()
    this.bindKeys()
    $('empty-new').addEventListener('click', () => void this.newSprite())
    $('sprites-new').addEventListener('click', () => void this.newSprite())
    $('palette-edit').addEventListener('click', () => void this.editPalette())
    this.editor.subscribe(() => this.render())

    window.addEventListener('beforeunload', (e) => {
      if (this.saver.busy) e.preventDefault()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saver.flush()
    })

    // Message left by a sync that reloaded the page.
    try {
      const note = sessionStorage.getItem(SYNC_NOTE)
      if (note) {
        sessionStorage.removeItem(SYNC_NOTE)
        setTimeout(() => toast(note), 300)
      }
    } catch {}

    this.renderPalette()
    await this.loadBoard()
    const last = this.lastSprite
    this.editor.activate(last && this.spriteNames.includes(last) ? last : (this.spriteNames[0] ?? null))
    this.view.fit()
    this.render()
  }

  /** Loads every sprite and places it on the board. */
  private async loadBoard() {
    const [names, { placements, background, paletteRows }] = await Promise.all([this.project.listSprites(), this.project.loadBoard()])
    this.editor.background = background
    this.editor.paletteRows = paletteRows
    this.renderPalette()
    const sprites = await Promise.all(
      names.map((name) =>
        this.project.loadSprite(name).catch((err: Error) => {
          toast(err.message)
          return null
        }),
      ),
    )
    const unplaced: { name: string; w: number; h: number }[] = []
    for (const s of sprites) {
      if (!s) continue
      const p = placements.get(s.name)
      if (p) this.editor.addSprite(s, p.x, p.y)
      else unplaced.push({ name: s.name, w: s.meta.frameWidth, h: s.meta.frameHeight })
    }
    // Sprites with no position yet (first opening, files added by hand) go
    // in rows below the others.
    const b = this.editor.bounds()
    const origin = b ? { x: b.x, y: b.y + b.h + BOARD_GAP * 2 } : { x: 0, y: 0 }
    const layout = shelfLayout(unplaced, origin)
    for (const s of sprites) {
      const p = s && layout.get(s.name)
      if (p) this.editor.addSprite(s, p.x, p.y)
    }
    const stale = [...placements.keys()].some((n) => !this.editor.sprites.has(n))
    const untangled = this.editor.untangle()
    if (unplaced.length || stale || untangled) this.saver.boardMoved()
    this.refreshSprites()
  }

  // --- Sprites --------------------------------------------------------------

  private get lastKey() {
    return `lucarne:last-sprite:${this.project.name}`
  }

  private get lastSprite(): string | null {
    try {
      return localStorage.getItem(this.lastKey)
    } catch {
      return null
    }
  }

  private set lastSprite(name: string | null) {
    try {
      if (name) localStorage.setItem(this.lastKey, name)
      else localStorage.removeItem(this.lastKey)
    } catch {
      // Storage unavailable: not important.
    }
  }

  /** Makes a sprite active and brings it into view (sprite list). */
  focusSprite(name: string) {
    this.editor.activate(name)
    this.view.focus(name)
  }

  /** Rebuilds the sprite list from the board. */
  private refreshSprites() {
    this.spriteNames = [...this.editor.sprites.keys()].sort()
    for (const name of this.spriteNames) {
      if (!this.thumbs.has(name)) this.thumbs.set(name, makeThumb(this.editor.sprites.get(name)!.sprite.frames[0][0]))
    }
    for (const name of this.thumbs.keys()) if (!this.editor.sprites.has(name)) this.thumbs.delete(name)
    this.renderSprites()
  }

  private uniqueName(base: string) {
    if (!this.spriteNames.includes(base)) return base
    for (let i = 2; ; i++) if (!this.spriteNames.includes(`${base}${i}`)) return `${base}${i}`
  }

  private sizeFields(w: number, hgt: number) {
    const width = h('input', { type: 'number', min: 1, max: MAX_SIZE, value: w, name: 'width', inputMode: 'numeric' })
    const height = h('input', { type: 'number', min: 1, max: MAX_SIZE, value: hgt, name: 'height', inputMode: 'numeric' })
    const presets = h('div', { className: 'presets' })
    for (const n of [8, 16, 32, 64]) {
      presets.append(
        h('button', {
          type: 'button',
          onclick: () => {
            width.value = height.value = String(n)
          },
        }, `${n}×${n}`),
      )
    }
    const row = h('div', { className: 'size-row' },
      h('label', {}, 'Width', width),
      h('label', {}, 'Height', height),
    )
    const read = () => ({ w: Number(width.value), h: Number(height.value) })
    const check = () => {
      const { w, h: hh } = read()
      const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE
      return ok(w) && ok(hh) ? null : `Size must be a whole number between 1 and ${MAX_SIZE}.`
    }
    return { el: h('div', {}, row, presets), read, check }
  }

  private nameError(name: string, current?: string) {
    if (!NAME_RE.test(name)) return 'Name: lowercase letters, digits, “-” and “_” (e.g. hero-walk).'
    if (name !== current && this.spriteNames.includes(name)) return 'A sprite with this name already exists.'
    return null
  }

  async newSprite() {
    const nameInput = h('input', { type: 'text', value: this.uniqueName('sprite'), autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const size = this.sizeFields(16, 16)
    const body = h('div', { className: 'fields' }, h('label', {}, 'Name', nameInput), size.el)
    const res = await openDialog('New sprite', body, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Create', value: 'ok', kind: 'primary' },
    ], () => this.nameError(nameInput.value.trim()) ?? size.check())
    if (!res) return

    const name = nameInput.value.trim()
    const { w, h: hh } = size.read()
    const sprite = newSprite(name, w, hh)
    try {
      await this.project.saveSprite(sprite)
    } catch (err) {
      return toast(`Could not create: ${(err as Error).message}`)
    }
    // In free space, near the middle of the screen.
    const c = this.view.center()
    const taken = [...this.editor.sprites.keys()].map((n) => this.editor.rectOf(n)!)
    const spot = findFreeSpot(w, hh, { x: c.x - w / 2, y: c.y - hh / 2 }, taken)
    this.editor.addSprite(sprite, spot.x, spot.y)
    this.saver.boardMoved()
    this.refreshSprites()
    this.focusSprite(name)
  }

  async editSprite() {
    const sprite = this.editor.sprite
    const bmp = this.editor.bmp
    if (!sprite || !bmp) return
    const nameInput = h('input', { type: 'text', value: sprite.name, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const size = this.sizeFields(bmp.width, bmp.height)
    const anchor = h('select', {},
      h('option', { value: 'tl' }, 'Top left'),
      h('option', { value: 'c' }, 'Center'),
      h('option', { value: 'b' }, 'Bottom center'),
    )
    const body = h('div', { className: 'fields' },
      h('label', {}, 'Name', nameInput),
      size.el,
      h('label', {}, 'Image anchor when resizing', anchor),
    )
    const res = await openDialog('Sprite', body, [
      { label: 'Delete', value: 'delete', kind: 'danger' },
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', value: 'ok', kind: 'primary' },
    ], (v) => (v === 'delete' ? null : this.nameError(nameInput.value.trim(), sprite.name) ?? size.check()))

    if (res === 'delete') return this.deleteSprite(sprite.name)
    if (res !== 'ok') return

    const { w, h: hh } = size.read()
    if (w !== bmp.width || hh !== bmp.height) {
      const a = anchor.value
      const ox = a === 'tl' ? 0 : Math.floor((w - bmp.width) / 2)
      const oy = a === 'tl' ? 0 : a === 'c' ? Math.floor((hh - bmp.height) / 2) : hh - bmp.height
      this.editor.resize(w, hh, ox, oy)
    }
    const name = nameInput.value.trim()
    if (name !== sprite.name) await this.renameSprite(sprite.name, name)
  }

  private async askRename(from: string) {
    const nameInput = h('input', { type: 'text', value: from, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const body = h('div', { className: 'fields' }, h('label', {}, 'Name', nameInput))
    queueMicrotask(() => nameInput.select())
    const res = await openDialog('Rename sprite', body, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Rename', value: 'ok', kind: 'primary' },
    ], () => this.nameError(nameInput.value.trim(), from))
    const name = nameInput.value.trim()
    if (res !== 'ok' || name === from || !this.editor.sprites.has(from)) return
    await this.renameSprite(from, name)
  }

  /** Copies a sprite under a new name, next to it on the board. */
  private async duplicateSprite(from: string) {
    await this.saver.flush()
    const copy = this.editor.snapshot(from)
    if (!copy) return
    copy.name = this.uniqueName(`${from}-copy`)
    try {
      await this.project.saveSprite(copy)
    } catch (err) {
      return toast(`Could not duplicate: ${(err as Error).message}`)
    }
    const r = this.editor.rectOf(from)!
    const taken = [...this.editor.sprites.keys()].map((n) => this.editor.rectOf(n)!)
    const spot = findFreeSpot(r.w, r.h, { x: r.x + r.w + BOARD_GAP, y: r.y }, taken)
    this.editor.addSprite(copy, spot.x, spot.y)
    this.saver.boardMoved()
    this.refreshSprites()
    this.focusSprite(copy.name)
  }

  private async renameSprite(from: string, to: string) {
    await this.saver.flush()
    const snapshot = this.editor.snapshot(from)
    if (!snapshot) return
    snapshot.name = to
    try {
      await this.project.saveSprite(snapshot)
      await this.project.deleteSprite(from)
    } catch (err) {
      return toast(`Could not rename: ${(err as Error).message}`)
    }
    this.editor.renameSprite(from, to)
    this.saver.boardMoved()
    const thumb = this.thumbs.get(from)
    this.thumbs.delete(from)
    if (thumb) this.thumbs.set(to, thumb)
    this.refreshSprites()
  }

  private async deleteSprite(name: string) {
    const ok = await confirmDialog(
      'Delete sprite',
      `“${name}” (PNG and JSON) will be deleted from the game folder. Git keeps the history of versions already committed.`,
      'Delete',
      true,
    )
    if (!ok || !this.editor.sprites.has(name)) return
    this.saver.discard(name)
    try {
      await this.project.deleteSprite(name)
    } catch (err) {
      return toast(`Could not delete: ${(err as Error).message}`)
    }
    this.editor.removeSprite(name)
    this.saver.boardMoved()
    this.refreshSprites()
  }

  private scheduleThumb(name: string) {
    this.staleThumbs.add(name)
    if (this.thumbTimer) return
    this.thumbTimer = window.setTimeout(() => {
      this.thumbTimer = 0
      for (const n of this.staleThumbs) {
        const snap = this.editor.snapshot(n)
        if (!snap) continue
        const old = this.thumbs.get(n)
        const thumb = makeThumb(snap.frames[0][0])
        this.thumbs.set(n, thumb)
        old?.replaceWith(thumb)
      }
      this.staleThumbs.clear()
      this.refreshFrameThumbs()
    }, 250)
  }

  // --- Palette --------------------------------------------------------------

  /** The palette dialog: pick a color to edit, fill a free slot, add or remove rows of 8. */
  private async editPalette() {
    const grid = h('div', { className: 'palette-edit-grid' })
    const count = h('span', { className: 'rows-count' })
    const less = h('button', { type: 'button', className: 'small icon-btn', title: 'Remove the last row', 'aria-label': 'Remove a row', html: icon('remove') })
    const more = h('button', { type: 'button', className: 'small icon-btn', title: 'Add a row', 'aria-label': 'Add a row', html: icon('add') })
    const fill = () => {
      const palette = this.project.palette
      const rows = this.paletteRows
      count.textContent = rows === 1 ? '1 row' : `${rows} rows`
      less.disabled = rows <= 1
      grid.replaceChildren()
      palette.forEach((hex, i) => {
        grid.append(h('button', { type: 'button', className: 'swatch', title: hex, style: `--c: ${hex}`, onclick: () => void this.editColor(i).then(fill) }))
      })
      for (let k = palette.length; k < rows * PALETTE_COLS; k++) {
        grid.append(h('button', { type: 'button', className: 'swatch add', title: 'Add a color', html: icon('add'), onclick: () => void this.editColor(null).then(fill) }))
      }
    }
    const setRows = (rows: number) => {
      this.editor.paletteRows = rows
      this.saver.boardMoved()
      this.renderPalette()
      fill()
    }
    more.addEventListener('click', () => setRows(this.paletteRows + 1))
    less.addEventListener('click', async () => {
      const rows = this.paletteRows
      const kept = (rows - 1) * PALETTE_COLS
      const lost = this.project.palette.length - kept
      if (lost > 0) {
        if (!(await confirmDialog('Remove the last row?', `Its ${lost} color${lost > 1 ? 's' : ''} will be removed from the palette.`, 'Remove', true))) return
        const palette = this.project.palette.slice(0, kept)
        this.project.palette = palette
        this.editor.setPalette(palette)
        try {
          await this.project.savePalette()
        } catch (err) {
          toast(`Palette not saved: ${(err as Error).message}`)
        }
      }
      setRows(rows - 1)
    })
    fill()
    const lospec = h('button', { type: 'button', className: 'ghost left', title: 'Import a palette: popular ones or any from lospec.com', onclick: () => void this.importLospec().then(fill) }, 'Import…')
    const body = h('div', { className: 'fields' },
      h('div', { className: 'rows-control' }, less, count, more),
      grid,
    )
    const done = openDialog('Palette', body, [{ label: 'Done', value: 'ok', kind: 'primary' }], undefined, 'palette-dialog')
    // The import button sits in the footer, on the left, opposite Done.
    document.querySelector('dialog.palette-dialog .dialog-actions')?.append(lospec)
    // No button should look selected when it opens.
    const dialog = document.querySelector<HTMLElement>('dialog.palette-dialog')
    if (dialog) {
      dialog.tabIndex = -1
      dialog.focus()
    }
    await done
  }

  /** Replaces the palette with a bundled popular one, or any palette fetched from Lospec, after showing what it is. */
  private async importLospec() {
    const input = h('input', { type: 'text', placeholder: 'https://lospec.com/palette-list/sweetie-16', autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const list = h('div', { className: 'palette-library' })
    let picked: string | null = null
    for (const p of BUNDLED_PALETTES) {
      const strip = h('span', { className: 'strip' })
      for (const hex of bundledColors(p).slice(0, 12)) strip.append(h('i', { style: `background: ${hex}` }))
      list.append(
        h('button', {
          type: 'button',
          className: 'library-item',
          onclick: (e: Event) => {
            picked = p.slug
            ;(e.currentTarget as HTMLElement).closest('form')!.querySelector<HTMLButtonElement>('button.primary')!.click()
          },
        },
          h('span', { className: 'library-name' }, p.name, h('small', {}, `${bundledColors(p).length} colors${p.author ? ` · ${p.author}` : ''}`)),
          strip,
        ),
      )
    }
    const body = h('div', { className: 'fields' },
      h('label', {}, 'Most popular on Lospec (offline)', list),
      h('label', {}, 'Or any palette from lospec.com: link or name', input),
    )
    const res = await openDialog('Import a palette', body, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Find', value: 'ok', kind: 'primary' },
    ], () => (picked || lospecSlug(input.value) ? null : 'Pick a palette, or paste a link like lospec.com/palette-list/sweetie-16.'))
    if (!res) return

    let found: LospecPalette
    const bundled = picked ? BUNDLED_PALETTES.find((p) => p.slug === picked) : undefined
    if (bundled) {
      found = { name: bundled.name, author: bundled.author, colors: bundledColors(bundled) }
    } else {
      const slug = lospecSlug(input.value)
      if (!slug) return
      try {
        found = await fetchLospecPalette(slug)
      } catch (err) {
        toast(err instanceof TypeError ? 'Could not reach Lospec.' : (err as Error).message)
        return
      }
    }
    const preview = h('div', { className: 'palette-edit-grid' })
    for (const hex of found.colors) preview.append(h('span', { className: 'swatch', title: hex, style: `--c: ${hex}` }))
    const by = found.author ? ` by ${found.author}` : ''
    const ok = await openDialog(
      'Replace the palette?',
      h('div', { className: 'fields' },
        h('p', {}, `${found.name}${by}: ${found.colors.length} colors, from lospec.com.`),
        preview,
        h('p', { className: 'muted' }, 'Sprites keep their pixels, even those not in the new palette.'),
      ),
      [{ label: 'Cancel', value: 'cancel' }, { label: 'Replace', value: 'ok', kind: 'primary' }],
    )
    if (!ok) return

    this.project.palette = found.colors
    this.editor.setPalette(found.colors)
    this.editor.paletteRows = null
    this.saver.boardMoved()
    try {
      await this.project.savePalette()
    } catch (err) {
      toast(`Palette not saved: ${(err as Error).message}`)
    }
    this.renderPalette()
    toast(`Palette "${found.name}" imported`)
  }

  private async editColor(index: number | null) {
    const old = index === null ? null : this.project.palette[index]
    const initial = old ?? colorToHex(this.editor.color).slice(0, 7)
    const picker = h('input', { type: 'color', value: initial })
    const hex = h('input', { type: 'text', value: initial, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    picker.addEventListener('input', () => (hex.value = picker.value))
    hex.addEventListener('input', () => {
      if (isHex(hex.value)) picker.value = normalizeHex(hex.value).slice(0, 7)
    })
    const replace = h('input', { type: 'checkbox', checked: true })
    const body = h('div', { className: 'fields' },
      h('div', { className: 'color-row' }, picker, hex),
      old ? h('label', { className: 'check' }, replace, 'Also replace in every sprite') : null,
    )
    const buttons = [
      ...(old ? [{ label: 'Remove', value: 'delete', kind: 'danger' as const }] : []),
      { label: 'Cancel', value: 'cancel' },
      { label: old ? 'Save' : 'Add', value: 'ok', kind: 'primary' as const },
    ]
    const res = await openDialog(old ? 'Palette color' : 'New color', body, buttons, (v) => {
      if (v === 'delete') return null
      if (!isHex(hex.value) || normalizeHex(hex.value).length !== 7) return 'Use the #rrggbb format.'
      const value = normalizeHex(hex.value)
      if (value !== old && this.project.palette.includes(value)) return 'This color is already in the palette.'
      return null
    })
    if (!res) return

    const palette = [...this.project.palette]
    if (res === 'delete' && index !== null) {
      palette.splice(index, 1)
    } else {
      const value = normalizeHex(hex.value)
      if (index === null) palette.push(value)
      else palette[index] = value
      if (old && old !== value && replace.checked) this.replaceEverywhere(old, value)
    }
    this.project.palette = palette
    this.editor.setPalette(palette)
    try {
      await this.project.savePalette()
    } catch (err) {
      toast(`Palette not saved: ${(err as Error).message}`)
    }
    this.renderPalette()
  }

  private replaceEverywhere(fromHex: string, toHex: string) {
    const from = hexToColor(fromHex)
    const to = hexToColor(toHex)
    if (this.editor.color === from) this.editor.color = to
    // Every sprite, as a single undo step.
    const count = this.editor.replaceColorEverywhere(from, to).length
    if (count) toast(`Color replaced in ${count} sprite${count > 1 ? 's' : ''}`)
  }

  // --- GitHub sync ----------------------------------------------------------

  /** The sync button shows when sync is set up and the editor saves to the browser (iPad). */
  refreshSync() {
    $('sync').hidden = this.project.storage.kind !== 'opfs' || !isConfigured(loadSettings())
  }

  private syncing = false

  async sync() {
    const settings = loadSettings()
    if (this.syncing || !isConfigured(settings)) return
    this.syncing = true
    const message = h('p', {}, 'Saving…')
    const progress = h('dialog', { className: 'progress-dialog' }, h('h2', {}, 'Syncing with GitHub'), message)
    // Not dismissable: the files must not change while syncing.
    progress.addEventListener('cancel', (e) => e.preventDefault())
    document.body.append(progress)
    progress.showModal()
    let result: Awaited<ReturnType<typeof syncWithGitHub>> = null
    try {
      await this.saver.flush()
      if (this.saver.status === 'error') throw new Error('Some changes could not be saved on this device.')
      result = await syncWithGitHub(
        this.project.storage,
        settings,
        async (conflicts) => {
          progress.close()
          const choices = await resolveConflicts(conflicts)
          if (choices) progress.showModal()
          return choices
        },
        (m) => (message.textContent = m),
      )
    } catch (err) {
      progress.close()
      progress.remove()
      this.syncing = false
      await openDialog('Sync failed', h('p', {}, (err as Error).message), [{ label: 'OK', value: 'ok', kind: 'primary' }])
      return
    }
    progress.close()
    progress.remove()
    this.syncing = false
    if (!result) return toast('Sync canceled')

    const parts = [
      result.pulled ? `${result.pulled} file${result.pulled > 1 ? 's' : ''} received` : '',
      result.pushed ? `${result.pushed} file${result.pushed > 1 ? 's' : ''} sent` : '',
    ].filter(Boolean)
    const note = parts.length ? `Synced: ${parts.join(', ')}` : 'Already up to date'
    if (result.pulled) {
      // Files changed under the editor: start again from them.
      try {
        sessionStorage.setItem(SYNC_NOTE, note)
      } catch {}
      location.reload()
    } else toast(note)
  }

  // --- Construction ---------------------------------------------------------

  private buildTopbar() {
    $('topbar').prepend(createMenu())
    const player = new Player(this.project.storage)
    $('run-game').innerHTML = icon('play')
    $('run-game').addEventListener('click', () => void player.play())
    $('sync').innerHTML = icon('sync')
    $('sync').addEventListener('click', () => void this.sync())
    this.refreshSync()
    $('sprites-new').innerHTML = icon('add')
    $('palette-edit').innerHTML = icon('pencil')
    $('grid').innerHTML = icon('grid')
    $('checker').innerHTML = icon('checker')
    $('fit').innerHTML = icon('fit')
    $('grid').addEventListener('click', () => this.toggleGrid())
    $('checker').addEventListener('click', () => this.toggleChecker())
    $('background').addEventListener('click', () => void this.editBackground())
    $('fit').addEventListener('click', () => this.view.fit())
  }

  /** The editor's own board color, used when the game sets none. */
  private get defaultBackground() {
    return getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#202028'
  }

  private async editBackground() {
    const initial = this.editor.background ?? this.defaultBackground
    const picker = h('input', { type: 'color', value: initial })
    const hex = h('input', { type: 'text', value: initial, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const set = (value: string) => {
      picker.value = value
      hex.value = value
    }
    picker.addEventListener('input', () => (hex.value = picker.value))
    hex.addEventListener('input', () => {
      if (isHex(hex.value)) picker.value = normalizeHex(hex.value).slice(0, 7)
    })
    const swatches = h('div', { className: 'bg-swatches' })
    for (const c of this.project.palette) {
      swatches.append(h('button', { type: 'button', className: 'swatch', title: c, style: `--c: ${c}`, onclick: () => set(c) }))
    }
    const body = h('div', { className: 'fields' },
      h('p', { className: 'muted' }, 'Color behind the sprites, saved with this game. Try the color of your game’s sky or ground.'),
      h('div', { className: 'color-row' }, picker, hex),
      h('label', {}, 'From the palette', swatches),
    )
    const res = await openDialog('Board color', body, [
      { label: 'Default', value: 'reset', kind: 'left' },
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', value: 'ok', kind: 'primary' },
    ], (v) => (v === 'ok' && (!isHex(hex.value) || normalizeHex(hex.value).length !== 7) ? 'Use the #rrggbb format.' : null))
    if (res === 'reset') this.editor.setBackground(null)
    else if (res === 'ok') {
      const value = normalizeHex(hex.value)
      this.editor.setBackground(value === this.defaultBackground ? null : value)
    }
  }

  private toggleChecker() {
    this.view.showChecker = !this.view.showChecker
    try {
      localStorage.setItem('lucarne.checker', this.view.showChecker ? '1' : '')
    } catch {}
    this.view.requestRender()
    this.render()
  }

  private toggleGrid() {
    this.view.showGrid = !this.view.showGrid
    this.view.requestRender()
    this.render()
  }

  private buildTools() {
    const nav = $('tools')
    for (const t of TOOLS) {
      nav.append(
        h('button', {
          className: 'tool',
          title: `${t.label} (${t.key})`,
          'aria-label': t.label,
          'data-tool': t.id,
          html: icon(t.id),
          onclick: () => this.editor.setTool(t.id),
        }),
      )
    }
  }

  private buildSelectionBar() {
    const bar = $('selbar')
    const btn = (label: string, title: string, action: () => void, extra: Record<string, unknown> = {}) =>
      h('button', { title, onclick: action, ...extra }, label)
    bar.append(
      btn('All', 'Select all (⌘A)', () => this.editor.selectAll()),
      btn('Copy', 'Copy (⌘C)', () => this.editor.copy(), { 'data-needs': 'sel' }),
      btn('Cut', 'Cut (⌘X)', () => this.editor.cut(), { 'data-needs': 'sel' }),
      btn('Paste', 'Paste (⌘V)', () => this.editor.paste(), { 'data-needs': 'clip' }),
      btn('Duplicate', 'Duplicate (⌥ + drag)', () => this.editor.duplicate(), { 'data-needs': 'sel' }),
      h('button', { title: 'Flip horizontally (⇧H)', html: icon('flipH'), onclick: () => this.editor.flip('h') }),
      h('button', { title: 'Flip vertically (⇧V)', html: icon('flipV'), onclick: () => this.editor.flip('v') }),
      btn('Clear', 'Clear (Delete)', () => this.editor.deleteSelection(), { 'data-needs': 'sel' }),
      btn('Done', 'Done (Enter)', () => this.editor.deselect(), { 'data-needs': 'sel', className: 'primary' }),
    )
  }

  private bindKeys() {
    const input = attachInput(this.view.canvas, this.view, this.editor)
    const toolKeys: Record<string, ToolId> = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker', l: 'line', r: 'rect', m: 'select', o: 'origin', v: 'move' }

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement
      if (currentPage() !== 'editor' || isPlaying() || target.closest('input, select, textarea, dialog')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const ed = this.editor

      if (e.key === ' ') {
        input.setSpace(true)
        e.preventDefault()
        return
      }
      if (mod) {
        if (k === 'z') e.shiftKey ? ed.redo() : ed.undo()
        else if (k === 'y') ed.redo()
        else if (k === 'c') ed.copy()
        else if (k === 'x') ed.cut()
        else if (k === 'v') ed.paste()
        else if (k === 'a') ed.selectAll()
        else if (k === 'd') ed.deselect()
        else if (k === 's') void this.saver.flush()
        else return
        e.preventDefault()
        return
      }
      if (e.altKey) return
      if (k === 'r' && e.shiftKey) ed.setTool('rectFill')
      else if (k === 'h' && e.shiftKey) ed.flip('h')
      else if (k === 'v' && e.shiftKey) ed.flip('v')
      else if (!e.shiftKey && toolKeys[k]) ed.setTool(toolKeys[k])
      else if (e.key === 'Delete' || e.key === 'Backspace') ed.deleteSelection()
      else if (k === 'a' && !e.shiftKey) this.toggleFrames()
      else if (e.key === 'Enter' && !ed.selection && !ed.floating) ed.playing ? ed.stop() : ed.play()
      else if (k === ',' || k === '<') e.shiftKey ? ed.moveFrame(-1) : ed.setFrameIndex(ed.frame - 1)
      else if (k === '.' || k === '>') e.shiftKey ? ed.moveFrame(1) : ed.setFrameIndex(ed.frame + 1)
      else if (e.key === 'Escape' || e.key === 'Enter') ed.deselect()
      else if (e.key === '#') this.toggleGrid()
      else if (e.key === '0') this.view.fit()
      else if (e.key === '+' || e.key === '=') this.zoomStep(1)
      else if (e.key === '-') this.zoomStep(-1)
      else if (/^[1-9]$/.test(e.key)) {
        const hex = this.project.palette[Number(e.key) - 1]
        if (hex) ed.setColor(hexToColor(hex))
      } else return
      e.preventDefault()
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') input.setSpace(false)
    })
  }

  private zoomStep(dir: 1 | -1) {
    const c = this.view.canvas
    const z = this.view.zoom
    const next = dir > 0 ? Math.max(z + 1, Math.round(z * 1.5)) : Math.min(z - 1, Math.round(z / 1.5))
    this.view.zoomAt(next, c.width / 2, c.height / 2)
  }

  // --- Interface rendering --------------------------------------------------

  private render() {
    const ed = this.editor
    const sprite = ed.sprite

    $('app').classList.toggle('no-sprite', ed.sprites.size === 0)
    if (sprite && sprite.name !== this.rememberedSprite) {
      this.rememberedSprite = sprite.name
      this.lastSprite = sprite.name
    }
    $('grid').classList.toggle('active', this.view.showGrid)
    $('checker').classList.toggle('active', this.view.showChecker)
    $('anim-toggle').classList.toggle('active', !$('frames').hidden)
    $('background-swatch').style.background = ed.background ?? ''

    for (const el of document.querySelectorAll<HTMLElement>('[data-tool]')) {
      el.classList.toggle('active', el.dataset.tool === ed.tool)
    }

    const bar = $('selbar')
    bar.hidden = ed.tool !== 'select' || !sprite
    for (const el of bar.querySelectorAll<HTMLButtonElement>('[data-needs]')) {
      el.disabled = el.dataset.needs === 'sel' ? !ed.selection : !ed.clipboard
    }

    const current = colorToHex(ed.color)
    for (const el of document.querySelectorAll<HTMLElement>('.swatch[data-hex]')) {
      el.classList.toggle('active', el.dataset.hex === current && ed.tool !== 'eraser')
    }
    for (const el of document.querySelectorAll<HTMLElement>('.sprite-item')) {
      el.classList.toggle('active', el.dataset.name === sprite?.name)
    }
    this.renderFrames()
  }

  // --- Animation panel ------------------------------------------------------

  private buildFrames() {
    $('anim-toggle').innerHTML = icon('frames')
    $('frame-add').innerHTML = icon('add')
    $('frame-dup').innerHTML = icon('copy')
    $('frame-del').innerHTML = icon('trash')
    $('anim-toggle').addEventListener('click', () => this.toggleFrames())
    $('play').addEventListener('click', () => (this.editor.playing ? this.editor.stop() : this.editor.play()))
    const fps = $<HTMLInputElement>('fps')
    fps.addEventListener('input', () => ($('fps-value').textContent = fps.value))
    fps.addEventListener('change', () => {
      this.editor.setFps(Number(fps.value))
      fps.value = String(this.editor.fps)
      $('fps-value').textContent = fps.value
    })
    fps.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') fps.blur()
    })
    $('frame-add').addEventListener('click', () => this.editor.addFrame())
    $('frame-dup').addEventListener('click', () => this.editor.duplicateFrame())
    $('frame-del').addEventListener('click', () => this.editor.deleteFrame())
  }

  private toggleFrames() {
    const panel = $('frames')
    panel.hidden = !panel.hidden
    this.framesKey = ''
    this.render()
    // The stage changed size: the canvas follows by itself (ResizeObserver).
  }

  /** Redraws the strip when the frames changed; otherwise only the highlights. */
  private renderFrames() {
    const panel = $('frames')
    if (panel.hidden) return
    const ed = this.editor
    const sprite = ed.sprite
    const n = sprite?.meta.frames.length ?? 0
    const key = sprite ? `${sprite.name}|${n}|${sprite.meta.frameWidth}x${sprite.meta.frameHeight}` : ''
    const strip = $('frame-strip')
    if (key !== this.framesKey) {
      this.framesKey = key
      strip.replaceChildren()
      sprite?.meta.frames.forEach((_, i) => {
        strip.append(
          h('div', {
            className: 'frame',
            'data-frame': i,
            title: 'Drag to reorder',
            onclick: () => {
              if (!this.frameDragged) this.editor.setFrameIndex(i)
            },
            onpointerdown: (e: PointerEvent) => this.startFrameDrag(e, i),
          },
            h('div', { className: 'frame-view' }),
            h('div', { className: 'frame-meta' }, String(i + 1))),
        )
      })
      this.refreshFrameThumbs()
    }
    const shown = ed.playing ? ed.playIndex : ed.frame
    for (const el of strip.querySelectorAll<HTMLElement>('.frame')) {
      const i = Number(el.dataset.frame)
      el.classList.toggle('active', i === ed.frame)
      el.classList.toggle('playing', ed.playing && i === shown)
    }
    const fpsInput = $<HTMLInputElement>('fps')
    fpsInput.disabled = !sprite
    if (document.activeElement !== fpsInput) {
      fpsInput.value = sprite ? String(Math.min(MAX_FPS, Math.max(MIN_FPS, ed.fps))) : ''
      $('fps-value').textContent = sprite ? fpsInput.value : ''
    }
    // Only touch the button when its state changes: replacing its icon on every
    // animation tick would swallow clicks (press and release on different nodes).
    const playState = ed.playing ? 'pause' : 'play'
    if ($('play').dataset.state !== playState) {
      $('play').dataset.state = playState
      $('play').innerHTML = icon(playState)
      $('play').setAttribute('aria-label', ed.playing ? 'Pause' : 'Play')
    }
    $<HTMLButtonElement>('play').disabled = n < 2
    $<HTMLButtonElement>('frame-add').disabled = !sprite
    $<HTMLButtonElement>('frame-dup').disabled = !sprite
    $<HTMLButtonElement>('frame-del').disabled = n < 2
  }

  /** Drag and drop to reorder frames (pointer events, so it works with touch and stylus).
   * A ghost of the frame follows the pointer, the others slide aside to open a gap. */
  private startFrameDrag(e: PointerEvent, from: number) {
    if (e.button !== 0) return
    const strip = $('frame-strip')
    const cells = [...strip.querySelectorAll<HTMLElement>('.frame')]
    const cell = cells[from]
    const rects = cells.map((c) => c.getBoundingClientRect())
    const step = cells.length > 1 ? rects[1].left - rects[0].left : rects[0].width
    const grab = e.clientX - rects[from].left
    let ghost: HTMLElement | null = null
    let to = from

    const place = (x: number) => {
      // The slot whose middle is closest to the pointer.
      let best = 0
      rects.forEach((r, i) => {
        if (Math.abs(x - (r.left + r.width / 2)) < Math.abs(x - (rects[best].left + rects[best].width / 2))) best = i
      })
      to = best
      cells.forEach((c, i) => {
        let dx = 0
        if (i === from) dx = (to - from) * step
        else if (from < to && i > from && i <= to) dx = -step
        else if (from > to && i >= to && i < from) dx = step
        c.style.transform = dx ? `translateX(${dx}px)` : ''
      })
    }
    const start = () => {
      ghost = cell.cloneNode(true) as HTMLElement
      // A cloned canvas is blank: copy its pixels.
      const src = cell.querySelector('canvas')
      const dst = ghost.querySelector('canvas')
      if (src && dst) dst.getContext('2d')!.drawImage(src, 0, 0)
      ghost.classList.add('frame-ghost')
      ghost.style.width = `${rects[from].width}px`
      ghost.style.top = `${rects[from].top}px`
      document.body.append(ghost)
      cell.classList.add('dragging')
      strip.classList.add('reordering')
    }
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.abs(ev.clientX - e.clientX) < 6) return
        start()
      }
      ghost!.style.left = `${ev.clientX - grab}px`
      place(ev.clientX)
    }
    const end = () => {
      cell.removeEventListener('pointermove', move)
      cell.removeEventListener('pointerup', end)
      cell.removeEventListener('pointercancel', end)
      if (!ghost) return
      ghost.remove()
      // Back to the normal layout without animating, then apply the change.
      strip.classList.remove('reordering')
      cell.classList.remove('dragging')
      for (const c of cells) c.style.transform = ''
      this.frameDragged = true
      setTimeout(() => (this.frameDragged = false), 0)
      this.editor.moveFrameTo(from, to)
      this.refreshFrameThumbs()
    }
    // Capture from the start so a fast drag outside the cell is still followed.
    cell.setPointerCapture(e.pointerId)
    cell.addEventListener('pointermove', move)
    cell.addEventListener('pointerup', end)
    cell.addEventListener('pointercancel', end)
  }

  private refreshFrameThumbs() {
    const panel = $('frames')
    const snap = panel.hidden ? null : this.editor.snapshot()
    if (!snap) return
    const views = $('frame-strip').querySelectorAll<HTMLElement>('.frame-view')
    views.forEach((view, i) => {
      const bmp = snap.frames[0][i]
      if (bmp) view.replaceChildren(makeThumb(bmp, 56))
    })
  }

  private renderStatus(s: SaveStatus) {
    const el = $('save-status')
    el.dataset.status = s
    el.textContent = { saved: 'Saved', pending: 'Edited', saving: 'Saving…', error: 'Error' }[s]
  }

  /** Rows in the palette: enough for every color, at least what the user asked for. */
  private get paletteRows() {
    return Math.max(1, Math.ceil(this.project.palette.length / PALETTE_COLS), this.editor.paletteRows ?? 0)
  }

  private renderPalette() {
    const grid = $('palette-grid')
    grid.replaceChildren()
    this.project.palette.forEach((hex, i) => {
      grid.append(
        h('button', {
          className: 'swatch',
          title: i < 9 ? `${hex} (${i + 1})` : hex,
          'data-hex': hex,
          style: `--c: ${hex}`,
          onclick: () => this.editor.setColor(hexToColor(hex)),
        }),
      )
    })
    // Free slots of the last rows, so the palette always shows whole rows.
    for (let k = this.project.palette.length; k < this.paletteRows * PALETTE_COLS; k++) grid.append(h('span', { className: 'swatch empty' }))
    const n = this.project.palette.length
    const warn = $('palette-warning')
    warn.hidden = n <= PALETTE_WARNING
    warn.textContent = `${n} colors: beyond ${PALETTE_WARNING}, a palette gets hard to keep consistent.`
    this.render()
  }

  private renderSprites() {
    const list = $('sprite-list')
    list.replaceChildren()
    for (const name of this.spriteNames) {
      const menu = createActionsMenu(`Options for ${name}`, [
        { label: 'Rename', run: () => void this.askRename(name) },
        { label: 'Duplicate', run: () => void this.duplicateSprite(name) },
        { label: 'Delete', run: () => void this.deleteSprite(name), danger: true },
      ])
      list.append(
        h('div', { className: 'sprite-row' },
          h('button', {
            className: 'sprite-item',
            'data-name': name,
            onclick: () => this.focusSprite(name),
          },
          this.thumbs.get(name) ?? h('span', { className: 'thumb' }),
          h('span', { className: 'sprite-label' }, name)),
          menu.el),
      )
    }
    this.render()
  }
}

const SYNC_NOTE = 'lucarne.sync-note'

/** Asks which side wins for each file (or sprite) changed both here and on GitHub. */
async function resolveConflicts(conflicts: Conflict[]): Promise<Map<string, Side> | null> {
  const choices = new Map<string, Side>()
  const list = h('div', { className: 'conflicts' })
  for (const c of conflicts) {
    const fresh = c.files.every((f) => !f.base)
    const what = fresh
      ? 'Added here and on GitHub'
      : c.files.some((f) => !f.local)
        ? 'Deleted here, changed on GitHub'
        : c.files.some((f) => !f.remote)
          ? 'Changed here, deleted on GitHub'
          : 'Changed here and on GitHub'
    // Never synced: GitHub's copy is most likely the real one.
    choices.set(c.group, fresh ? 'remote' : 'local')
    const option = (side: Side, label: string) =>
      h('label', {},
        h('input', {
          type: 'radio',
          name: `conflict-${c.group}`,
          checked: choices.get(c.group) === side,
          onchange: () => choices.set(c.group, side),
        }),
        label)
    list.append(
      h('div', { className: 'conflict' },
        h('div', { className: 'conflict-name' }, c.group.replace(/^sprites\//, ''), h('small', {}, `${c.group.startsWith('sprites/') ? 'Sprite · ' : ''}${what}`)),
        h('div', { className: 'segmented' }, option('local', 'This device'), option('remote', 'GitHub'))),
    )
  }
  const body = h('div', { className: 'fields' },
    h('p', { className: 'muted' }, 'These changed on this device and on GitHub since the last sync. Pick the version to keep; the other one is replaced (GitHub keeps every committed version in its history).'),
    list,
  )
  const res = await openDialog('Sync conflicts', body, [
    { label: 'Cancel', value: 'cancel' },
    { label: 'Sync', value: 'ok', kind: 'primary' },
  ], undefined, 'conflict-dialog')
  return res === 'ok' ? choices : null
}

/** Image thumbnail (the canvas is scaled up in CSS, without smoothing). */
function makeThumb(bmp: Bitmap, size = 32): HTMLCanvasElement {
  const c = h('canvas', { className: 'thumb', width: bmp.width, height: bmp.height })
  c.getContext('2d')!.putImageData(toImageData(bmp), 0, 0)
  const scale = size / Math.max(bmp.width, bmp.height)
  c.style.width = `${Math.max(1, Math.round(bmp.width * scale))}px`
  c.style.height = `${Math.max(1, Math.round(bmp.height * scale))}px`
  return c
}

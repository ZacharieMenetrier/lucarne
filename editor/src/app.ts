// The interface: toolbars, palette, sprite list, shortcuts, autosave.

import { Bitmap, replaceColor } from './bitmap'
import { colorToHex, hexToColor, isHex } from './color'
import { confirmDialog, h, openDialog, toast } from './dialog'
import { Editor, type ToolId } from './editor'
import { icon } from './icons'
import { attachInput } from './input'
import { PALETTE_WARNING, normalizeHex, type Project } from './project'
import { MAX_SIZE, NAME_RE, newSprite } from './sprite'
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
]

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ---------------------------------------------------------------------------
// Autosave

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

class Saver {
  status: SaveStatus = 'saved'
  private dirty = false
  private timer = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly project: Project,
    private readonly editor: Editor,
    private readonly onStatus: (s: SaveStatus) => void,
  ) {}

  get busy() {
    return this.dirty || this.status === 'saving'
  }

  schedule() {
    this.dirty = true
    this.set('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
  }

  /** Saves pending changes right away. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.dirty) return this.chain
    this.dirty = false
    const snapshot = this.editor.snapshot()
    if (!snapshot) return this.chain
    this.set('saving')
    this.chain = this.chain
      .then(() => this.project.saveSprite(snapshot))
      .then(
        () => this.set(this.dirty ? 'pending' : 'saved'),
        (err: Error) => {
          this.dirty = true
          this.set('error')
          toast(`Could not save: ${err.message}`)
        },
      )
    return this.chain
  }

  /** Drops pending changes (deleted sprite). */
  discard() {
    clearTimeout(this.timer)
    this.dirty = false
    this.set('saved')
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
  private editingPalette = false
  private thumbTimer = 0

  constructor(private readonly project: Project) {
    this.editor = new Editor(project.palette)
    this.view = new View($<HTMLCanvasElement>('canvas'), this.editor)
    this.saver = new Saver(project, this.editor, (s) => this.renderStatus(s))
    this.editor.onEdit = () => {
      this.saver.schedule()
      this.scheduleThumb()
    }
    this.editor.onMessage = toast
  }

  async start() {
    this.buildTopbar()
    this.buildTools()
    this.buildSelectionBar()
    this.bindKeys()
    $('empty-new').addEventListener('click', () => void this.newSprite())
    $('sprites-new').addEventListener('click', () => void this.newSprite())
    $('palette-edit').addEventListener('click', () => {
      this.editingPalette = !this.editingPalette
      this.renderPalette()
    })
    this.editor.subscribe(() => this.render())

    window.addEventListener('beforeunload', (e) => {
      if (this.saver.busy) e.preventDefault()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saver.flush()
    })

    $('project-name').textContent = this.project.name
    this.renderPalette()
    await this.refreshSprites()
    const last = this.lastSprite
    const first = last && this.spriteNames.includes(last) ? last : this.spriteNames[0]
    if (first) await this.openSprite(first)
    this.render()
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

  async openSprite(name: string) {
    if (this.editor.sprite?.name === name) return
    await this.saver.flush()
    try {
      const sprite = await this.project.loadSprite(name)
      this.editor.setSprite(sprite)
      this.lastSprite = name
    } catch (err) {
      toast((err as Error).message)
    }
    this.renderSprites()
  }

  private async refreshSprites() {
    this.spriteNames = await this.project.listSprites()
    await Promise.all(
      this.spriteNames.map(async (name) => {
        if (this.thumbs.has(name)) return
        try {
          const s = await this.project.loadSprite(name)
          this.thumbs.set(name, makeThumb(s.frames[0][0]))
        } catch {
          // Unreadable sprite: no thumbnail.
        }
      }),
    )
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
    await this.saver.flush()
    const sprite = newSprite(name, w, hh)
    try {
      await this.project.saveSprite(sprite)
    } catch (err) {
      return toast(`Could not create: ${(err as Error).message}`)
    }
    this.editor.setSprite(sprite)
    this.lastSprite = name
    this.thumbs.set(name, makeThumb(sprite.frames[0][0]))
    await this.refreshSprites()
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

    if (res === 'delete') return this.deleteSprite()
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

  private async renameSprite(from: string, to: string) {
    await this.saver.flush()
    const sprite = this.editor.sprite!
    const snapshot = this.editor.snapshot()!
    snapshot.name = to
    try {
      await this.project.saveSprite(snapshot)
      await this.project.deleteSprite(from)
    } catch (err) {
      return toast(`Could not rename: ${(err as Error).message}`)
    }
    sprite.name = to
    this.editor.renameHistory(from, to)
    const thumb = this.thumbs.get(from)
    this.thumbs.delete(from)
    if (thumb) this.thumbs.set(to, thumb)
    this.lastSprite = to
    await this.refreshSprites()
    this.editor.emit()
  }

  private async deleteSprite() {
    const sprite = this.editor.sprite
    if (!sprite) return
    const ok = await confirmDialog(
      'Delete sprite',
      `“${sprite.name}” (PNG and JSON) will be deleted from the game folder. Git keeps the history of versions already committed.`,
      'Delete',
      true,
    )
    if (!ok) return
    this.saver.discard()
    await this.project.deleteSprite(sprite.name)
    this.editor.forgetHistory(sprite.name)
    this.thumbs.delete(sprite.name)
    this.editor.setSprite(null)
    this.lastSprite = null
    await this.refreshSprites()
    if (this.spriteNames[0]) await this.openSprite(this.spriteNames[0])
  }

  private scheduleThumb() {
    if (this.thumbTimer) return
    this.thumbTimer = window.setTimeout(() => {
      this.thumbTimer = 0
      const snap = this.editor.snapshot()
      if (!snap) return
      const old = this.thumbs.get(snap.name)
      const thumb = makeThumb(snap.frames[0][0])
      this.thumbs.set(snap.name, thumb)
      if (old) old.replaceWith(thumb)
      else this.renderSprites()
    }, 250)
  }

  // --- Palette --------------------------------------------------------------

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
      if (old && old !== value && replace.checked) await this.replaceEverywhere(old, value)
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

  private async replaceEverywhere(fromHex: string, toHex: string) {
    const from = hexToColor(fromHex)
    const to = hexToColor(toHex)
    if (this.editor.color === from) this.editor.color = to
    await this.saver.flush()
    // Open sprite: undoable.
    this.editor.replaceColor(from, to)
    let count = 0
    for (const name of this.spriteNames) {
      if (name === this.editor.sprite?.name) continue
      try {
        const s = await this.project.loadSprite(name)
        let changed = false
        for (const row of s.frames) for (const b of row) changed = replaceColor(b, from, to) || changed
        if (changed) {
          await this.project.saveSprite(s)
          this.thumbs.set(name, makeThumb(s.frames[0][0]))
          count++
        }
      } catch (err) {
        toast(`${name}: ${(err as Error).message}`)
      }
    }
    if (count) toast(`Color replaced in ${count} other sprite${count > 1 ? 's' : ''}`)
    this.renderSprites()
  }

  // --- Construction ---------------------------------------------------------

  private buildTopbar() {
    $('undo').innerHTML = icon('undo')
    $('redo').innerHTML = icon('redo')
    $('grid').innerHTML = icon('grid')
    $('fit').innerHTML = icon('fit')
    $('undo').addEventListener('click', () => this.editor.undo())
    $('redo').addEventListener('click', () => this.editor.redo())
    $('grid').addEventListener('click', () => this.toggleGrid())
    $('fit').addEventListener('click', () => this.view.fit())
    $('sprite-info').addEventListener('click', () => void this.editSprite())
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
    const toolKeys: Record<string, ToolId> = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker', l: 'line', r: 'rect', m: 'select' }

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, dialog')) return
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
    const bmp = ed.bmp

    $('app').classList.toggle('no-sprite', !sprite)
    $('sprite-name').textContent = sprite?.name ?? '—'
    $('sprite-size').textContent = bmp ? `${bmp.width}×${bmp.height}` : ''
    $<HTMLButtonElement>('sprite-info').disabled = !sprite
    $<HTMLButtonElement>('undo').disabled = !ed.history?.canUndo && !ed.floating
    $<HTMLButtonElement>('redo').disabled = !ed.history?.canRedo
    $('grid').classList.toggle('active', this.view.showGrid)

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
  }

  private renderStatus(s: SaveStatus) {
    const el = $('save-status')
    el.dataset.status = s
    el.textContent = { saved: 'Saved', pending: 'Edited', saving: 'Saving…', error: 'Error' }[s]
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
          onclick: () => (this.editingPalette ? void this.editColor(i) : this.editor.setColor(hexToColor(hex))),
        }),
      )
    })
    if (this.editingPalette) {
      grid.append(h('button', { className: 'swatch add', title: 'Add a color', onclick: () => void this.editColor(null) }, '+'))
    }
    $('palette-panel').classList.toggle('editing', this.editingPalette)
    $('palette-edit').textContent = this.editingPalette ? 'Done' : 'Edit'
    const n = this.project.palette.length
    $('palette-count').textContent = String(n)
    const warn = $('palette-warning')
    warn.hidden = n <= PALETTE_WARNING
    warn.textContent = `${n} colors: beyond ${PALETTE_WARNING}, a palette gets hard to keep consistent.`
    this.render()
  }

  private renderSprites() {
    const list = $('sprite-list')
    list.replaceChildren()
    for (const name of this.spriteNames) {
      list.append(
        h('button', {
          className: 'sprite-item',
          'data-name': name,
          onclick: () => void this.openSprite(name),
        },
        this.thumbs.get(name) ?? h('span', { className: 'thumb' }),
        h('span', { className: 'sprite-label' }, name)),
      )
    }
    this.render()
  }
}

/** Image thumbnail (the canvas is scaled up in CSS, without smoothing). */
function makeThumb(bmp: Bitmap): HTMLCanvasElement {
  const c = h('canvas', { className: 'thumb', width: bmp.width, height: bmp.height })
  c.getContext('2d')!.putImageData(toImageData(bmp), 0, 0)
  const scale = 32 / Math.max(bmp.width, bmp.height)
  c.style.width = `${Math.max(1, Math.round(bmp.width * scale))}px`
  c.style.height = `${Math.max(1, Math.round(bmp.height * scale))}px`
  return c
}

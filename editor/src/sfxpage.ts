// The Sounds page (#sounds), after Music: the game's sound effects, drawn. Like the other
// pages, the tools on the left, the sound in the middle with Play under it, and on the right
// the sound's settings and the list of sounds.
//
// A sound is drawn on a grid of 24 columns (time) by 24 rows (pitch, a lighter row at every
// C): one pixel per column at most. The volume tool sets how loud each column is, as bars. A
// pixel is heard as it is placed; a setting changed plays the sound. Each texture has its own
// color, so a sound's look tells its texture.

import type { App } from './app'
import { confirmDialog, h, openDialog, toast } from './dialog'
import { icon } from './icons'
import { createActionsMenu, createEditorSwitch, createMenu, currentPage, goTo, onPage } from './menu'
import { audioContext } from './musicplayer'
import { isPlaying } from './play'
import type { Project } from './project'
import { SoundEditor, randomSound, type Setting, type SoundTool } from './sfx'
import { NAME_RE } from './sprite'
import { RATE } from '../../runtime/sound'
import {
  COLUMNS,
  ECHOES,
  GRITS,
  LOUDEST,
  RINGS,
  ROWS,
  SPEEDS,
  SPEED_SECONDS,
  TEXTURES,
  drawnSeconds,
  emptySound,
  lastColumn,
  parseSound,
  renderDry,
  renderSound,
  volumeGain,
  type Sound,
  type Texture,
} from '../../runtime/sfx'

const PRESET_FILES = import.meta.glob('../sounds/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/**
 * The presets, by name: what a new sound can start from. Only the editor has them: a game
 * plays only its own sounds, so the list shows exactly what is in its folder.
 */
const PRESETS = new Map(Object.entries(PRESET_FILES).map(([path, text]) => [path.replace(/^.*\//, '').replace(/\.json$/, ''), parseSound(text)] as const))

const TOOLS: { id: SoundTool; label: string; key: string; icon: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'B', icon: 'pencil' },
  { id: 'volume', label: 'Volume', key: 'V', icon: 'volume' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
]

/** Each texture's color: the grid, the thumbnails and the setting take it. */
const COLORS: Record<Texture, string> = {
  soft: '#6fe3b2',
  pluck: '#ff9f5a',
  glass: '#6cc6ff',
  retro: '#ffd23f',
  noise: '#ff7aa8',
  wood: '#c98a52',
  water: '#22c3d6',
  metal: '#a9b6c8',
  click: '#c4a6ff',
}

const words = (s: string) => s[0].toUpperCase() + s.slice(1).replace(/-/g, ' ')

/** The whole sound's volume, in dB under the loudest (the scale volumeGain uses). */
const levelName = (v: number) => (v === LOUDEST ? 'Loudest' : `−${Math.round((40 * (LOUDEST - v)) / LOUDEST)} dB`)

/** A pixel's opacity for its volume: a quiet one is faint, never invisible. */
const opacity = (v: number) => 0.3 + (0.7 * v) / LOUDEST

/** A sound drawn small, for the list. */
function thumbnail(s: Sound): string {
  let r = ''
  for (let c = 0; c < COLUMNS; c++) {
    const p = s.pitch[c]
    if (p !== null) r += `<rect x="${c}" y="${ROWS - 1 - p}" width="1" height="1" fill="${COLORS[s.texture]}" opacity="${opacity(s.volume[c])}"/>`
  }
  return `<svg class="sound-thumb" viewBox="0 0 ${COLUMNS} ${ROWS}" aria-hidden="true">${r}</svg>`
}

export class SoundsPage {
  readonly editor = new SoundEditor()
  /** The game's sounds (sounds/). */
  private readonly own = new Map<string, Sound>()
  private readonly root: HTMLElement
  private readonly grid: HTMLElement
  private readonly cells: HTMLElement[] = []
  private readonly playhead: HTMLElement
  private readonly empty: HTMLElement
  private readonly settings: HTMLElement
  private readonly list: HTMLElement
  private readonly status: HTMLElement
  private readonly length: HTMLElement
  private readonly playButton: HTMLButtonElement
  private readonly echo: HTMLInputElement
  private readonly ring: HTMLInputElement
  private readonly level: HTMLInputElement
  private readonly echoLabel: HTMLElement
  private readonly ringLabel: HTMLElement
  private readonly levelLabel: HTMLElement
  private readonly segments = new Map<'texture' | 'speed' | 'grit', HTMLButtonElement[]>()
  private readonly glide: HTMLButtonElement
  private readonly pending = new Set<string>()
  private timer = 0
  private chain: Promise<void> = Promise.resolve()
  private source: AudioBufferSourceNode | null = null
  private frame = 0
  private lastBlip = 0
  private listKey = ''
  /** Each row's thumbnail, by name: the open sound's is drawn again as it changes. */
  private readonly thumbs = new Map<string, HTMLElement>()

  constructor(
    private readonly project: Project,
    private readonly app: App,
  ) {
    this.editor.onEdit = (name) => this.schedule(name)
    this.editor.onPlace = (row, volume) => this.blip(row, volume)
    this.editor.subscribe(() => this.render())

    this.grid = h('div', { className: 'sound-grid', role: 'img', 'aria-label': 'The sound: time from left to right, pitch from bottom to top' })
    for (let i = 0; i < COLUMNS * ROWS; i++) {
      const cell = h('i', {})
      // A lighter row at every C (5 rows an octave).
      if ((ROWS - 1 - Math.floor(i / COLUMNS)) % 5 === 0) cell.className = 'octave'
      this.cells.push(cell)
      this.grid.append(cell)
    }
    this.playhead = h('div', { className: 'sound-playhead', hidden: true })
    this.grid.append(this.playhead)
    this.empty = h('div', { className: 'music-empty' }, h('p', {}, 'No sound open.'))
    this.status = h('span', { className: 'save-status', 'data-status': 'saved' }, 'Saved')
    this.length = h('span', { className: 'music-length' })
    this.playButton = h('button', { type: 'button', className: 'small icon-btn music-play', title: 'Play (Space)', 'aria-label': 'Play', html: icon('play'), onclick: () => {
      this.play()
      this.playButton.blur()
    } })

    const segment = (key: 'texture' | 'speed' | 'grit', values: readonly string[], columns: number) => {
      const buttons = values.map((v) => h('button', { type: 'button', 'data-value': v, onclick: () => this.setting(key, v as never) }, words(v)))
      this.segments.set(key, buttons)
      return h('div', { className: 'sound-segment', style: `grid-template-columns: repeat(${columns}, minmax(0, 1fr))` }, ...buttons)
    }
    const slider = (label: string, max: number, name: (i: number) => string, set: (i: number) => void) => {
      const value = h('span', {})
      const input = h('input', {
        type: 'range', min: 0, max, step: 1, 'aria-label': label,
        // The name follows the slider; the sound changes (and plays) when it is let go.
        oninput: () => (value.textContent = name(+input.value)),
        onchange: () => set(+input.value),
      })
      return { input, value, el: h('label', { className: 'sound-field' }, h('span', { className: 'sound-key' }, `${label}: `, value), input) }
    }
    const echo = slider('Echo', ECHOES.length - 1, (i) => words(ECHOES[i]), (i) => this.setting('echo', ECHOES[i]))
    const ring = slider('Ring', RINGS.length - 1, (i) => words(RINGS[i]), (i) => this.setting('ring', RINGS[i]))
    const level = slider('Volume', LOUDEST, levelName, (i) => this.setting('level', i))
    this.echo = echo.input
    this.echoLabel = echo.value
    this.ring = ring.input
    this.ringLabel = ring.value
    this.level = level.input
    this.levelLabel = level.value
    this.glide = h('button', { type: 'button', className: 'sound-glide', 'aria-pressed': 'false', title: 'Pitch slides between neighbouring pixels', onclick: () => this.setting('glide', !this.editor.sound?.glide) }, 'Glide')
    this.settings = h('section', { className: 'sound-settings' },
      h('div', { className: 'panel-head' }, h('h2', {}, 'Sound')),
      h('div', { className: 'sound-field' }, h('span', { className: 'sound-key' }, 'Texture'), segment('texture', TEXTURES, 3)),
      h('div', { className: 'sound-field' }, h('span', { className: 'sound-key' }, 'Speed'), segment('speed', SPEEDS, 4)),
      h('div', { className: 'sound-field' }, h('span', { className: 'sound-key' }, 'Grit'), segment('grit', GRITS, 3)),
      echo.el,
      ring.el,
      level.el,
      h('div', { className: 'sound-row' },
        this.glide,
        h('button', { type: 'button', title: 'A random sound', onclick: () => this.random() }, 'Random'),
        h('button', { type: 'button', title: 'Take every pixel away', onclick: () => this.editor.clear() }, 'Clear')))
    this.list = h('div', { className: 'world-list' })

    this.root = h('div', { id: 'sounds-page' },
      h('header', { className: 'page-bar' },
        createMenu(),
        createEditorSwitch(),
        h('span', { className: 'spacer' }),
        this.status,
        h('button', { type: 'button', className: 'run-game', title: 'Play the game (⌘↵)', html: `${icon('play')}<span>Play</span>`, onclick: () => this.app.play() })),
      h('div', { className: 'music-body' },
        h('nav', { className: 'world-tools', 'aria-label': 'Tools' },
          ...TOOLS.map((t) => h('button', {
            className: 'tool',
            title: `${t.label} (${t.key})`,
            'aria-label': t.label,
            'data-sound-tool': t.id,
            html: icon(t.icon),
            onclick: () => this.editor.setTool(t.id),
          })),
          h('hr', { className: 'tool-divider' }),
          h('button', { className: 'tool', title: 'Undo (⌘Z)', 'aria-label': 'Undo', html: icon('undo'), onclick: () => this.editor.undo() }),
          h('button', { className: 'tool', title: 'Redo (⇧⌘Z)', 'aria-label': 'Redo', html: icon('redo'), onclick: () => this.editor.redo() })),
        h('main', { className: 'music-stage sound-stage' }, this.grid, this.empty),
        h('div', { className: 'music-transport' },
          h('div', { className: 'bar-side' }),
          h('div', { className: 'music-buttons' }, this.playButton),
          h('div', { className: 'bar-side end' }, this.length)),
        h('aside', { className: 'world-side' },
          this.settings,
          h('section', { className: 'music-songs' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Sounds'),
              h('button', { type: 'button', className: 'small icon-btn', title: 'New sound', 'aria-label': 'New sound', html: icon('add'), onclick: () => void this.newSound() })),
            this.list))))
    document.body.append(this.root)

    this.bindPointer()
    this.bindKeys()
    const before = app.beforePlay
    app.beforePlay = async () => {
      this.stop()
      await before()
      await this.flush()
    }
    window.addEventListener('beforeunload', (e) => {
      if (this.pending.size) e.preventDefault()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush()
    })
  }

  /** Reads the game's sounds, then follows the page. */
  async load() {
    for (const name of await this.project.listSounds()) {
      try {
        this.own.set(name, await this.project.loadSound(name))
      } catch (err) {
        toast((err as Error).message)
      }
    }
    onPage((page) => {
      if (page !== 'sounds') {
        this.stop()
        return void this.flush()
      }
      if (!this.editor.sound) this.openSound(this.lastSound ?? this.names()[0] ?? null)
    })
  }

  // --- Sounds -----------------------------------------------------------------

  private names() {
    return [...this.own.keys()].sort()
  }

  private has(name: string) {
    return this.own.has(name)
  }

  private soundOf(name: string): Sound | null {
    return this.own.get(name) ?? null
  }

  private get lastKey() {
    return `lucarne:last-sound:${this.project.name}`
  }

  private get lastSound(): string | null {
    try {
      const name = localStorage.getItem(this.lastKey)
      return name && this.has(name) ? name : null
    } catch {
      return null
    }
  }

  private openSound(name: string | null) {
    this.stop()
    this.editor.open(name, name ? this.soundOf(name) : null)
    try {
      if (name) localStorage.setItem(this.lastKey, name)
    } catch {}
  }

  private unique(base: string) {
    if (!this.has(base)) return base
    for (let i = 2; ; i++) if (!this.has(`${base}${i}`)) return `${base}${i}`
  }

  private nameError(name: string, current?: string) {
    if (!NAME_RE.test(name)) return 'Name: lowercase letters, digits, “-” and “_” (e.g. jump).'
    if (name !== current && this.own.has(name)) return 'A sound with this name already exists.'
    return null
  }

  private async askName(title: string, value: string, action: string, current?: string) {
    const input = h('input', { type: 'text', value, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const res = await openDialog(title, h('div', { className: 'fields' }, h('label', {}, 'Name', input)), [
      { label: 'Cancel', value: 'cancel' },
      { label: action, value: 'ok', kind: 'primary' },
    ], () => this.nameError(input.value.trim(), current))
    return res === 'ok' ? input.value.trim() : null
  }

  private async add(name: string, sound: Sound) {
    try {
      await this.project.saveSound(name, sound)
    } catch (err) {
      return toast(`Could not save: ${(err as Error).message}`)
    }
    this.own.set(name, sound)
    this.openSound(name)
  }

  /**
   * Asks for a name and what the sound starts from: empty, or a copy of a preset. Pressing a
   * preset plays it and selects it, as many times as wanted, and names the sound after it
   * unless a name was typed.
   */
  private async newSound() {
    let chosen: string | null = null
    let auto = this.unique('sound')
    const input = h('input', { type: 'text', value: auto, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const items: HTMLButtonElement[] = []
    const item = (preset: string | null) => {
      const b = h('button', {
        type: 'button',
        className: 'instrument-item' + (preset === chosen ? ' active' : ''),
        onclick: () => {
          chosen = preset
          for (const i of items) i.classList.toggle('active', i === b)
          if (input.value.trim() === auto) input.value = auto = this.unique(preset ?? 'sound')
          if (preset) this.listen(PRESETS.get(preset)!)
          else this.stop()
        },
      },
      h('span', { className: 'sound-thumb-box', html: thumbnail(preset ? PRESETS.get(preset)! : emptySound()) }),
      preset ?? 'Empty')
      items.push(b)
      return b
    }
    const body = h('div', { className: 'fields' },
      h('label', {}, 'Name', input),
      h('div', { className: 'instrument-list' },
        h('h3', {}, 'Start from'),
        h('div', { className: 'instrument-grid' }, item(null), ...[...PRESETS.keys()].sort().map(item))))
    const res = await openDialog('New sound', body, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Create', value: 'ok', kind: 'primary' },
    ], () => this.nameError(input.value.trim()), 'instrument-dialog')
    this.stop()
    if (res !== 'ok') return
    await this.add(input.value.trim(), chosen ? structuredClone(PRESETS.get(chosen)!) : emptySound())
  }

  /** A preset, heard in the dialog. */
  private listen(s: Sound) {
    const data = renderSound(s)
    if (!data) return
    this.stop()
    this.source = this.start(data, 1)
    this.source.start()
  }

  private async duplicate(from: string) {
    await this.flush()
    const s = this.soundOf(from)
    if (s) await this.add(this.unique(`${from}-copy`), structuredClone(s))
  }

  private async rename(from: string) {
    const to = await this.askName('Rename sound', from, 'Rename', from)
    if (!to || to === from) return
    await this.flush()
    const sound = this.own.get(from)!
    try {
      await this.project.saveSound(to, sound)
      await this.project.deleteSound(from)
    } catch (err) {
      return toast(`Could not rename: ${(err as Error).message}`)
    }
    this.own.delete(from)
    this.own.set(to, sound)
    this.editor.renamed(from, to)
    if (this.editor.name === to) this.openSound(to)
    else this.render()
  }

  private async remove(name: string) {
    if (!(await confirmDialog('Delete sound', `“${name}” (sounds/${name}.json) will be deleted from the game folder. Git keeps the history of versions already committed.`, 'Delete', true))) return
    this.pending.delete(name)
    try {
      await this.project.deleteSound(name)
    } catch (err) {
      return toast(`Could not delete: ${(err as Error).message}`)
    }
    this.own.delete(name)
    this.editor.forget(name)
    if (this.editor.name === name) this.openSound(this.names()[0] ?? null)
    else this.render()
  }

  // --- Saving -----------------------------------------------------------------

  private schedule(name: string) {
    this.pending.add(name)
    this.setStatus('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
  }

  /** Saves the sounds changed, right away. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.pending.size) return this.chain
    const names = [...this.pending].filter((n) => this.own.has(n))
    this.pending.clear()
    this.setStatus('saving')
    this.chain = this.chain
      .then(async () => {
        for (const name of names) await this.project.saveSound(name, this.own.get(name)!)
      })
      .then(
        () => this.setStatus(this.pending.size ? 'pending' : 'saved'),
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

  // --- Editing ------------------------------------------------------------------

  /** A setting changed: the sound plays, to hear it. */
  private setting<K extends Setting>(key: K, value: Sound[K]) {
    if (!this.editor.sound) return
    this.editor.set(key, value)
    this.play()
  }

  private random() {
    if (!this.editor.sound) return
    this.editor.replace(randomSound())
    this.play()
  }

  private cellAt(e: PointerEvent): [number, number] {
    const b = this.grid.getBoundingClientRect()
    const col = Math.max(0, Math.min(COLUMNS - 1, Math.floor(((e.clientX - b.left) / b.width) * COLUMNS)))
    const row = ROWS - 1 - Math.max(0, Math.min(ROWS - 1, Math.floor(((e.clientY - b.top) / b.height) * ROWS)))
    return [col, row]
  }

  private bindPointer() {
    const g = this.grid
    g.addEventListener('contextmenu', (e) => e.preventDefault())
    g.addEventListener('pointerdown', (e) => {
      if (!this.editor.sound || (e.button !== 0 && e.button !== 2)) return
      e.preventDefault()
      audioContext()
      g.setPointerCapture(e.pointerId)
      const [c, r] = this.cellAt(e)
      this.editor.down(c, r, e.button === 2)
    })
    g.addEventListener('pointermove', (e) => {
      if (!g.hasPointerCapture(e.pointerId)) return
      const [c, r] = this.cellAt(e)
      this.editor.move(c, r)
    })
    for (const type of ['pointerup', 'pointercancel'] as const) g.addEventListener(type, () => this.editor.up())
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement
      if (currentPage() !== 'sounds' || isPlaying() || target.closest('input, select, textarea, dialog')) return
      const ed = this.editor
      const k = e.key.toLowerCase()
      if (e.metaKey || e.ctrlKey) {
        if (k === 'z') e.shiftKey ? ed.redo() : ed.undo()
        else if (k === 'y') ed.redo()
        else if (k === 's') void this.flush()
        else return
      } else if (e.altKey) return
      else if (e.key === ' ' || e.key === 'Enter') this.play()
      else if (k === 'b') ed.setTool('pencil')
      else if (k === 'v') ed.setTool('volume')
      else if (k === 'e') ed.setTool('eraser')
      else if (e.key === 'Escape') {
        if (this.source) this.stop()
        else goTo('editor')
      } else return
      e.preventDefault()
    })
  }

  // --- Playing ------------------------------------------------------------------

  /** Plays the whole sound, with the playhead going over its columns. Made at once, in the
   *  click: nothing to wait for, so nothing can come in between. */
  private play() {
    const s = this.editor.sound
    if (!s) return
    const ctx = audioContext()
    const data = renderSound(s)
    if (!data) return toast('Draw at least one pixel first.')
    this.stop()
    const source = this.start(data, 1)
    this.source = source
    const t0 = ctx.currentTime
    source.start()
    source.onended = () => {
      if (this.source === source) this.stop()
    }
    const d = SPEED_SECONDS[s.speed], last = lastColumn(s) + 1
    const step = () => {
      const col = Math.floor((ctx.currentTime - t0) / d)
      if (col >= last) return void (this.playhead.hidden = true)
      if (col >= 0) {
        this.playhead.hidden = false
        this.playhead.style.left = `${(col * 100) / COLUMNS}%`
      }
      this.frame = requestAnimationFrame(step)
    }
    this.frame = requestAnimationFrame(step)
  }

  /** A sound at RATE, ready to start. */
  private start(data: Float32Array, gain: number) {
    const ctx = audioContext()
    const buffer = ctx.createBuffer(1, data.length, RATE)
    buffer.getChannelData(0).set(data)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const g = ctx.createGain()
    g.gain.value = gain
    source.connect(g).connect(ctx.destination)
    return source
  }

  private stop() {
    cancelAnimationFrame(this.frame)
    this.playhead.hidden = true
    const s = this.source
    this.source = null
    try {
      s?.stop()
    } catch {}
  }

  /** One pixel, heard as it is placed: the sound's texture, at that pixel's volume. */
  private blip(row: number, volume: number) {
    const now = performance.now()
    if (now - this.lastBlip < 45) return
    this.lastBlip = now
    const s = this.editor.sound!
    const one = emptySound()
    Object.assign(one, { texture: s.texture, grit: s.grit, ring: s.ring, level: s.level, speed: 'slow' })
    one.pitch[0] = row
    const data = renderDry(one)
    if (data) this.start(data, 0.75 * volumeGain(volume) + 0.03).start()
  }

  // --- Rendering ------------------------------------------------------------------

  private render() {
    const ed = this.editor
    const s = ed.sound
    this.grid.hidden = !s
    this.settings.hidden = !s
    this.empty.hidden = !!s
    this.playButton.disabled = !s
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-sound-tool]')) el.classList.toggle('active', el.dataset.soundTool === ed.tool)
    this.renderList()
    if (!s) return void (this.length.textContent = '')
    this.root.style.setProperty('--tc', COLORS[s.texture])
    const last = lastColumn(s)
    const volume = ed.tool === 'volume'
    this.grid.classList.toggle('volume', volume)
    for (let i = 0; i < this.cells.length; i++) {
      const c = i % COLUMNS, r = ROWS - 1 - Math.floor(i / COLUMNS), el = this.cells[i]
      const on = s.pitch[c] === r
      const bar = volume && !on && r <= s.volume[c]
      el.classList.toggle('on', on)
      el.classList.toggle('bar', bar)
      el.classList.toggle('empty-bar', bar && s.pitch[c] === null)
      el.classList.toggle('after', !on && !bar && c > last)
      el.style.opacity = on && !volume ? String(opacity(s.volume[c])) : ''
    }
    for (const [key, buttons] of this.segments) for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === s[key]))
    this.glide.setAttribute('aria-pressed', String(s.glide))
    this.echo.value = String(ECHOES.indexOf(s.echo))
    this.echoLabel.textContent = words(s.echo)
    this.ring.value = String(RINGS.indexOf(s.ring))
    this.ringLabel.textContent = words(s.ring)
    this.level.value = String(s.level)
    this.levelLabel.textContent = levelName(s.level)
    const n = last + 1
    this.length.textContent = n ? `${n} column${n > 1 ? 's' : ''} · ${Math.round(drawnSeconds(s) * 1000)} ms` : 'Empty'
  }

  /** The list, built again only when its sounds change; the open sound's thumbnail follows it. */
  private renderList() {
    const ed = this.editor
    const key = JSON.stringify([ed.name, this.names()])
    if (key === this.listKey) {
      const thumb = ed.name && ed.sound ? this.thumbs.get(ed.name) : null
      if (thumb) thumb.innerHTML = thumbnail(ed.sound!)
      return
    }
    this.listKey = key
    this.list.replaceChildren()
    this.thumbs.clear()
    if (!this.own.size) this.list.append(h('p', { className: 'muted' }, 'Add a sound: + next to Sounds.'))
    for (const name of this.names()) {
      const s = name === ed.name && ed.sound ? ed.sound : this.own.get(name)!
      const menu = createActionsMenu(`Options for ${name}`, [
        { label: 'Rename', run: () => void this.rename(name) },
        { label: 'Duplicate', run: () => void this.duplicate(name) },
        { label: 'Delete', run: () => void this.remove(name), danger: true },
      ])
      this.list.append(
        h('div', { className: 'sprite-row' },
          h('button', {
            className: 'sprite-item' + (name === ed.name ? ' active' : ''),
            title: `${name} (sounds/${name}.json)`,
            onclick: () => {
              this.openSound(name)
              this.play()
            },
          },
          this.thumbs.set(name, h('span', { className: 'sound-thumb-box', html: thumbnail(s) })).get(name),
          h('span', { className: 'sprite-label' }, name)),
          menu.el))
    }
  }
}

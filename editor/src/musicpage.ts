// The Music page (#music), after World: the game's songs. Like the Pixels page, the tools on
// the left, the song in the middle, and on the right what is painted with (the instruments, as
// the palette) and what is painted (the songs, as the sprites).
//
// The song is one grid: time from left to right, in sixteenths (a line at every bar), the
// notes from bottom to top (a line at every octave). Every instrument of the song is on it: the
// one selected filled with its color, the others as thin outlines of theirs, over it, so that
// no note hides another (they are not edited there: an instrument is picked in the list). A
// drum has no pitch: it is a row of its own, under the notes. The ruler on top shows the bars, and where playing starts.
// Under the grid, the tempo, the time and Play: the song loops while it is painted, and a note plays
// as it is placed.

import type { App } from './app'
import { confirmDialog, h, openDialog, toast } from './dialog'
import { icon } from './icons'
import { Instruments } from './instruments'
import { MusicEditor, type MusicTool } from './music'
import { MusicPlayer } from './musicplayer'
import { createActionsMenu, createEditorSwitch, createMenu, currentPage, goTo, onPage } from './menu'
import { isPlaying } from './play'
import { singTake } from './singdialog'
import type { Project } from './project'
import { NAME_RE } from './sprite'
import {
  HIGHEST,
  LOWEST,
  MAX_TEMPO,
  MIN_TEMPO,
  DEFAULT_TIME,
  TIMES,
  noteEnd,
  noteName,
  songSteps,
  stepSeconds,
  type Instrument,
  type Time,
  type Note,
  type Song,
} from '../../runtime/sound'

const TOOLS: { id: MusicTool; label: string; key: string; icon: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'B', icon: 'pencil' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { id: 'select', label: 'Select', key: 'M', icon: 'select' },
]

/** Each instrument's color, by its place in the song: no setting, always told apart. */
const COLORS = ['#41a6f6', '#ffcd75', '#a7f070', '#ef7d57', '#73eff7', '#e0566b', '#c49cf2', '#94b0c2']
export const instrumentColor = (i: number) => COLORS[i % COLORS.length]

/** The grid's sizes, in CSS pixels. */
const RULER = 24
const GUTTER = 44
const ROW = 14
const LANE = 22
const MIN_STEP = 6
const MAX_STEP = 48
/** How close to the end of a note the pencil resizes it rather than moving it. */
const EDGE = 6
/** Bars of grid after the end of the song, to paint further. */
const AFTER = 2
const ROWS = HIGHEST - LOWEST + 1

/** What is under a point of the grid. */
type Hit =
  | { area: 'ruler'; step: number }
  | { area: 'gutter' | 'lane'; step: number; lane: number; part: number | undefined }
  | { area: 'keys' | 'notes'; step: number; pitch: number }

/** What a pointer is doing on the grid, from down to up. */
type Drag =
  | { kind: 'length'; note: Note; from: number }
  | { kind: 'move'; notes: Note[]; from: Map<Note, { step: number; pitch: number | null }>; step: number; pitch: number; heard: number | null; moved: boolean; picked: Note | null }
  | { kind: 'erase' }
  | { kind: 'box'; step: number; pitch: number | null; to: { step: number; pitch: number | null }; lane: boolean }
  | { kind: 'hits'; part: number; add: boolean; done: Set<number>; last: number | null }
  | { kind: 'start' }
  | { kind: 'pan'; x: number; y: number; sx: number; sy: number }

export class MusicPage {
  readonly editor = new MusicEditor()
  private readonly instruments: Instruments
  private readonly player = new MusicPlayer()
  private readonly root: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly stage: HTMLElement
  private readonly empty: HTMLElement
  private readonly status: HTMLElement
  private readonly instrumentList: HTMLElement
  private readonly instrumentsPanel: HTMLElement
  private readonly songList: HTMLElement
  private readonly tempo: HTMLInputElement
  private readonly time: HTMLSelectElement
  private readonly playButton: HTMLButtonElement
  private readonly recordButton: HTMLButtonElement
  private singing = false
  private readonly length: HTMLElement
  private readonly songs = new Map<string, Song>()
  private readonly pending = new Set<string>()
  private timer = 0
  private chain: Promise<void> = Promise.resolve()
  /** Horizontal and vertical scroll of the grid, and its zoom (CSS pixels per step). */
  private sx = 0
  private sy = 0
  private stepWidth = 18
  private drag: Drag | null = null
  private hover: { step: number; pitch: number | null; lane: number | null } | null = null
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private renderTimer = 0
  private frame = 0
  private listKey = ''

  constructor(
    private readonly project: Project,
    private readonly app: App,
  ) {
    this.instruments = new Instruments(project)
    this.instruments.onChange = () => {
      this.editor.emit()
      this.refreshSound()
    }
    this.editor.isDrum = (name) => this.instruments.isDrum(name)
    this.editor.onEdit = (name) => this.schedule(name)
    this.editor.subscribe(() => this.render())

    this.canvas = h('canvas', { className: 'music-canvas' })
    this.status = h('span', { className: 'save-status', 'data-status': 'saved' }, 'Saved')
    this.instrumentList = h('div', { className: 'world-list' })
    this.songList = h('div', { className: 'world-list' })
    this.empty = h('div', { className: 'music-empty' },
      h('p', {}, 'No songs yet.'),
      h('button', { type: 'button', className: 'primary', onclick: () => void this.newSong() }, 'New song'))
    this.tempo = h('input', {
      type: 'number',
      min: MIN_TEMPO,
      max: MAX_TEMPO,
      step: 1,
      inputMode: 'numeric',
      'aria-label': 'Tempo, in quarter notes per minute',
      onchange: () => this.setTempo(),
      onkeydown: (e: KeyboardEvent) => {
        e.stopPropagation()
        if (e.key === 'Enter') this.tempo.blur()
      },
    })
    // The time signature: it only sets where the bar and beat lines fall; notes never move.
    this.time = h('select', {
      'aria-label': 'Time signature',
      onchange: () => this.editor.setTime(this.time.value as Time),
    }, ...Object.keys(TIMES).map((t) => h('option', { value: t }, t)))
    this.playButton = h('button', { type: 'button', className: 'small icon-btn music-play', title: 'Play / stop (Space)', 'aria-label': 'Play', onclick: () => {
      this.togglePlay()
      // Space plays and stops: the button must not keep the focus, or it would click too.
      this.playButton.blur()
    } })
    this.recordButton = h('button', { type: 'button', className: 'small icon-btn music-record', title: 'Sing into the instrument (R)', 'aria-label': 'Sing into the instrument', html: icon('record'), onclick: () => {
      void this.sing()
      this.recordButton.blur()
    } })
    this.length = h('span', { className: 'music-length' })
    const tools = h('nav', { className: 'world-tools', 'aria-label': 'Tools' },
      ...TOOLS.map((t) => h('button', {
        className: 'tool',
        title: `${t.label} (${t.key})`,
        'aria-label': t.label,
        'data-music-tool': t.id,
        html: icon(t.icon),
        onclick: () => this.editor.setTool(t.id),
      })))
    this.root = h('div', { id: 'music-page' },
      h('header', { className: 'page-bar' },
        createMenu([{ label: 'Import an instrument…', run: () => void this.importInstrument() }]),
        createEditorSwitch(),
        h('span', { className: 'spacer' }),
        this.status,
        h('button', { type: 'button', className: 'run-game', title: 'Play the game (⌘↵)', html: `${icon('play')}<span>Play</span>`, onclick: () => this.app.play() })),
      h('div', { className: 'music-body' },
        tools,
        this.stage = h('main', { className: 'music-stage' }, this.canvas, this.empty),
        h('div', { className: 'music-transport' },
          h('div', { className: 'bar-side' },
            h('label', { className: 'music-tempo', title: 'Quarter notes per minute' }, 'Tempo', this.tempo),
            h('label', { className: 'music-tempo' }, 'Time', this.time)),
          h('div', { className: 'music-buttons' }, this.playButton, this.recordButton),
          h('div', { className: 'bar-side end' }, this.length)),
        h('aside', { className: 'world-side' },
          this.instrumentsPanel = h('section', { className: 'music-instruments' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Instruments'),
              h('button', { type: 'button', className: 'small icon-btn', title: 'Add an instrument', 'aria-label': 'Add an instrument', html: icon('add'), onclick: () => void this.addInstrument() })),
            this.instrumentList),
          h('section', { className: 'music-songs' },
            h('div', { className: 'panel-head' }, h('h2', {}, 'Songs'),
              h('button', { type: 'button', className: 'small icon-btn', title: 'New song', 'aria-label': 'New song', html: icon('add'), onclick: () => void this.newSong() })),
            this.songList))))
    document.body.append(this.root)

    new ResizeObserver(() => this.fit()).observe(this.stage)
    this.bindPointer()
    this.bindKeys()

    const before = app.beforePlay
    app.beforePlay = async () => {
      // The game plays alone.
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

  /** Reads the songs and the instruments, then follows the page. */
  async load() {
    for (const name of await this.project.listSongs()) {
      try {
        this.songs.set(name, await this.project.loadSong(name))
      } catch (err) {
        toast((err as Error).message)
      }
    }
    let started = false
    onPage((page) => {
      if (page !== 'music') {
        this.stop()
        return void this.flush()
      }
      if (!started) {
        started = true
        // The recordings are read the first time the page shows.
        void this.instruments.load()
      }
      if (!this.editor.song) this.openSong(this.lastSong ?? [...this.songs.keys()][0] ?? null)
      this.fit()
    })
  }

  // --- Songs ------------------------------------------------------------------

  private get lastKey() {
    return `lucarne:last-song:${this.project.name}`
  }

  private get lastSong(): string | null {
    try {
      const name = localStorage.getItem(this.lastKey)
      return name && this.songs.has(name) ? name : null
    } catch {
      return null
    }
  }

  private openSong(name: string | null) {
    this.stop()
    this.editor.open(name, name ? (this.songs.get(name) ?? null) : null)
    try {
      if (name) localStorage.setItem(this.lastKey, name)
    } catch {}
    this.sx = 0
    this.renderLists()
    // Shown first (a first song): the canvas has its size to center in.
    this.render()
    this.centerOnNotes()
    this.draw()
  }

  private uniqueSong(base: string) {
    if (!this.songs.has(base)) return base
    for (let i = 2; ; i++) if (!this.songs.has(`${base}${i}`)) return `${base}${i}`
  }

  private songNameError(name: string, current?: string) {
    if (!NAME_RE.test(name)) return 'Name: lowercase letters, digits, “-” and “_” (e.g. town).'
    if (name !== current && this.songs.has(name)) return 'A song with this name already exists.'
    return null
  }

  private async askName(title: string, value: string, action: string, current?: string) {
    const input = h('input', { type: 'text', value, autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const res = await openDialog(title, h('div', { className: 'fields' }, h('label', {}, 'Name', input)), [
      { label: 'Cancel', value: 'cancel' },
      { label: action, value: 'ok', kind: 'primary' },
    ], () => this.songNameError(input.value.trim(), current))
    return res === 'ok' ? input.value.trim() : null
  }

  async newSong() {
    const name = await this.askName('New song', this.uniqueSong('song'), 'Create')
    if (!name) return
    // A first instrument, to paint notes right away.
    const song: Song = { tempo: 120, time: DEFAULT_TIME, instruments: [{ instrument: 'flute', notes: [] }] }
    try {
      await this.project.saveSong(name, song)
    } catch (err) {
      return toast(`Could not create: ${(err as Error).message}`)
    }
    this.songs.set(name, song)
    this.openSong(name)
  }

  private async renameSong(from: string) {
    const to = await this.askName('Rename song', from, 'Rename', from)
    if (!to || to === from) return
    await this.flush()
    const song = this.songs.get(from)!
    try {
      await this.project.saveSong(to, song)
      await this.project.deleteSong(from)
    } catch (err) {
      return toast(`Could not rename: ${(err as Error).message}`)
    }
    this.songs.delete(from)
    this.songs.set(to, song)
    this.editor.renamed(from, to)
    if (this.editor.name === to) this.openSong(to)
    else this.renderLists()
  }

  private async duplicateSong(from: string) {
    await this.flush()
    const name = this.uniqueSong(`${from}-copy`)
    const song: Song = structuredClone(this.songs.get(from)!)
    try {
      await this.project.saveSong(name, song)
    } catch (err) {
      return toast(`Could not duplicate: ${(err as Error).message}`)
    }
    this.songs.set(name, song)
    this.openSong(name)
  }

  private async deleteSong(name: string) {
    const ok = await confirmDialog('Delete song', `“${name}” (songs/${name}.json) will be deleted from the game folder. Git keeps the history of versions already committed.`, 'Delete', true)
    if (!ok) return
    this.pending.delete(name)
    try {
      await this.project.deleteSong(name)
    } catch (err) {
      return toast(`Could not delete: ${(err as Error).message}`)
    }
    this.songs.delete(name)
    this.editor.forget(name)
    if (this.editor.name === name) this.openSong([...this.songs.keys()][0] ?? null)
    else this.renderLists()
  }

  // --- Saving -----------------------------------------------------------------

  private schedule(name: string) {
    this.pending.add(name)
    this.setStatus('pending')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), 400)
    this.refreshSound()
  }

  /** Saves the songs changed, right away. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (!this.pending.size) return this.chain
    const names = [...this.pending].filter((n) => this.songs.has(n))
    this.pending.clear()
    this.setStatus('saving')
    this.chain = this.chain
      .then(async () => {
        for (const name of names) await this.project.saveSong(name, this.songs.get(name)!)
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

  // --- Instruments -------------------------------------------------------------

  /**
   * Asks for an instrument: the engine's and the game's. Pressing a name plays it and
   * selects it, as many times as wanted, so instruments can be heard one after the other
   * before choosing; only `ok` takes it (a second press taking it would cut listening short). The song's other instruments are there, but
   * can't be taken: a song has each instrument once.
   */
  private async pickInstrument(title: string, ok: string, current?: string): Promise<string | null> {
    let chosen = current ?? null
    const taken = new Set(this.editor.song?.instruments.map((p) => p.instrument).filter((n) => n !== current))
    const list = h('div', { className: 'instrument-list' })
    const items: HTMLButtonElement[] = []
    const group = (label: string, drums: boolean) => {
      const insts = this.instruments.list().filter((i) => i.drum === drums)
      if (!insts.length) return
      list.append(h('h3', {}, label))
      const grid = h('div', { className: 'instrument-grid' })
      for (const i of insts) {
        const item = h('button', {
          type: 'button',
          className: 'instrument-item' + (i.name === chosen ? ' active' : ''),
          disabled: taken.has(i.name),
          title: taken.has(i.name) ? 'Already in the song' : undefined,
          onclick: () => {
            chosen = i.name
            for (const b of items) b.classList.toggle('active', b === item)
            add.disabled = false
            this.listen(i.name)
          },
        }, i.name, i.own ? h('small', {}, 'game') : null)
        items.push(item)
        grid.append(item)
      }
      list.append(grid)
    }
    if (!this.instruments.list().length) list.append(h('p', { className: 'muted' }, 'Loading the instruments…'))
    group('Instruments', false)
    group('Drums', true)
    const res = openDialog(title, list, [
      { label: 'Import…', value: 'import', kind: 'left' },
      { label: 'Cancel', value: 'cancel' },
      { label: ok, value: 'ok', kind: 'primary' },
    ], undefined, 'instrument-dialog')
    // The dialog opens with nothing focused: a name lit by focus would read as chosen.
    const dialog = list.closest('dialog')!
    const add = dialog.querySelector<HTMLButtonElement>('button[value="ok"]')!
    add.disabled = !chosen
    dialog.tabIndex = -1
    dialog.focus()
    const value = await res
    if (value === 'import') return this.importInstrument()
    if (value === 'ok') return chosen
    return value
  }

  private listen(name: string) {
    const inst = this.instruments.get(name)
    if (inst) this.player.note(inst, inst.note, 0.8)
  }

  private async importInstrument() {
    return this.instruments.import(() => this.player.audio(), (inst) => this.player.note(inst, inst.note, 0.8))
  }

  private async addInstrument() {
    if (!this.editor.song) return toast('Create a song first.')
    const name = await this.pickInstrument('Add an instrument', 'Add')
    if (name) this.editor.addInstrument(name)
  }

  private async replaceInstrument(i: number) {
    const t = this.editor.song?.instruments[i]
    if (!t) return
    const name = await this.pickInstrument(`Replace the ${t.instrument}`, 'Replace', t.instrument)
    if (!name || name === t.instrument) return
    // An instrument just imported can have the name of one already in the song.
    if (this.editor.has(name)) return toast(`The song already has the ${name}.`)
    this.editor.replaceInstrument(i, name)
  }

  private accompany(i: number) {
    const t = this.editor.song?.instruments[i]
    if (!t) return
    if (!this.editor.accompany(i, this.instruments.voice(t.instrument))) toast(`Nothing to accompany: the other instruments play no notes yet.`)
  }

  private async removeInstrument(i: number) {
    const t = this.editor.song?.instruments[i]
    if (!t) return
    if (t.notes.length && !(await confirmDialog(`Remove the ${t.instrument}`, `The ${t.instrument} and its ${t.notes.length} note${t.notes.length > 1 ? 's' : ''} will be removed from the song (undo brings them back).`, 'Remove', true))) return
    this.editor.removeInstrument(i)
  }

  // --- Playing ------------------------------------------------------------------

  /** The instruments as the song plays: a muted one is silent, as a missing one is. */
  private get lookup() {
    return (name: string): Instrument | undefined => (this.editor.muted.has(name) ? undefined : this.instruments.get(name))
  }

  private togglePlay() {
    const song = this.editor.song
    if (!song) return
    if (this.player.playing) return this.stop()
    this.player.play(song, this.lookup, this.editor.start)
    this.tick()
    this.renderTransport()
  }

  private stop() {
    if (!this.player.playing) return
    this.player.stop()
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.renderTransport()
    this.draw()
  }

  /** The song changed while it plays: heard soon after (once per burst of edits). */
  private refreshSound() {
    if (!this.player.playing) return
    clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => {
      if (this.editor.song) this.player.update(this.editor.song, this.lookup)
    }, 60)
  }

  // --- Singing ------------------------------------------------------------------

  /**
   * Sings into the selected instrument, in a popup (singdialog.ts): the take replaces its notes
   * from the start marker to the end of its last note, and comes selected. One undo.
   */
  private async sing() {
    const ed = this.editor
    const song = ed.song
    const part = ed.current
    if (!song || !part || this.singing) return
    this.stop()
    this.singing = true
    let notes: Note[] | null
    try {
      notes = await singTake(this.player, song, ed.drum, this.instruments.get('claves'))
    } catch (err) {
      const e = err as Error
      console.error('Microphone:', e)
      return toast(e.name === 'NotAllowedError' ? 'The microphone is not allowed: allow it for this site (and, on a Mac, for the app in System Settings › Privacy › Microphone).' : `No microphone: ${e.message}.`)
    } finally {
      this.singing = false
    }
    if (!notes) return
    // Something else was opened meanwhile: the take is dropped.
    if (ed.song !== song || ed.current !== part) return
    if (!notes.length) return toast('No voice heard.')
    const from = ed.start
    const placed = notes.map((n) => ({ ...n, step: n.step + from }))
    ed.sing(placed, from, Math.max(...placed.map(noteEnd)))
  }

  /** Draws the playhead while playing, and keeps it in view. */
  private tick() {
    cancelAnimationFrame(this.frame)
    const loop = () => {
      const at = this.player.position()
      if (at === null) return
      const x = GUTTER + at * this.stepWidth - this.sx
      const w = this.canvas.clientWidth
      if (!this.drag && (x > w - 24 || x < GUTTER)) this.sx = Math.max(0, at * this.stepWidth - 24)
      this.draw()
      this.frame = requestAnimationFrame(loop)
    }
    this.frame = requestAnimationFrame(loop)
  }

  /** A note as it is placed or moved: heard alone (nothing when the song plays: it is in it). */
  private hear(pitch: number | null, length: number, part = this.editor.selected) {
    const song = this.editor.song
    const t = song?.instruments[part]
    const inst = t && this.instruments.get(t.instrument)
    if (!song || !inst || this.player.playing) return
    this.player.note(inst, pitch, Math.min(1, length * stepSeconds(song.tempo)))
  }

  private setTempo() {
    const v = Math.round(Number(this.tempo.value))
    if (!Number.isFinite(v) || v < MIN_TEMPO || v > MAX_TEMPO) {
      toast(`Tempo: between ${MIN_TEMPO} and ${MAX_TEMPO} quarter notes per minute.`)
      this.renderTransport()
      return
    }
    this.editor.setTempo(v)
  }

  // --- Geometry -----------------------------------------------------------------

  /** The drums, in the order of the rows under the notes. */
  private lanes(): number[] {
    const song = this.editor.song
    if (!song) return []
    return song.instruments.map((t, i) => (this.instruments.isDrum(t.instrument) ? i : -1)).filter((i) => i >= 0)
  }

  private get lanesHeight() {
    return this.lanes().length * LANE
  }

  /** The top of the drum rows (CSS pixels). */
  private get lanesTop() {
    return this.canvas.clientHeight - this.lanesHeight
  }

  /** Steps in a bar and in a beat of the open song. */
  private get bar(): number {
    return TIMES[this.editor.song?.time ?? DEFAULT_TIME].bar
  }

  private get beat(): number {
    return TIMES[this.editor.song?.time ?? DEFAULT_TIME].beat
  }

  /** How many steps the grid shows: the song and a little more, at least the canvas. */
  private get gridSteps() {
    const song = this.editor.song
    const bar = this.bar
    const steps = song ? songSteps(song) + AFTER * bar : bar
    const visible = Math.ceil((this.canvas.clientWidth - GUTTER + this.sx) / this.stepWidth)
    return Math.max(steps, Math.ceil(visible / bar) * bar)
  }

  private clampScroll() {
    const notesHeight = this.lanesTop - RULER
    this.sy = Math.max(0, Math.min(ROWS * ROW - notesHeight, this.sy))
    if (ROWS * ROW < notesHeight) this.sy = 0
    this.sx = Math.max(0, this.sx)
  }

  /** Scrolls so the notes (or C5, when there are none) are in the middle. */
  private centerOnNotes() {
    const song = this.editor.song
    const pitches = song?.instruments.flatMap((t) => t.notes.map((n) => n.pitch).filter((p): p is number => p !== null)) ?? []
    const mid = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 72
    const notesHeight = (this.canvas.clientHeight || 400) - this.lanesHeight - RULER
    this.sy = (HIGHEST - mid) * ROW - notesHeight / 2
    this.clampScroll()
  }

  /** What is under a point of the canvas (CSS pixels). */
  private at(x: number, y: number): Hit {
    const step = Math.floor((x - GUTTER + this.sx) / this.stepWidth)
    if (y < RULER) return { area: 'ruler', step: Math.max(0, Math.round((x - GUTTER + this.sx) / this.stepWidth)) }
    if (y >= this.lanesTop && this.lanes().length) {
      const lane = Math.max(0, Math.min(this.lanes().length - 1, Math.floor((y - this.lanesTop) / LANE)))
      return { area: x < GUTTER ? 'gutter' : 'lane', step, lane, part: this.lanes()[lane] }
    }
    const pitch = HIGHEST - Math.floor((y - RULER + this.sy) / ROW)
    return { area: x < GUTTER ? 'keys' : 'notes', step, pitch: Math.max(LOWEST, Math.min(HIGHEST, pitch)) }
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // --- Pointer --------------------------------------------------------------------

  private bindPointer() {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const p = this.local(e)
      // A mouse is one pointer: one left behind (its release lost) must not make this a pinch.
      if (e.pointerType !== 'touch') {
        this.pointers.clear()
        if (this.drag) this.endDrag()
      }
      this.pointers.set(e.pointerId, p)
      try {
        c.setPointerCapture(e.pointerId)
      } catch {}
      // Two fingers: the grid scrolls, whatever the tool.
      if (this.pointers.size === 2) {
        if (this.drag && this.drag.kind !== 'pan') this.editor.end()
        const m = this.middle()
        this.drag = { kind: 'pan', x: m.x, y: m.y, sx: this.sx, sy: this.sy }
        return
      }
      if (this.pointers.size > 2) return
      this.down(p.x, p.y, e)
    })
    c.addEventListener('pointermove', (e) => {
      const p = this.local(e)
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p)
      if (this.drag?.kind === 'pan') {
        const m = this.middle()
        this.sx = this.drag.sx - (m.x - this.drag.x)
        this.sy = this.drag.sy - (m.y - this.drag.y)
        this.clampScroll()
        return this.draw()
      }
      if (this.drag) return this.moveDrag(p.x, p.y)
      this.hoverAt(p.x, p.y)
    })
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId)
      if (this.drag?.kind === 'pan') {
        if (!this.pointers.size) this.drag = null
        return
      }
      if (this.drag) this.endDrag()
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('lostpointercapture', (e) => {
      if (this.pointers.has(e.pointerId)) up(e)
    })
    c.addEventListener('pointerleave', () => {
      if (this.drag) return
      this.hover = null
      this.draw()
    })
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const p = this.local(e)
      if (pinch && e.ctrlKey) return // Safari: already zoomed by gesturechange
      if (e.ctrlKey || e.metaKey) {
        // Pinch (other browsers) or ⌘ + wheel.
        return this.zoomAt(this.stepWidth * Math.exp(-e.deltaY * 0.01), p.x)
      } else {
        this.sx += e.shiftKey ? e.deltaY : e.deltaX
        if (!e.shiftKey) this.sy += e.deltaY
      }
      this.clampScroll()
      this.draw()
    }, { passive: false })

    // Safari (macOS) reports a trackpad pinch as GestureEvents with a cumulative `scale`,
    // not as ctrl + wheel. On iPad the fingers are touch pointers already: ignored here.
    type SafariGesture = Event & { scale: number; clientX: number; clientY: number }
    let pinch: { width: number; x: number } | null = null
    c.addEventListener('gesturestart', (e) => {
      if (this.pointers.size) return
      const g = e as SafariGesture
      pinch = { width: this.stepWidth, x: g.clientX - c.getBoundingClientRect().left }
    })
    c.addEventListener('gesturechange', (e) => {
      if (pinch && !this.pointers.size) this.zoomAt(pinch.width * (e as SafariGesture).scale, pinch.x)
    })
    c.addEventListener('gestureend', () => (pinch = null))
  }

  /** Zooms the time to `width` CSS pixels per step, the step under `x` staying there. */
  private zoomAt(width: number, x: number) {
    const at = (x - GUTTER + this.sx) / this.stepWidth
    this.stepWidth = Math.max(MIN_STEP, Math.min(MAX_STEP, width))
    this.sx = at * this.stepWidth - (x - GUTTER)
    this.clampScroll()
    this.draw()
  }

  private middle() {
    const ps = [...this.pointers.values()]
    return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length }
  }

  private down(x: number, y: number, e: PointerEvent) {
    const ed = this.editor
    const song = ed.song
    if (!song) return
    const hit = this.at(x, y)
    if (hit.area === 'ruler') {
      this.setStart(hit.step)
      this.drag = { kind: 'start' }
      return
    }
    if (hit.area === 'keys') return this.hear(hit.pitch, 4)
    if (hit.area === 'gutter') {
      if (hit.part !== undefined) ed.select(hit.part)
      return
    }
    if (!song.instruments.length) return toast('Add an instrument to play notes: + next to Instruments.')

    if (hit.area === 'lane') {
      const part = hit.part
      if (part === undefined) return
      ed.select(part)
      if (ed.tool === 'select') {
        this.drag = { kind: 'box', step: hit.step, pitch: null, to: { step: hit.step, pitch: null }, lane: true }
        return this.draw()
      }
      const there = ed.noteAt(hit.step, null, part)
      const add = ed.tool === 'pencil' && !there
      ed.begin()
      this.drag = { kind: 'hits', part, add, done: new Set(), last: null }
      this.paintHit(hit.step)
      return
    }

    // The notes, for an instrument that has them.
    if (hit.area !== 'notes') return
    if (ed.drum) {
      toast(`The ${ed.current!.instrument} plays on its row, under the notes.`)
      return
    }
    const note = ed.noteAt(hit.step, hit.pitch)
    if (ed.tool === 'eraser') {
      ed.begin()
      this.drag = { kind: 'erase' }
      if (note) ed.remove([note])
      return
    }
    // A click on a note selects it, with the pencil as with Select; ⇧ adds it or takes it
    // away. Dragging it moves every note selected.
    if (note && e.shiftKey) {
      if (ed.pick(note, true)) this.startMove([...ed.selection], hit.step, hit.pitch, null)
      return
    }
    if (ed.tool === 'select') {
      if (note) {
        ed.pick(note)
        return this.startMove([...ed.selection], hit.step, hit.pitch, note)
      }
      this.drag = { kind: 'box', step: hit.step, pitch: hit.pitch, to: { step: hit.step, pitch: hit.pitch }, lane: false }
      return this.draw()
    }
    // The pencil: a note's end lengthens it, its body selects and moves it, an empty cell
    // places one (and leaves the selection, unless ⇧ is held).
    if (note) {
      const endX = GUTTER + noteEnd(note) * this.stepWidth - this.sx
      if (endX - x <= EDGE && note.pitch !== null) {
        ed.selection = new Set([note])
        ed.begin()
        this.drag = { kind: 'length', note, from: note.step }
        return
      }
      ed.pick(note)
      return this.startMove([...ed.selection], hit.step, hit.pitch, note)
    }
    if (!e.shiftKey) ed.deselect()
    ed.begin()
    const placed = ed.place(hit.step, hit.pitch)
    if (!placed) return ed.end()
    this.hear(placed.pitch, placed.length)
    this.drag = { kind: 'length', note: placed, from: placed.step }
  }

  /** picked: the note clicked, which becomes the selection alone if the click does not drag. */
  private startMove(notes: Note[], step: number, pitch: number, picked: Note | null) {
    this.editor.begin()
    const from = new Map(notes.map((n) => [n, { step: n.step, pitch: n.pitch }]))
    this.drag = { kind: 'move', notes, from, step, pitch, heard: pitch, moved: false, picked }
  }

  /** Paints (or clears) the hits from the last step reached to this one: a fast drag skips none. */
  private paintHit(step: number) {
    const d = this.drag
    if (d?.kind !== 'hits') return
    const from = d.last ?? step
    d.last = step
    for (let s = Math.min(from, step); s <= Math.max(from, step); s++) {
      if (d.done.has(s) || s < 0) continue
      d.done.add(s)
      const there = this.editor.noteAt(s, null, d.part)
      if (d.add && !there) {
        this.editor.toggleHit(d.part, s)
        if (s === step) this.hear(null, 1, d.part)
      } else if (!d.add && there) this.editor.toggleHit(d.part, s)
    }
  }

  private moveDrag(x: number, y: number) {
    const d = this.drag!
    const ed = this.editor
    const hit = this.at(x, Math.max(RULER, Math.min(this.lanesTop - 1, y)))
    if (d.kind === 'start') return this.setStart(this.at(x, 0).step)
    if (d.kind === 'hits') {
      const lane = this.at(x, Math.max(this.lanesTop, y))
      return this.paintHit(lane.step)
    }
    if (d.kind === 'erase') {
      if (hit.area !== 'notes') return
      const note = ed.noteAt(hit.step, hit.pitch)
      if (note) ed.remove([note])
      return
    }
    if (d.kind === 'length') {
      const step = Math.floor((x - GUTTER + this.sx) / this.stepWidth)
      ed.resize(d.note, step - d.from + 1)
      return
    }
    if (d.kind === 'move') {
      if (hit.area !== 'notes' && hit.area !== 'keys') return
      const ds = hit.step - d.step
      const dp = hit.pitch - d.pitch
      if (!ds && !dp && !d.moved) return
      d.moved = true
      ed.move(d.notes, d.from, ds, dp)
      if (d.notes.length === 1 && d.notes[0].pitch !== d.heard) {
        d.heard = d.notes[0].pitch
        this.hear(d.heard, d.notes[0].length)
      }
      return
    }
    if (d.kind === 'box') {
      const to = d.lane ? this.at(x, this.lanesTop) : hit
      d.to = { step: to.step, pitch: d.lane || !('pitch' in to) ? null : (to.pitch ?? null) }
      this.draw()
    }
  }

  private endDrag() {
    const d = this.drag!
    this.drag = null
    const ed = this.editor
    if (d.kind === 'box') {
      ed.selectRange(d.step, d.to.step, d.pitch, d.to.pitch)
      return
    }
    if (d.kind === 'move' && !d.moved && d.picked) {
      // A click on a note, without dragging: it alone is selected, and played.
      if (ed.selection.size > 1) ed.selection = new Set([d.picked])
      if (ed.tool === 'pencil') this.hear(d.picked.pitch, d.picked.length)
    }
    if (d.kind !== 'start') ed.end()
  }

  private hoverAt(x: number, y: number) {
    const hit = this.at(x, y)
    const next = hit.area === 'notes' ? { step: hit.step, pitch: hit.pitch, lane: null } : hit.area === 'lane' && hit.lane !== undefined ? { step: hit.step, pitch: null, lane: hit.lane } : null
    const same = JSON.stringify(next) === JSON.stringify(this.hover)
    this.hover = next
    // The cursor: resizing at the end of a note, with the pencil.
    let cursor = ''
    if (hit.area === 'ruler') cursor = 'pointer'
    else if (hit.area === 'notes' && this.editor.tool === 'pencil' && !this.editor.drum) {
      const note = this.editor.noteAt(hit.step, hit.pitch)
      if (note && GUTTER + noteEnd(note) * this.stepWidth - this.sx - x <= EDGE) cursor = 'ew-resize'
      else if (note) cursor = 'grab'
    }
    this.canvas.style.cursor = cursor
    if (!same) this.draw()
  }

  private setStart(step: number) {
    const song = this.editor.song
    if (!song) return
    this.editor.start = Math.max(0, Math.min(songSteps(song) - 1, step))
    if (this.player.playing) this.player.play(song, this.lookup, this.editor.start)
    this.draw()
  }

  // --- Keys ---------------------------------------------------------------------

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement
      if (currentPage() !== 'music' || isPlaying() || target.closest('input, select, textarea, dialog')) return
      const ed = this.editor
      const k = e.key.toLowerCase()
      if (e.metaKey || e.ctrlKey) {
        if (k === 'z') e.shiftKey ? ed.redo() : ed.undo()
        else if (k === 'y') ed.redo()
        else if (k === 'c') ed.copy()
        else if (k === 'x') ed.cut()
        else if (k === 'v') ed.paste()
        else if (k === 'd') ed.duplicate()
        else if (k === 'a') {
          ed.setTool('select')
          ed.selectAll()
        } else if (k === 's') void this.flush()
        else return
      } else if (e.altKey) return
      else if (e.key === ' ' || e.key === 'Enter') this.togglePlay()
      else if (k === 'b') ed.setTool('pencil')
      else if (k === 'e') ed.setTool('eraser')
      else if (k === 'm') ed.setTool('select')
      else if (k === 'r' && !e.repeat) void this.sing()
      else if (e.key === 'Delete' || e.key === 'Backspace') ed.deleteSelection()
      else if (e.key.startsWith('Arrow') && ed.selection.size) this.nudge(e.key, e.shiftKey)
      else if (e.key === 'Escape') {
        if (ed.selection.size) ed.deselect()
        else if (this.player.playing) this.stop()
        else goTo('editor')
      } else return
      e.preventDefault()
    })
  }

  /** The arrows move the selection: a step (a bar with ⇧) in time, a semitone (an octave) in pitch. */
  private nudge(key: string, big: boolean) {
    const ed = this.editor
    const notes = [...ed.selection]
    const from = new Map(notes.map((n) => [n, { step: n.step, pitch: n.pitch }]))
    const n = big ? 1 : 0
    const [ds, dp] = { ArrowLeft: [-(n ? this.bar : 1), 0], ArrowRight: [n ? this.bar : 1, 0], ArrowUp: [0, n ? 12 : 1], ArrowDown: [0, n ? -12 : -1] }[key] ?? [0, 0]
    ed.move(notes, from, ds, dp)
    if (notes.length === 1 && dp) this.hear(notes[0].pitch, notes[0].length)
  }

  // --- Rendering ------------------------------------------------------------------

  private fit() {
    this.clampScroll()
    this.draw()
  }

  private render() {
    const ed = this.editor
    const hasSong = !!ed.song
    this.empty.hidden = this.songs.size > 0
    this.canvas.hidden = !hasSong
    this.instrumentsPanel.hidden = !hasSong
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-music-tool]')) el.classList.toggle('active', el.dataset.musicTool === ed.tool)
    this.renderLists()
    this.renderTransport()
    this.clampScroll()
    this.draw()
  }

  private renderTransport() {
    const song = this.editor.song
    if (document.activeElement !== this.tempo) this.tempo.value = song ? String(song.tempo) : ''
    this.tempo.disabled = !song
    this.time.value = song?.time ?? DEFAULT_TIME
    this.time.disabled = !song
    this.playButton.disabled = !song
    const state = this.player.playing ? 'stop' : 'play'
    if (this.playButton.dataset.state !== state) {
      this.playButton.dataset.state = state
      this.playButton.innerHTML = icon(state)
      this.playButton.setAttribute('aria-label', state === 'stop' ? 'Stop' : 'Play')
    }
    this.playButton.classList.toggle('active', this.player.playing)
    this.recordButton.disabled = !song || !this.editor.current
    const bars = song ? songSteps(song) / this.bar : 0
    const seconds = song ? songSteps(song) * stepSeconds(song.tempo) : 0
    this.length.textContent = song ? `${bars} bar${bars > 1 ? 's' : ''} · ${seconds.toFixed(1)} s` : ''
  }

  /** The instruments and the songs, built again only when they change. */
  private renderLists() {
    const ed = this.editor
    const song = ed.song
    const key = JSON.stringify([ed.name, ed.selected, song?.instruments.map((t) => t.instrument), [...ed.muted], [...this.songs.keys()], this.instruments.list().length])
    if (key === this.listKey) return
    this.listKey = key

    this.instrumentList.replaceChildren()
    if (song && !song.instruments.length) this.instrumentList.append(h('p', { className: 'muted' }, 'Add an instrument to play notes.'))
    song?.instruments.forEach((t, i) => {
      const missing = this.instruments.list().length > 0 && !this.instruments.has(t.instrument)
      const muted = ed.muted.has(t.instrument)
      const menu = createActionsMenu(`Options for the ${t.instrument}`, [
        ...(this.instruments.isDrum(t.instrument) ? [] : [{ label: 'Accompany', run: () => this.accompany(i) }]),
        { label: 'Replace…', run: () => void this.replaceInstrument(i) },
        { label: 'Remove', run: () => void this.removeInstrument(i), danger: true },
      ])
      this.instrumentList.append(
        h('div', { className: 'sprite-row' },
          h('button', {
            className: 'sprite-item' + (i === ed.selected ? ' active' : ''),
            title: missing ? `${t.instrument}: no such instrument, it is silent` : t.instrument,
            onclick: () => ed.select(i),
          },
          // Its color, a square to click to mute it (an outline: not heard). In the row's
          // button, so it stops there: muting does not select.
          h('span', {
            className: 'instrument-swatch' + (muted ? ' muted' : ''),
            style: `--c: ${instrumentColor(i)}`,
            role: 'switch',
            'aria-checked': String(!muted),
            'aria-label': `Hear the ${t.instrument}`,
            title: muted ? `Unmute the ${t.instrument}` : `Mute the ${t.instrument}`,
            onclick: (e: Event) => {
              e.stopPropagation()
              ed.toggleMute(t.instrument)
              this.refreshSound()
            },
          }),
          h('span', { className: 'sprite-label' + (missing ? ' missing' : '') }, t.instrument),
          this.instruments.isDrum(t.instrument) ? h('small', { className: 'instrument-kind' }, 'drum') : null),
          menu.el))
    })

    this.songList.replaceChildren()
    if (!this.songs.size) this.songList.append(h('p', { className: 'muted' }, 'A song is notes played by instruments, in a loop.'))
    for (const name of [...this.songs.keys()].sort()) {
      const menu = createActionsMenu(`Options for ${name}`, [
        { label: 'Rename', run: () => void this.renameSong(name) },
        { label: 'Duplicate', run: () => void this.duplicateSong(name) },
        { label: 'Delete', run: () => void this.deleteSong(name), danger: true },
      ])
      this.songList.append(
        h('div', { className: 'sprite-row' },
          h('button', { className: 'sprite-item' + (name === ed.name ? ' active' : ''), onclick: () => this.openSong(name) },
            h('span', { className: 'sprite-label' }, name)),
          menu.el))
    }
  }

  private colors() {
    const css = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    return { stage: v('--stage-bg', '#202028'), panel: v('--panel', '#1e1e26'), line: v('--line', '#33333f'), text: v('--text', '#e8e8ee'), muted: v('--muted', '#8a8a99'), accent: v('--accent', '#41a6f6'), bg: v('--bg', '#16161c') }
  }

  private draw() {
    const ctx = this.canvas.getContext('2d')
    const song = this.editor.song
    if (!ctx || !song) return
    const ed = this.editor
    const dpr = window.devicePixelRatio || 1
    const W = this.canvas.clientWidth
    const H = this.canvas.clientHeight
    if (!W || !H) return
    // Sized here: the canvas may just have shown (a first song), with no resize to tell.
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr)
      this.canvas.height = Math.round(H * dpr)
      this.clampScroll()
    }
    const C = this.colors()
    const SW = this.stepWidth
    const px = 1 / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = C.stage
    ctx.fillRect(0, 0, W, H)

    const steps = songSteps(song)
    const total = this.gridSteps
    const lanes = this.lanes()
    const lanesTop = this.lanesTop
    const X = (step: number) => GUTTER + step * SW - this.sx
    const Y = (pitch: number) => RULER + (HIGHEST - pitch) * ROW - this.sy
    const first = Math.max(0, Math.floor(this.sx / SW))
    const last = Math.min(total, Math.ceil((this.sx + W - GUTTER) / SW))

    // --- The notes' area.
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER, RULER, W - GUTTER, lanesTop - RULER)
    ctx.clip()
    // After the end of the song: darker, it does not play. Up to the right edge, wherever the
    // end is (scrolled past, it is left of the view: a width of W would stop short).
    const end = Math.max(GUTTER, X(steps))
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
    ctx.fillRect(end, RULER, W - end, lanesTop - RULER)
    // The cells, faint like the pixel grid; a little stronger at every beat (what tells 3/4
    // from 6/8), stronger again at every bar and under every C.
    const bar = this.bar
    const beat = this.beat
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
    for (let p = LOWEST; p <= HIGHEST; p++) ctx.fillRect(GUTTER, Math.round(Y(p) + ROW) - px, W, px)
    if (SW >= 8) for (let s = first; s <= last; s++) ctx.fillRect(Math.round(X(s)), RULER, px, lanesTop - RULER)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
    for (let s = Math.ceil(first / beat) * beat; s <= last; s += beat) if (s % bar) ctx.fillRect(Math.round(X(s)), RULER, px, lanesTop - RULER)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.11)'
    for (let p = LOWEST; p <= HIGHEST; p++) if (p % 12 === 0) ctx.fillRect(GUTTER, Math.round(Y(p) + ROW) - px, W, px)
    for (let s = Math.ceil(first / bar) * bar; s <= last; s += bar) ctx.fillRect(Math.round(X(s)), RULER, px, lanesTop - RULER)

    // The row and step under the pointer.
    if (this.hover && this.hover.pitch !== null && !ed.drum && !this.drag) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.fillRect(GUTTER, Y(this.hover.pitch), W, ROW)
      if (ed.tool === 'pencil' && !ed.noteAt(this.hover.step, this.hover.pitch)) {
        ctx.fillStyle = withAlpha(instrumentColor(ed.selected), 0.3)
        ctx.fillRect(X(this.hover.step) + 1, Y(this.hover.pitch) + 1, ed.length * SW - 2, ROW - 2)
      }
    }

    // The selected instrument, solid; then the others over it, as thin outlines of their color:
    // nothing hides anything, and the one edited stays the one filled.
    const pitched = (i: number) => !!song.instruments[i] && !this.instruments.isDrum(song.instruments[i].instrument)
    const visible = (n: Note) => n.pitch !== null && noteEnd(n) >= first && n.step <= last
    if (pitched(ed.selected)) {
      for (const n of song.instruments[ed.selected].notes) {
        if (!visible(n)) continue
        const x = X(n.step) + 1
        const y = Y(n.pitch!) + 1
        const w = Math.max(2, n.length * SW - 2)
        ctx.fillStyle = instrumentColor(ed.selected)
        ctx.fillRect(x, y, w, ROW - 2)
        if (ed.selection.has(n)) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2 * px
          ctx.strokeRect(x - px, y - px, w + 2 * px, ROW - 2 + 2 * px)
        }
      }
    }
    ctx.lineWidth = px
    song.instruments.forEach((t, i) => {
      if (i === ed.selected || !pitched(i)) return
      ctx.strokeStyle = instrumentColor(i)
      for (const n of t.notes) {
        if (!visible(n)) continue
        const w = Math.max(2, n.length * SW - 2)
        ctx.strokeRect(X(n.step) + 1 + px / 2, Y(n.pitch!) + 1 + px / 2, w - px, ROW - 2 - px)
      }
    })
    ctx.restore()

    // --- The drums' rows.
    if (lanes.length) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(GUTTER, lanesTop, W - GUTTER, H - lanesTop)
      ctx.clip()
      ctx.fillStyle = C.bg
      ctx.fillRect(GUTTER, lanesTop, W, H - lanesTop)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
      ctx.fillRect(end, lanesTop, W - end, H - lanesTop)
      lanes.forEach((part, k) => {
        const y = lanesTop + k * LANE
        if (part === ed.selected) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
          ctx.fillRect(GUTTER, y, W, LANE)
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
        if (SW >= 8) for (let s = first; s <= last; s++) ctx.fillRect(Math.round(X(s)), y, px, LANE)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.11)'
        for (let s = Math.ceil(first / bar) * bar; s <= last; s += bar) ctx.fillRect(Math.round(X(s)), y, px, LANE)
        // Beats, so the hits can be counted.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
        for (let s = Math.ceil(first / beat) * beat; s <= last; s += beat) ctx.fillRect(Math.round(X(s)), y + LANE - 4, px, 4)
        ctx.fillStyle = C.line
        ctx.fillRect(GUTTER, y, W, px)
        const front = part === ed.selected
        for (const n of song.instruments[part].notes) {
          if (n.step < first - 1 || n.step > last) continue
          const x = X(n.step) + 2
          ctx.fillStyle = front ? instrumentColor(part) : withAlpha(instrumentColor(part), 0.55)
          ctx.fillRect(x, y + 4, Math.max(2, SW - 4), LANE - 8)
          if (front && ed.selection.has(n)) {
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2 * px
            ctx.strokeRect(x - px, y + 4 - px, Math.max(2, SW - 4) + 2 * px, LANE - 8 + 2 * px)
          }
        }
        if (this.hover?.lane === k && !this.drag && ed.tool === 'pencil' && !ed.noteAt(this.hover.step, null, part)) {
          ctx.fillStyle = withAlpha(instrumentColor(part), 0.3)
          ctx.fillRect(X(this.hover.step) + 2, y + 4, Math.max(2, SW - 4), LANE - 8)
        }
      })
      ctx.restore()
    }

    // The selection box being drawn.
    const d = this.drag
    if (d?.kind === 'box') {
      const s0 = Math.min(d.step, d.to.step)
      const s1 = Math.max(d.step, d.to.step) + 1
      let y0 = lanesTop
      let y1 = H
      if (!d.lane && d.pitch !== null && d.to.pitch !== null) {
        y0 = Y(Math.max(d.pitch, d.to.pitch))
        y1 = Y(Math.min(d.pitch, d.to.pitch)) + ROW
      } else if (d.lane) {
        const k = lanes.indexOf(ed.selected)
        y0 = lanesTop + k * LANE
        y1 = y0 + LANE
      }
      ctx.fillStyle = withAlpha(C.accent, 0.12)
      ctx.fillRect(X(s0), y0, (s1 - s0) * SW, y1 - y0)
      ctx.strokeStyle = C.accent
      ctx.lineWidth = px
      ctx.strokeRect(X(s0) + px / 2, y0 + px / 2, (s1 - s0) * SW - px, y1 - y0 - px)
    }

    // --- The keys: the octaves, named at every C, and the row under the pointer.
    ctx.fillStyle = C.panel
    ctx.fillRect(0, RULER, GUTTER, H - RULER)
    ctx.fillStyle = C.line
    ctx.fillRect(GUTTER - px, RULER, px, H - RULER)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, RULER, GUTTER, lanesTop - RULER)
    ctx.clip()
    ctx.font = '11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (let p = LOWEST; p <= HIGHEST; p++) {
      const y = Y(p)
      if (y < RULER - ROW || y > lanesTop) continue
      const hovered = this.hover?.pitch === p && this.hover.lane === null
      if (p % 12 === 0 || hovered) {
        ctx.fillStyle = hovered ? C.text : C.muted
        ctx.fillText(noteName(p), GUTTER - 7, y + ROW / 2 + 0.5)
      }
      if (p % 12 === 0) {
        ctx.fillStyle = C.line
        ctx.fillRect(0, Math.round(y + ROW) - px, GUTTER, px)
      }
    }
    ctx.restore()
    // Each drum row's color, by its row.
    lanes.forEach((part, k) => {
      const y = lanesTop + k * LANE
      ctx.fillStyle = C.line
      ctx.fillRect(0, y, GUTTER, px)
      ctx.fillStyle = instrumentColor(part)
      ctx.globalAlpha = part === ed.selected ? 1 : 0.55
      ctx.fillRect(GUTTER - 18, y + LANE / 2 - 4, 8, 8)
      ctx.globalAlpha = 1
    })

    // --- The ruler: the bars, the end of the song, where playing starts.
    ctx.fillStyle = C.panel
    ctx.fillRect(0, 0, W, RULER)
    ctx.fillStyle = C.line
    ctx.fillRect(0, RULER - px, W, px)
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER, 0, W - GUTTER, RULER)
    ctx.clip()
    ctx.font = '11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (let s = Math.floor(first / bar) * bar; s <= last; s += bar) {
      ctx.fillStyle = s < steps ? C.muted : withAlpha(C.muted, 0.45)
      ctx.fillText(String(s / bar + 1), X(s) + (s === ed.start ? 11 : 5), RULER / 2)
      ctx.fillStyle = C.line
      ctx.fillRect(Math.round(X(s)), RULER - 7, px, 7)
    }
    // The end of the song: where it loops.
    ctx.fillStyle = C.muted
    ctx.fillRect(Math.round(X(steps)) - px, 4, 2 * px, RULER - 4)
    // Where playing starts: a small flag.
    const sx = Math.round(X(ed.start))
    ctx.fillStyle = C.accent
    ctx.beginPath()
    ctx.moveTo(sx, RULER - 1)
    ctx.lineTo(sx, 6)
    ctx.lineTo(sx + 7, 9.5)
    ctx.lineTo(sx, 13)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(sx, 6, 1.5, RULER - 7)
    ctx.restore()

    // --- The playhead.
    const at = this.player.position()
    if (at !== null) {
      const x = X(at)
      if (x >= GUTTER) {
        ctx.fillStyle = C.text
        ctx.fillRect(Math.round(x), 0, 1.5, H)
      }
    }
  }
}

/** A #rrggbb color with an alpha. */
function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

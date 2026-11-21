// The instruments a song can use: the engine's (runtime/instruments/, available in every
// game by name) and the game's own (instruments/), a game's one replacing the engine's of the
// same name. And the import of a recording as an instrument of the game.

import { h, openDialog, toast } from './dialog'
import type { Project } from './project'
import { NAME_RE } from './sprite'
import { HIGHEST, LOWEST, RATE, decodeWav, instrument, noteName, noteNumber, prepareRecording, tuneRecording, type Instrument } from '../../runtime/sound'

const BUILT_IN_WAVS = import.meta.glob('../../runtime/instruments/*.wav', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const BUILT_IN_NOTES = import.meta.glob('../../runtime/instruments/*.json', { import: 'default', eager: true }) as Record<string, { note?: string }>

const baseName = (path: string) => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')

/** The engine's instruments, by name: where their recording is, and their note. */
const BUILT_IN = new Map(
  Object.entries(BUILT_IN_WAVS).map(([path, url]) => {
    const note = BUILT_IN_NOTES[path.replace(/\.wav$/, '.json')]?.note
    return [baseName(path), { url, note: note ? noteNumber(note) : null }] as const
  }),
)

export interface InstrumentEntry {
  name: string
  drum: boolean
  /** The game's own (instruments/), rather than the engine's. */
  own: boolean
}

export class Instruments {
  private readonly loaded = new Map<string, Instrument>()
  private own = new Set<string>()
  /** Something was loaded or imported: the page draws again. */
  onChange: () => void = () => {}

  constructor(private readonly project: Project) {}

  /** Loads every instrument: the engine's, then the game's over them. */
  async load() {
    await Promise.all(
      [...BUILT_IN].map(async ([name, b]) => {
        try {
          const res = await fetch(b.url)
          const wav = decodeWav(new Uint8Array(await res.arrayBuffer()))
          if (!this.own.has(name)) this.loaded.set(name, instrument(wav.data, b.note))
        } catch {
          // A missing built-in: the tracks using it are silent.
        }
      }),
    )
    await this.loadOwn()
  }

  /** Reads the game's instruments again (imported, synced). */
  async loadOwn() {
    const names = await this.project.listInstruments().catch(() => [])
    this.own = new Set(names)
    for (const name of names) {
      try {
        const { data, note } = await this.project.loadInstrument(name)
        this.loaded.set(name, instrument(data, note))
      } catch (err) {
        toast((err as Error).message)
      }
    }
    this.onChange()
  }

  get(name: string): Instrument | undefined {
    return this.loaded.get(name)
  }

  /** Whether it is a drum: it has no note. An unknown one is not. */
  isDrum(name: string) {
    return this.loaded.get(name)?.note === null
  }

  has(name: string) {
    return this.loaded.has(name)
  }

  isBuiltIn(name: string) {
    return BUILT_IN.has(name)
  }

  isOwn(name: string) {
    return this.own.has(name)
  }

  /** Every instrument, the game's first, then by name. */
  list(): InstrumentEntry[] {
    return [...this.loaded.keys()]
      .map((name) => ({ name, drum: this.isDrum(name), own: this.own.has(name) }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
  }

  /** Asks for a recording, prepares it, and saves it as an instrument of the game. Returns its name. */
  async import(audio: () => AudioContext, preview: (inst: Instrument) => void): Promise<string | null> {
    const file = await pickFile('audio/*,.wav,.aif,.aiff,.mp3,.m4a,.ogg,.flac')
    if (!file) return null
    let data: Float32Array
    let note: number | null
    try {
      const decoded = await audio().decodeAudioData(await file.arrayBuffer())
      const mono = new Float32Array(decoded.length)
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const ch = decoded.getChannelData(c)
        for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / decoded.numberOfChannels
      }
      const prepared = prepareRecording(mono, decoded.sampleRate)
      if (prepared.length < RATE / 50) throw new Error('it is silent')
      ;({ data, note } = tuneRecording(prepared))
    } catch (err) {
      toast(`Could not read ${file.name}: ${(err as Error).message}`)
      return null
    }

    const nameInput = h('input', { type: 'text', value: slug(file.name), autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
    const noteSelect = h('select', {}, h('option', { value: '' }, 'None: a drum, it plays as recorded'))
    for (let n = HIGHEST; n >= LOWEST; n--) noteSelect.append(h('option', { value: String(n), selected: n === note }, noteName(n)))
    if (note === null) noteSelect.value = ''
    const chosen = () => (noteSelect.value === '' ? null : Number(noteSelect.value))
    const replaces = h('p', { className: 'muted' })
    const check = () => {
      const name = nameInput.value.trim()
      replaces.textContent = this.own.has(name)
        ? `Replaces this game’s “${name}”.`
        : BUILT_IN.has(name)
          ? `Replaces the engine’s “${name}” in this game.`
          : ''
    }
    nameInput.addEventListener('input', check)
    check()
    const listen = h('button', {
      type: 'button',
      onclick: () => preview(instrument(data, chosen())),
    }, 'Listen')
    const seconds = (data.length / RATE).toFixed(1)
    const body = h('div', { className: 'fields' },
      h('p', { className: 'muted' }, `${file.name}: ${seconds} s kept, from the start of the note${note === null ? '' : `, tuned to ${noteName(note)}`}. It plays at 16 kHz, 8-bit.`),
      h('label', {}, 'Name', nameInput),
      h('label', {}, 'Note it was recorded at', noteSelect),
      h('div', { className: 'row' }, listen),
      replaces,
    )
    const res = await openDialog('Import an instrument', body, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Import', value: 'ok', kind: 'primary' },
    ], () => (NAME_RE.test(nameInput.value.trim()) ? null : 'Name: lowercase letters, digits, “-” and “_” (e.g. lute).'))
    if (res !== 'ok') return null
    const name = nameInput.value.trim()
    try {
      await this.project.saveInstrument(name, data, chosen())
    } catch (err) {
      toast(`Could not save: ${(err as Error).message}`)
      return null
    }
    this.own.add(name)
    this.loaded.set(name, instrument(data, chosen()))
    this.onChange()
    toast(`Instrument “${name}” imported`)
    return name
  }
}

/** A name for an instrument from a file name: "Flute C5.wav" → "flute-c5". */
function slug(file: string) {
  const s = baseName(file).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return NAME_RE.test(s) ? s : 'instrument'
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept })
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

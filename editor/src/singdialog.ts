// The popup a melody is sung in, to write it without placing each note by hand. Nothing of
// the song plays: a click counts in, then keeps the beat while the voice is recorded. Done,
// the whole take is analysed at once (sing.ts) and becomes notes, the take's first beat on
// the song's start marker (the music page places them).

import { h } from './dialog'
import { Microphone } from './microphone'
import type { MusicPlayer } from './musicplayer'
import { HOP, listen, transcribe } from './sing'
import { addNote, stepSeconds, TIMES, type Instrument, type Note, type Song } from '../../runtime/sound'

/**
 * Seconds of count-in, at least (in whole bars). Besides telling when to start, it lets the
 * microphone wake up: Safari's fades in over about 3.5 s once open (measured: the voice
 * 20 dB down at first, too quiet to be heard as a voice), so nothing sung is lost to it.
 */
const WARM_UP = 4
/** How loud the click is on the first beat of a bar, and on the others. */
const ACCENT = 0.5
const BEAT = 0.2
/** Seconds between opening the microphone and the first click: time to schedule it. */
const LEAD = 0.15

/** A take sung: its notes, step 0 being where it started. Null when nothing was sung. */
export async function singTake(player: MusicPlayer, song: Song, drum: boolean, click: Instrument | undefined): Promise<Note[] | null> {
  const ctx = player.audio()
  const { bar, beat } = TIMES[song.time]
  const step = stepSeconds(song.tempo)
  const beats = bar / beat

  const dots = Array.from({ length: beats }, () => h('span', { className: 'sing-beat' }))
  const label = h('p', { className: 'sing-label' }, 'Opening the microphone…')
  const meter = h('span')
  const done = h('button', { type: 'button', className: 'primary', disabled: true }, 'Done')
  const cancel = h('button', { type: 'button' }, 'Cancel')
  const dialog = h('dialog', { className: 'sing-dialog' },
    h('h2', {}, 'Sing'),
    h('div', { className: 'sing-beats' }, ...dots),
    label,
    h('div', { className: 'sing-level' }, meter),
    h('div', { className: 'dialog-actions' }, done, cancel))
  document.body.append(dialog)
  dialog.showModal()
  done.focus()

  const chunks: { data: Float32Array; time: number }[] = []
  let mic: Microphone | null = null
  let stopClick = () => {}
  let frame = 0
  let finish: (sung: boolean) => void = () => {}
  const finished = new Promise<boolean>((resolve) => (finish = resolve))
  cancel.onclick = () => finish(false)
  done.onclick = () => finish(true)
  dialog.addEventListener('cancel', (e) => (e.preventDefault(), finish(false)))
  dialog.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if (k === 'enter' || k === ' ' || k === 'r') {
      e.preventDefault()
      if (!done.disabled) finish(true)
    }
  })

  try {
    const opening = Microphone.open(ctx, (data, time) => chunks.push({ data, time }))
    const first = await Promise.race([opening, finished])
    if (typeof first === 'boolean') {
      // Cancelled while the browser asked: the microphone, if it comes, is closed at once.
      opening.then((m) => m.close(), () => {})
      return null
    }
    mic = first
    // The voice comes in late by the microphone's delay, and follows a click heard late by
    // the speakers' (both as the browser tells them).
    const delay = mic.latency + (ctx.outputLatency || 0) + (ctx.baseLatency || 0)
    const barSeconds = bar * step
    const counted = Math.max(1, Math.ceil(WARM_UP / barSeconds))
    const t0 = ctx.currentTime + LEAD
    const start = t0 + counted * barSeconds
    if (click) {
      const one = new Float32Array(Math.round(barSeconds * ctx.sampleRate))
      for (let i = 0; i < beats; i++) addNote(one, Math.round(i * beat * step * ctx.sampleRate), ctx.sampleRate, click, null, 0, i ? BEAT : ACCENT)
      stopClick = player.click(one, t0)
    }

    // What the popup shows, with the click as heard: the beat, the count, the bar sung.
    const show = () => {
      const heard = ctx.currentTime - (ctx.outputLatency || 0) - t0
      if (heard >= 0) {
        const b = Math.floor(heard / (beat * step))
        const n = Math.floor(b / beats) - counted
        dots.forEach((d, i) => d.classList.toggle('on', i === b % beats))
        label.textContent = n < -1 ? 'Get ready' : n === -1 ? String((b % beats) + 1) : n === 0 ? 'Sing' : `Bar ${n + 1}`
        done.disabled = n < 0
      }
      const last = chunks[chunks.length - 1]?.data
      let rms = 0
      if (last) rms = Math.sqrt(last.reduce((s, v) => s + v * v, 0) / last.length)
      meter.style.width = `${Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 60) / 50)) * 100}%`
      frame = requestAnimationFrame(show)
    }
    show()
    if (!(await finished) || !chunks.length) return null

    // The sound from the take's start (a step early: a note sung a little ahead is still in it).
    const rate = ctx.sampleRate
    const base = chunks[0].time
    const total = chunks.reduce((s, c) => s + c.data.length, 0)
    const all = new Float32Array(total)
    let at = 0
    for (const c of chunks) {
      all.set(c.data, at)
      at += c.data.length
    }
    const from = Math.max(0, Math.round((start + delay - step - base) * rate))
    const begins = base + from / rate
    const frames = listen(all.subarray(from), rate).map((f) => ({ step: (begins + f.time - delay - start) / step, pitch: f.pitch, level: f.level }))
    const notes: Note[] = []
    for (const n of transcribe(frames, drum, HOP / step)) {
      if (n.step >= 0) notes.push(n)
      else if (n.pitch !== null && n.step + n.length > 0) notes.push({ ...n, length: n.step + n.length, step: 0 })
    }
    return notes
  } finally {
    cancelAnimationFrame(frame)
    stopClick()
    mic?.close()
    dialog.close()
    dialog.remove()
  }
}

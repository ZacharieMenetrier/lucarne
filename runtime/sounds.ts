// The game's sound effects (sounds/<name>.json, drawn on the Sounds page), by name.
//
//   const jump = sound('jump')
//   jump.play()
//
// The editor loads every sound before the game's code runs, so `sound()` works anywhere,
// even at the top of a file. A sound has no settings when it plays: how loud it is and how it
// sounds are in its file.
//
// - A sound played again while it still rings starts over: the earlier one stops (a short
//   fade, not a click), as a string struck again does in the music. Repeats never pile up into
//   something louder or muddier. Different sounds play together.
// - Repeats are not identical: a sound is made a few times (TAKES), and each play picks one
//   that was not the last. The first take is made when the game loads, the others right after,
//   off the game's thread (soundworker.ts).
// - Sounds stop when the game is paused or stopped, and are silent while a script drives the
//   game (`lucarne.step` runs many updates at once: they would all sound together). Those are
//   listed instead (`heardSounds`), so a script still knows what was played.

import { audioContext } from './audio'
import { RATE } from './sound'
import { renderSound, type Sound as Drawing } from './sfx'

/** Takes of each sound: enough that a repeat is rarely heard twice in a row the same. */
const TAKES = 4
/** Seconds over which a sound fades out when it starts over or is stopped. */
const FADE = 0.005

interface Playing {
  source: AudioBufferSourceNode
  gain: GainNode
}

export class Sound {
  readonly name: string
  /** @internal The sound as it plays (mono, at RATE), one per take; empty when nothing is drawn. */
  readonly takes: Float32Array[] = []
  private buffers: AudioBuffer[] = []
  private last = -1
  private playing: Playing | null = null

  /** @internal */
  constructor(name: string, first: Float32Array | null) {
    this.name = name
    if (first) this.takes.push(first)
  }

  /** Plays the sound from its start (if it was still ringing, it starts over). */
  play() {
    if (quiet) {
      heard.push(this.name)
      return
    }
    if (!this.takes.length) return
    const ctx = audioContext()
    this.stop()
    const i = this.pick()
    const buffer = (this.buffers[i] ??= toBuffer(ctx, this.takes[i]))
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    source.connect(gain).connect(ctx.destination)
    source.start()
    const p: Playing = { source, gain }
    source.onended = () => {
      if (this.playing === p) this.playing = null
      sounding.delete(this)
    }
    this.playing = p
    sounding.add(this)
  }

  /** @internal Stops it if it is playing. */
  stop() {
    const p = this.playing
    if (!p) return
    this.playing = null
    sounding.delete(this)
    const t = p.gain.context.currentTime
    p.gain.gain.setValueAtTime(1, t)
    p.gain.gain.linearRampToValueAtTime(0, t + FADE)
    try {
      p.source.stop(t + FADE)
    } catch {}
  }

  /** Any take but the last one played. */
  private pick() {
    const n = this.takes.length
    let i = Math.floor(Math.random() * (n > 1 ? n - 1 : n))
    if (n > 1 && i >= this.last) i++
    return (this.last = i)
  }
}

function toBuffer(ctx: AudioContext, data: Float32Array) {
  const buffer = ctx.createBuffer(1, data.length, RATE)
  buffer.getChannelData(0).set(data)
  return buffer
}

let loaded = new Map<string, Sound>()
const sounding = new Set<Sound>()
let quiet = false
let heard: string[] = []
let worker: Worker | null = null

/** The sound named `name` (sounds/<name>.json). */
export function sound(name: string): Sound {
  const s = loaded.get(name)
  if (!s) {
    const names = [...loaded.keys()].join(', ') || 'none'
    throw new Error(`No sound named "${name}" in sounds/ (there are: ${names}).`)
  }
  return s
}

/** Called by the editor before the game's code runs: makes each sound's first take, and the
 *  others in the background. */
export function setSounds(list: { name: string; sound: Drawing }[]) {
  stopSounds()
  worker?.terminate()
  worker = null
  loaded = new Map(list.map(({ name, sound }) => [name, new Sound(name, renderSound(sound))]))
  const more = list.filter(({ name }) => loaded.get(name)!.takes.length)
  if (!more.length || typeof Worker === 'undefined') return
  const w = (worker = new Worker(new URL('./soundworker.ts', import.meta.url), { type: 'module' }))
  w.onmessage = (e: MessageEvent<{ name: string; data: Float32Array }>) => {
    if (worker === w) loaded.get(e.data.name)?.takes.push(e.data.data)
  }
  for (const { name, sound } of more) w.postMessage({ name, sound, count: TAKES - 1 })
}

/** Stops every sound playing (the game paused or stopped). */
export function stopSounds() {
  for (const s of [...sounding]) s.stop()
}

/** While on, sounds are listed rather than heard (a script running updates at once). */
export function quietSounds(on: boolean) {
  quiet = on
}

/** The names of the sounds played while quiet since the last call, in order. */
export function heardSounds(): string[] {
  const out = heard
  heard = []
  return out
}

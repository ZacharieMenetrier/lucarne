// Plays the song open on the Music page, in a loop, and the notes heard as they are placed.
//
// The whole song is rendered at once (runtime/sound.ts) and played as one looping sound:
// every edit renders it again, and the new sound takes over where the old one was, with a
// short crossfade so the change is not heard as a click.

import { renderNote, renderSong, songSteps, stepSeconds, type Instrument, type Song } from '../../runtime/sound'

/** Seconds of crossfade when the song changes while it plays. */
const SWAP = 0.02

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
}

export class MusicPlayer {
  private ctx: AudioContext | null = null
  private voice: Voice | null = null
  private preview: Voice | null = null
  /** When the song's step 0 played, last time round (context time), and its length then. */
  private t0 = 0
  private duration = 0
  private step = 0
  get playing() {
    return this.voice !== null
  }

  /** The audio context, made on the first sound (a browser only starts one after a click or a key). */
  audio(): AudioContext {
    if (!this.ctx) {
      try {
        // Plays even with an iPhone's or iPad's silent switch on (set once: singing switches
        // it to play-and-record for a while, microphone.ts).
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
        if (session) session.type = 'playback'
      } catch {}
      this.ctx = new AudioContext()
    }
    // Not only "suspended": Safari also has "interrupted", which is where a change of audio
    // session (singing, microphone.ts) or another app taking the sound leaves it, and it
    // stays silent until resumed.
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume()
    return this.ctx
  }

  /** Plays the song from a step, in a loop. */
  play(song: Song, instruments: (name: string) => Instrument | undefined, from: number) {
    this.stop()
    this.start(song, instruments, from)
  }

  /** The song changed while playing: goes on with the new one, from where it is. */
  update(song: Song, instruments: (name: string) => Instrument | undefined) {
    if (!this.voice) return
    const at = this.position() ?? 0
    this.start(song, instruments, at)
  }

  stop() {
    if (!this.voice) return
    const old = this.voice
    this.voice = null
    this.fadeOut(old)
  }

  /** Where the song is, in steps (with a fraction), or null when it is not playing. */
  position(): number | null {
    if (!this.voice || !this.ctx || !this.duration) return null
    const t = (((this.ctx.currentTime - this.t0) % this.duration) + this.duration) % this.duration
    return t / this.step
  }

  /**
   * A click on every beat from `at` (audio clock) on, the first of each bar louder, until
   * stopped: what singing follows. `bar` is one bar of the click, already rendered.
   */
  click(bar: Float32Array, at: number): () => void {
    const ctx = this.audio()
    const buffer = ctx.createBuffer(1, Math.max(1, bar.length), ctx.sampleRate)
    buffer.getChannelData(0).set(bar)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(ctx.destination)
    source.start(at)
    return () => {
      try {
        source.stop()
      } catch {}
      source.disconnect()
    }
  }

  /** One note alone, as it is placed. */
  note(inst: Instrument, pitch: number | null, seconds: number) {
    const ctx = this.audio()
    if (this.preview) this.fadeOut(this.preview)
    const data = renderNote(inst, pitch, seconds, ctx.sampleRate)
    this.preview = this.voiceOf(data, false, 0)
  }

  private start(song: Song, instruments: (name: string) => Instrument | undefined, from: number) {
    const ctx = this.audio()
    const data = renderSong(song, instruments, ctx.sampleRate)
    this.step = stepSeconds(song.tempo)
    this.duration = data.length / ctx.sampleRate
    const steps = songSteps(song)
    const offset = (((from % steps) + steps) % steps) * this.step
    const old = this.voice
    this.voice = this.voiceOf(data, true, offset, old ? SWAP : 0)
    this.t0 = ctx.currentTime - offset
    if (old) this.fadeOut(old)
  }

  private voiceOf(data: Float32Array, loop: boolean, offset: number, fadeIn = 0): Voice {
    const ctx = this.audio()
    const buffer = ctx.createBuffer(1, Math.max(1, data.length), ctx.sampleRate)
    buffer.getChannelData(0).set(data)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = loop
    const gain = ctx.createGain()
    if (fadeIn) {
      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn)
    }
    source.connect(gain).connect(ctx.destination)
    source.start(ctx.currentTime, Math.min(offset, buffer.duration))
    return { source, gain }
  }

  private fadeOut(v: Voice) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + SWAP)
    try {
      v.source.stop(t + SWAP + 0.01)
    } catch {}
  }
}

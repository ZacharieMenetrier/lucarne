// The microphone, heard in chunks of raw sound with the time each one starts on the audio
// clock: what singing a melody into a track listens to (sing.ts makes it notes).

/** Copies the microphone's sound out of the audio thread, about 1024 samples at a time. */
const WORKLET = `
class LucarneMicrophone extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(2048)
    this.n = 0
    this.t = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    if (this.n === 0) this.t = currentTime
    this.buf.set(ch, this.n)
    this.n += ch.length
    if (this.n >= 1024) {
      this.port.postMessage({ data: this.buf.slice(0, this.n), time: this.t })
      this.n = 0
    }
    return true
  }
}
registerProcessor('lucarne-microphone', LucarneMicrophone)
`

const ready = new WeakMap<AudioContext, Promise<void>>()

/** Seconds to wait for the user to answer the browser's question, and for the worklet to load. */
const ASKING = 30
const LOADING = 3
/** Seconds to wait for the microphone to send sound once it is open. */
const WAKING = 5

/** Rejects if `p` takes longer than `seconds`. */
function within<T>(p: Promise<T>, seconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), seconds * 1000)
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    )
  })
}

/**
 * Safari's audio session: "playback" (set to play with the silent switch on) gives no
 * microphone; "play-and-record" both plays and hears, while singing.
 */
function session(type: 'playback' | 'play-and-record') {
  try {
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (s) s.type = type
  } catch {}
}

export class Microphone {
  private constructor(
    private readonly stream: MediaStream,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode | ScriptProcessorNode,
    /** Seconds the sound takes to come in, as far as the browser says. */
    readonly latency: number,
  ) {}

  /** Asks for the microphone (the browser asks the user the first time) and starts hearing it. */
  static async open(ctx: AudioContext, heard: (data: Float32Array, time: number) => void): Promise<Microphone> {
    // Browsers only give the microphone to a secure page: localhost or https.
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('the microphone needs the editor on localhost or https')
    session('play-and-record')
    // Safari's microphone sends silence (exact zeros) for a moment once it is open, while
    // the audio switches to play-and-record: what is sung then is lost. It is open only once
    // it sends sound, so that singing starts with it.
    let awake = false
    let woke = () => {}
    const waking = new Promise<void>((resolve) => (woke = resolve))
    const hear = (data: Float32Array, time: number) => {
      if (!awake) {
        if (!data.some((v) => v !== 0)) return
        awake = true
        woke()
      }
      heard(data, time)
    }
    const asked = navigator.mediaDevices.getUserMedia({
      audio: {
        // The voice exactly as sung: its level and timbre make the notes. No echo cancelling
        // either: singing is done with headphones on, and on a Mac it opens a voice
        // processing unit that left the web app silent until it was quit.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    let stream: MediaStream
    try {
      stream = await within(asked, ASKING, 'the browser did not answer (is its question about the microphone hidden?)')
    } catch (err) {
      // Answered after giving up waiting: that microphone is not used, it must not stay on.
      asked.then((s) => s.getTracks().forEach((t) => t.stop()), () => {})
      session('playback')
      throw err
    }
    try {
      if (ctx.state !== 'running') await within(ctx.resume(), LOADING, 'the sound did not start')
      const source = ctx.createMediaStreamSource(stream)
      let node: AudioWorkletNode | ScriptProcessorNode
      try {
        if (!ready.has(ctx)) {
          const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
          ready.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)))
        }
        await within(ready.get(ctx)!, LOADING, 'the audio worklet did not load')
        // No output: it only listens (a node without outputs is still run by the audio thread).
        const worklet = new AudioWorkletNode(ctx, 'lucarne-microphone', { numberOfInputs: 1, numberOfOutputs: 0 })
        worklet.port.onmessage = (e: MessageEvent<{ data: Float32Array; time: number }>) => hear(e.data.data, e.data.time)
        source.connect(worklet)
        node = worklet
      } catch (err) {
        // Where the worklet will not load, the older way: the sound comes to the page itself.
        console.warn('Microphone: no audio worklet, using a script processor.', err)
        ready.delete(ctx)
        const processor = ctx.createScriptProcessor(1024, 1, 1)
        const mute = ctx.createGain()
        mute.gain.value = 0
        processor.onaudioprocess = (e) => hear(e.inputBuffer.getChannelData(0).slice(), e.playbackTime - e.inputBuffer.duration)
        source.connect(processor)
        // A script processor only runs when its output goes somewhere: to silence.
        processor.connect(mute).connect(ctx.destination)
        node = processor
      }
      const settings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }
      const mic = new Microphone(stream, source, node, settings?.latency ?? 0.01)
      try {
        await within(waking, WAKING, 'the microphone sends no sound')
      } catch (err) {
        mic.close()
        throw err
      }
      return mic
    } catch (err) {
      for (const t of stream.getTracks()) t.stop()
      session('playback')
      throw err
    }
  }

  close() {
    if (this.node instanceof AudioWorkletNode) this.node.port.onmessage = null
    else this.node.onaudioprocess = null
    this.source.disconnect()
    this.node.disconnect()
    // The browser's "microphone in use" mark goes away.
    for (const t of this.stream.getTracks()) t.stop()
    session('playback')
  }
}

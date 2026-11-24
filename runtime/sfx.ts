// Sound effects: a sound drawn on a grid of 24 columns (time) by 24 rows (pitch), at most one
// pixel per column, with a volume per column, and a few settings for the whole sound. The
// engine makes the sound from that drawing: sounds/<name>.json is the drawing, never a
// recording, so it stays editable.
//
// Unlike instruments (sound.ts), effects are synthesized: a jump, a coin or an explosion is a
// shape drawn in time, not a note played. What comes out is the same as the music's, though:
// mono, 16 kHz, 8-bit. It is made at 44.1 kHz (the textures' partials and filters were tuned
// there), then brought down.
//
// A render varies slightly every time (a struck texture's pitch, noise, crackles), on purpose:
// repeats of a sound are not identical.

import { RATE, resample } from './sound'

export const COLUMNS = 24
export const ROWS = 24
/** The loudest a column can be; 0 is 40 dB under it. */
export const LOUDEST = 23

/** The sound source of the whole sound, one per sound. Held ones join neighbouring pixels into
 *  one line; struck ones make each pixel a hit. The order is the sound code's (editor). */
export const TEXTURES = ['soft', 'pluck', 'glass', 'retro', 'noise', 'wood', 'water', 'metal', 'click'] as const
/** How long a column lasts. */
export const SPEEDS = ['blink', 'fast', 'mid', 'slow'] as const
export const GRITS = ['clean', 'warm', 'crunchy'] as const
export const ECHOES = ['off', 'a-little', 'some', 'lots', 'huge'] as const
/** Struck textures ring shorter or longer; held ones are cut shorter (dry) or get a tail. */
export const RINGS = ['very-dry', 'dry', 'normal', 'ringing', 'very-ringing'] as const

export type Texture = (typeof TEXTURES)[number]
export type Speed = (typeof SPEEDS)[number]
export type Grit = (typeof GRITS)[number]
export type Echo = (typeof ECHOES)[number]
export type Ring = (typeof RINGS)[number]

export interface Sound {
  texture: Texture
  speed: Speed
  grit: Grit
  /** Pitch slides between neighbouring pixels. */
  glide: boolean
  echo: Echo
  ring: Ring
  /** Each column's row (0: the lowest), null where it is empty: COLUMNS of them. */
  pitch: (number | null)[]
  /** Each column's volume, 0 to LOUDEST: COLUMNS of them, kept for empty columns too. */
  volume: number[]
}

/** Seconds per column. */
export const SPEED_SECONDS: Record<Speed, number> = { blink: 1 / 60, fast: 1 / 30, mid: 1 / 20, slow: 1 / 12 }

/** A held texture joins neighbouring pixels into one line. */
export const isHeld = (t: Texture) => t === 'soft' || t === 'retro' || t === 'noise'

export function emptySound(): Sound {
  return {
    texture: 'soft',
    speed: 'fast',
    grit: 'clean',
    glide: false,
    echo: 'off',
    ring: 'normal',
    pitch: Array(COLUMNS).fill(null),
    volume: Array(COLUMNS).fill(LOUDEST),
  }
}

/** A row's frequency: C-major pentatonic, 5 rows an octave, row 0 = C2 (65 Hz) up to G6. */
export const rowFrequency = (r: number) => 440 * 2 ** ((36 + 12 * Math.floor(r / 5) + [0, 2, 4, 7, 9][r % 5] - 69) / 12)

/** A volume's gain: linear in dB, from 0 dB down to −40 dB. */
export const volumeGain = (v: number) => 10 ** ((-40 * (LOUDEST - v)) / LOUDEST / 20)

/** The last column with a pixel, or -1. */
export function lastColumn(s: Sound): number {
  for (let i = COLUMNS - 1; i >= 0; i--) if (s.pitch[i] !== null) return i
  return -1
}

/** How long the drawing lasts, in seconds (the ring and echo after it not counted). */
export const drawnSeconds = (s: Sound) => (lastColumn(s) + 1) * SPEED_SECONDS[s.speed]

// ---------------------------------------------------------------------------
// The file: sounds/<name>.json

const clampInt = (x: unknown, lo: number, hi: number, fallback: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : fallback

function oneOf<T extends string>(list: readonly T[], x: unknown, fallback: T): T {
  return list.includes(x as T) ? (x as T) : fallback
}

export function parseSound(text: string): Sound {
  const j = JSON.parse(text) as Record<string, unknown>
  if (!j || typeof j !== 'object') throw new Error('not a sound')
  const s = emptySound()
  s.texture = oneOf(TEXTURES, j.texture, s.texture)
  s.speed = oneOf(SPEEDS, j.speed, s.speed)
  s.grit = oneOf(GRITS, j.grit, s.grit)
  s.glide = j.glide === true
  s.echo = oneOf(ECHOES, j.echo, s.echo)
  s.ring = oneOf(RINGS, j.ring, s.ring)
  const pitch = Array.isArray(j.pitch) ? j.pitch : []
  const volume = Array.isArray(j.volume) ? j.volume : []
  for (let i = 0; i < COLUMNS; i++) {
    s.pitch[i] = pitch[i] === null || pitch[i] === undefined ? null : clampInt(pitch[i], 0, ROWS - 1, 0)
    s.volume[i] = clampInt(volume[i], 0, LOUDEST, LOUDEST)
  }
  return s
}

/**
 * The file: the texture, then each setting only when it is not the default, the pitch of each
 * column up to the last pixel, and the volumes only when one is not the loudest (up to the last
 * that is not). Columns after those are empty and loudest.
 */
export function serializeSound(s: Sound): string {
  const d = emptySound()
  const pitch = s.pitch.slice(0, lastColumn(s) + 1)
  let lastQuiet = -1
  s.volume.forEach((v, i) => {
    if (v !== LOUDEST) lastQuiet = i
  })
  const out: Record<string, unknown> = { texture: s.texture }
  if (s.speed !== d.speed) out.speed = s.speed
  if (s.grit !== d.grit) out.grit = s.grit
  if (s.glide) out.glide = true
  if (s.echo !== d.echo) out.echo = s.echo
  if (s.ring !== d.ring) out.ring = s.ring
  out.pitch = pitch
  if (lastQuiet >= 0) out.volume = s.volume.slice(0, lastQuiet + 1)
  // One line each for the arrays: they read as the drawing does, left to right.
  return JSON.stringify(out, null, 2).replace(/\[\s+([^\]]*?)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s+/).join(', ')}]`) + '\n'
}

// ---------------------------------------------------------------------------
// Making the sound

/** Rate the sound is made at, before it is brought down to RATE. */
const SR = 44100

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

const GRIT = [{}, { drive: 1.6, lp: 12000 }, { drive: 2, hold: 4, bits: 7 }] as { drive?: number; lp?: number; hold?: number; bits?: number }[]

interface TextureDef {
  /** Partials: [ratio, amplitude, decay in seconds around 330 Hz]. */
  parts?: [number, number, number][]
  /** A click of noise at the attack. */
  click?: number
  /** A filtered noise "knock" at the attack, tuned to the pitch (cutoff × pitch, q, length in s, amount). */
  tr?: { fc: number; q: number; len: number; a: number }
  /** A bubble's pitch rising after the strike, and how fast. */
  chirp?: number
  chirpT?: number
  /** A small random pitch change per hit, so repeats differ. */
  jit?: number
}

const TEX: Record<Texture, TextureDef> = {
  soft: {},
  pluck: { parts: [[1, 1, 0.45], [3.93, 0.28, 0.08], [9.2, 0.08, 0.03]], click: 0.35 },
  glass: { parts: [[1, 1, 1.3], [1.003, 0.6, 1.3], [2.32, 0.35, 0.5], [4.25, 0.2, 0.25], [6.63, 0.1, 0.12]], click: 0.12 },
  retro: {},
  noise: {},
  wood: { parts: [[1, 1, 0.09], [2.35, 0.45, 0.04], [3.9, 0.3, 0.025], [5.6, 0.15, 0.015]], tr: { fc: 3, q: 1.6, len: 0.004, a: 0.9 }, jit: 0.01 },
  water: { parts: [[1, 1, 0.055], [2, 0.06, 0.02]], tr: { fc: 4, q: 0.8, len: 0.0015, a: 0.15 }, chirp: 1, chirpT: 0.03, jit: 0.06 },
  metal: { parts: [[1, 1, 1.6], [1.008, 0.5, 1.6], [2.756, 0.7, 1.1], [5.404, 0.5, 0.7], [8.933, 0.35, 0.4], [13.34, 0.2, 0.25]], tr: { fc: 6, q: 2, len: 0.005, a: 0.6 }, jit: 0.003 },
  click: { parts: [[1, 0.3, 0.012], [2.9, 1, 0.008], [4.7, 0.6, 0.006], [7.1, 0.4, 0.004]], tr: { fc: 5, q: 1, len: 0.0015, a: 1.1 }, jit: 0.02 },
}

const ECHO = [
  null,
  { dt: 0.1, fb: 0.25, wet: 0.25, room: 0.15, len: 0.6, tail: 1 },
  { dt: 0.14, fb: 0.38, wet: 0.45, room: 0.22, len: 0.9, tail: 1.6 },
  { dt: 0.2, fb: 0.5, wet: 0.55, room: 0.3, len: 1.4, tail: 2.6 },
  { dt: 0.28, fb: 0.62, wet: 0.65, room: 0.4, len: 2.2, tail: 4 },
]

/** Ring: struck textures scale their ring time; held ones shorten each note (gate) or get a tail (rel). */
const RING = [
  { m: 0.35, gate: 0.5, rel: 0.004 },
  { m: 0.6, gate: 0.75, rel: 0.004 },
  { m: 1, gate: 1, rel: 0.004 },
  { m: 1.8, gate: 1, rel: 0.08 },
  { m: 3.2, gate: 1, rel: 0.25 },
]

/** A state-variable filter: low-pass out, band-pass in `band`. */
function svf() {
  let i1 = 0, i2 = 0, a1 = 0, a2 = 0, a3 = 0
  return {
    band: 0,
    set(fc: number, q: number) {
      const g = Math.tan((Math.PI * clamp(fc, 20, SR * 0.45)) / SR), k = 1 / q
      a1 = 1 / (1 + g * (g + k))
      a2 = g * a1
      a3 = g * a2
    },
    low(x: number) {
      const v3 = x - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3
      i1 = 2 * v1 - i1
      i2 = 2 * v2 - i2
      this.band = v1
      return v2
    },
  }
}

/** Lower notes ring longer. */
const pscale = (f: number) => clamp((330 / f) ** 0.35, 0.5, 2.2)

/**
 * The sound before echo, at 44.1 kHz, mono, its peak at 0.9 and its grit applied; null when
 * nothing is drawn. Plain code, without Web Audio.
 */
export function synthesize(s: Sound): Float32Array | null {
  const last = lastColumn(s)
  if (last < 0) return null
  const tex = TEXTURES.indexOf(s.texture)
  const T = TEX[s.texture], d = SPEED_SECONDS[s.speed], ds = d * SR
  const RG = RING[RINGS.indexOf(s.ring)]
  const n = s.pitch.map((r) => (r === null ? -1 : r))
  const parts = T.parts ?? []
  const longest = Math.max(0, ...parts.map((p) => p[2]))
  let tail = 0.05 + RG.rel * 7
  if (!isHeld(s.texture)) {
    let lo = 1e9
    n.forEach((r) => {
      if (r >= 0) lo = Math.min(lo, rowFrequency(r))
    })
    tail = Math.min(5, longest * pscale(lo) * RG.m * 5)
  }
  const N = Math.ceil(((last + 1) * d + tail) * SR), out = new Float32Array(N)

  if (isHeld(s.texture)) {
    const ka = 1 - Math.exp(-1 / (0.004 * SR)), kr = 1 - Math.exp(-1 / (RG.rel * SR)), f0 = svf()
    let ph = 0, amp = 0, f = rowFrequency(n.find((r) => r >= 0)!), nh = 1, cut = 1000, comp = 1, fb = 60
    let lastCol = -1, hitT = -1e9, crackT = -1e9, sph = 0, brown = 0, flut = 0, flutT = 0
    let clk: { t: number; f: number; a: number } | null = null
    const T16 = Math.tanh(1.6)
    for (let i = 0; i < N; i++) {
      const col = Math.floor(i / ds), r = col <= last ? n[col] : -1
      if (col !== lastCol) {
        lastCol = col
        if (r >= 0 && s.texture === 'noise') {
          const pr = col > 0 ? n[col - 1] : -1
          if (pr < 0) {
            hitT = i
            crackT = i
          } else if (!s.glide && pr !== r) hitT = i
        }
      }
      let tgt = 0
      if (r >= 0) {
        const fr = rowFrequency(r), pr = col > 0 ? n[col - 1] : -1
        if (s.glide && pr >= 0) {
          const fp = rowFrequency(pr), x = Math.min(1, (i - col * ds) / (ds * 0.85))
          f = fp + (fr - fp) * x
        } else f = fr
        tgt = i - col * ds < RG.gate * ds ? volumeGain(s.volume[col]) : 0
      }
      amp += (tgt - amp) * (tgt > amp ? ka : kr)
      if (amp < 1e-5 && tgt === 0) {
        out[i] = 0
        continue
      }
      let v: number
      if (tex === 0) v = Math.sin(ph) + 0.08 * Math.sin(2 * ph)
      else if (tex === 3) {
        // A band-limited triangle.
        if (!(i & 31)) nh = Math.max(1, Math.min(15, Math.floor(7000 / f)))
        v = 0
        for (let k = 1, sg = 1; k <= nh; k += 2, sg = -sg) v += (sg * Math.sin(k * ph)) / (k * k)
        v *= 0.81
      } else {
        // Natural noise: the row sets brightness; low rows blend in a deep brown rumble that
        // flutters. Each hit opens the filter bright and lets it darken, adds a short low kick
        // and a volume punch. Small random crackles give debris. A gentle saturation glues it.
        const ht = (i - hitT) / SR, w = clamp((400 - f) / 300, 0, 1), wn = Math.random() * 2 - 1
        if (!(i & 31)) {
          cut = clamp(f * 4, 80, 14000) * (1 + 3 * Math.exp(-ht / 0.12))
          comp = Math.min(3, Math.sqrt(3000 / cut))
          f0.set(Math.min(cut, 16000), 0.6)
          flutT = Math.random() * 2 - 1
        }
        flut += (flutT - flut) * 0.002
        brown = (brown + 0.04 * wn) * 0.996
        const y = f0.low(wn * (1 - 0.5 * w) + brown * 4 * w) * comp * (1 + 0.4 * w * flut)
        fb = 45 + f * 0.15
        sph += (6.283185 * fb * (1 + 1.5 * Math.exp(-ht / 0.02))) / SR
        v = (y + w * 1.8 * Math.exp(-ht / 0.12) * Math.sin(sph)) * (1 + 0.8 * Math.exp(-ht / 0.05))
        v = Math.tanh(1.6 * v) / T16
        if (i - crackT < 0.015 * SR) v += wn * 1.2 * Math.exp(-(i - crackT) / (0.004 * SR))
        if (!clk && amp > 0.05 && Math.random() < (15 + 40 * w) / SR) clk = { t: i, f: 800 + Math.random() * 3000, a: 0.15 + Math.random() * 0.45 }
        if (clk) {
          const k = (i - clk.t) / SR
          if (k < 0.006) v += clk.a * Math.exp(-k / 0.0015) * Math.sin(6.283185 * clk.f * k)
          else clk = null
        }
      }
      ph += (6.283185 * f) / SR
      if (ph > 6.283185e4) ph -= 6.283185e4
      out[i] = v * amp
    }
  } else {
    // Each pixel is a voice, or each run of pixels with glide: decaying partials, an attack.
    const voices: { c: number; f: number; a: number }[][] = []
    for (let c = 0; c <= last; c++) {
      if (n[c] < 0) continue
      const ev = { c, f: rowFrequency(n[c]), a: volumeGain(s.volume[c]) }
      if (s.glide && c > 0 && n[c - 1] >= 0 && voices.length) voices[voices.length - 1].push(ev)
      else voices.push([ev])
    }
    for (const evs of voices) {
      const e0 = evs[0], sc = pscale(e0.f), s0 = Math.floor(e0.c * ds), jf = 1 + (Math.random() * 2 - 1) * (T.jit ?? 0)
      let bp: ReturnType<typeof svf> | null = null, trl = 0
      if (T.tr) {
        bp = svf()
        bp.set(clamp(T.tr.fc * e0.f * jf, 200, 16000), T.tr.q)
        trl = T.tr.len * SR
      }
      const phases = parts.map(() => Math.random() * 6.28)
      const len = Math.min(N - s0, Math.floor(evs.length * ds + longest * sc * RG.m * 5 * SR))
      const a1 = 1 - Math.exp(-1 / (0.0006 * SR)), a2 = 1 - Math.exp(-1 / (0.006 * SR)), cl = Math.floor(0.003 * SR)
      const E = evs.length
      // The voice's frequency, sample by sample, while it changes (a glide into each pixel, a
      // chirp all along); after fEnd it stays at the last pixel's.
      const fEnd = T.chirp ? len : Math.min(len, Math.ceil(E * ds))
      const freq = new Float64Array(fEnd)
      for (let j = 0; j < fEnd; j++) {
        const ei = Math.min(Math.floor(j / ds), E - 1), ev = evs[ei], jr = j - ei * ds
        let f = ev.f
        if (ei > 0) {
          const fp = evs[ei - 1].f
          f = fp + (ev.f - fp) * Math.min(1, jr / (ds * 0.85))
        }
        f *= jf
        if (T.chirp) f *= 1 + T.chirp * (1 - Math.exp(-j / (T.chirpT! * SR)))
        freq[j] = f
      }
      const fLast = evs[E - 1].f * jf
      // Past the last pixel's attack and the last change of frequency, a partial only decays.
      const steady = Math.max(fEnd, Math.ceil((E - 1) * ds + (E === 1 ? 0.002 : 0.015) * SR))
      // Each partial on its own, as a rotating phasor (c, s) rather than Math.sin every sample:
      // the same wave, many times faster (a long ring is ~5 s of every partial of every pixel).
      // The step's cosine and sine are worked out again only when the frequency changes, and
      // the phasor's length is reset now and then so rounding does not drift. A partial stops
      // once it is under 2e-4 and no attack is left; until then, one under it is silent and
      // keeps its phase.
      parts.forEach(([ra, am, de], k) => {
        const dm = Math.exp(-1 / (de * sc * RG.m * SR))
        let env = 0, c = Math.cos(phases[k]), sn = Math.sin(phases[k]), w = NaN, cw = 1, sw = 0
        const tune = (fp: number) => {
          const nw = (6.283185 * fp) / SR
          if (nw !== w) {
            w = nw
            cw = Math.cos(w)
            sw = Math.sin(w)
          }
        }
        const renorm = () => {
          const r = Math.hypot(c, sn)
          c /= r
          sn /= r
        }
        let j = 0
        for (; j < len && j < steady; j++) {
          const ei = Math.min(Math.floor(j / ds), E - 1), jr = j - ei * ds
          const att = ei === 0 ? jr < 0.002 * SR : jr < 0.015 * SR
          const fp = (j < fEnd ? freq[j] : fLast) * ra
          if (fp > 16000 || (!att && env < 2e-4)) continue
          if (att) env += (evs[ei].a * am - env) * (ei === 0 ? a1 : a2)
          else env *= dm
          tune(fp)
          const x = c * cw - sn * sw
          sn = sn * cw + c * sw
          c = x
          if (!(j & 1023)) renorm()
          out[s0 + j] += env * sn
        }
        const fp = fLast * ra
        if (fp > 16000 || env < 2e-4) return
        tune(fp)
        // From here the partial only decays at one frequency: its level and its phase are one
        // complex number (re, im), turned and shrunk by the same step every sample. Checked
        // against 2e-4 every 1024 samples (it may run a little under it: inaudible).
        let re = env * c, im = env * sn
        const rr = dm * cw, ri = dm * sw
        for (; j < len; j++) {
          const y = re * rr - im * ri
          im = im * rr + re * ri
          re = y
          out[s0 + j] += im
          if (!(j & 1023) && re * re + im * im < 4e-8) break
        }
      })
      // The attack's noise: a filtered knock, or a click.
      if (bp && T.tr) {
        for (let j = 0; j < len && j < trl * 5; j++) {
          bp.low(Math.random() * 2 - 1)
          out[s0 + j] += bp.band * T.tr.a * e0.a * 2.5 * Math.exp(-j / trl)
        }
      } else {
        let lp = 0
        for (let j = 0; j < len && j < cl; j++) {
          lp += 0.5 * (Math.random() * 2 - 1 - lp)
          out[s0 + j] += lp * (T.click ?? 0) * e0.a * (1 - j / cl)
        }
      }
    }
  }
  let pk = 0
  for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(out[i]))
  if (pk > 0) {
    const m = 0.9 / pk
    for (let i = 0; i < N; i++) out[i] *= m
  }
  const fl = Math.min(N, Math.floor(0.005 * SR))
  for (let i = 0; i < fl; i++) out[N - 1 - i] *= i / fl
  const G = GRIT[GRITS.indexOf(s.grit)]
  if (G.drive) {
    const td = Math.tanh(G.drive), la = G.lp ? 1 - Math.exp((-6.2832 * G.lp) / SR) : 1, q = G.bits ? 2 ** (G.bits - 1) : 0
    let held = 0, lp = 0
    for (let i = 0; i < N; i++) {
      let x = Math.tanh(G.drive * out[i]) / td
      if (G.hold) {
        if (i % G.hold === 0) held = x
        x = held
      }
      if (q) x = Math.round(x * q) / q
      lp += la * (x - lp)
      out[i] = lp
    }
  }
  return out
}

/** A small generated room, for the echo: decaying noise, darkening as it decays, in two
 *  channels. Its filter was tuned at 44.1 kHz: at another rate its step is changed to keep the
 *  same color. */
function roomIR(L: number, rate: number): Float64Array[] {
  const n = Math.ceil(L * rate)
  return [0, 1].map(() => {
    const d = new Float64Array(n)
    let y = 0
    for (let i = 0; i < n; i++) {
      const t = i / rate
      const k = 1 - (1 - (0.1 + 0.7 * Math.exp(-t / (L * 0.3)))) ** (SR / rate)
      y += k * ((Math.random() * 2 - 1) * Math.exp((-6.9 * t) / L) - y)
      d[i] = y
    }
    return d
  })
}

/** Samples (at RATE) each pass of the echo's feedback comes back late: 128 at 44.1 kHz. */
const FEEDBACK_LAG = Math.round((128 * RATE) / SR)

/** In place: the Fourier transform of (re, im), whose length is a power of 2, or its inverse
 *  (not divided by the length). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, a = ((inverse ? 2 : -2) * Math.PI) / size
    const wr = Math.cos(a), wi = Math.sin(a)
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0
      for (let k = 0; k < half; k++) {
        const i = start + k, j = i + half
        const tr = re[j] * cr - im[j] * ci, ti = re[j] * ci + im[j] * cr
        re[j] = re[i] - tr
        im[j] = im[i] - ti
        re[i] += tr
        im[i] += ti
        const c = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = c
      }
    }
  }
}

/** x convolved with h, its first `n` samples: through the Fourier transform, the two real
 *  signals in one complex one (x real, h imaginary). */
function convolve(x: Float32Array, h: Float64Array, n: number): Float64Array {
  let size = 1
  while (size < x.length + h.length - 1) size <<= 1
  const re = new Float64Array(size), im = new Float64Array(size)
  re.set(x)
  im.set(h)
  fft(re, im, false)
  // X and H from the transform of x + ih, then X·H, back.
  const pr = new Float64Array(size), pi = new Float64Array(size)
  for (let k = 0; k < size; k++) {
    const m = (size - k) & (size - 1)
    const xr = (re[k] + re[m]) / 2, xi = (im[k] - im[m]) / 2
    const hr = (im[k] + im[m]) / 2, hi = (re[m] - re[k]) / 2
    pr[k] = xr * hr - xi * hi
    pi[k] = xr * hi + xi * hr
  }
  fft(pr, pi, true)
  const out = new Float64Array(n)
  for (let i = 0; i < n && i < size; i++) out[i] = pr[i] / size
  return out
}

/**
 * The echo, at RATE: the sound, plus a delay with feedback darkened by a low-pass at each
 * pass, plus a small room. It is what Web Audio made of the same graph (a DelayNode, a
 * BiquadFilterNode, a ConvolverNode normalizing its room, mixed to one channel), in plain code:
 * it works the same everywhere, in a game, and in tests.
 */
function addEcho(dry: Float32Array, echo: Echo): Float32Array {
  const E = ECHO[ECHOES.indexOf(echo)]
  if (!E) return dry
  const n = dry.length + Math.ceil(E.tail * RATE)
  const out = new Float64Array(n)
  // The delay: the sound comes out D samples later through the low-pass, and goes back in.
  // Web Audio, where the echo was tuned, makes each pass back one block of 128 samples later
  // (how it runs a loop in its graph): 2.9 ms at the 44.1 kHz it was tuned at, kept.
  const D = Math.round(E.dt * RATE), Q = FEEDBACK_LAG
  const back = new Float64Array(n)
  const w0 = (2 * Math.PI * 3500) / RATE, alpha = Math.sin(w0) / (2 * 10 ** (1 / 20))
  const a0 = 1 + alpha, b0 = (1 - Math.cos(w0)) / 2 / a0, b1 = (1 - Math.cos(w0)) / a0, b2 = b0
  const a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const x = (i >= D && i - D < dry.length ? dry[i - D] : 0) + (i >= D + Q ? E.fb * back[i - D - Q] : 0)
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    back[i] = y
    out[i] = (i < dry.length ? dry[i] : 0) + E.wet * y
  }
  // The room, scaled as a ConvolverNode normalizes it, its two channels mixed to one.
  const [hl, hr] = roomIR(E.len, RATE)
  let power = 0
  for (let i = 0; i < hl.length; i++) power += hl[i] * hl[i] + hr[i] * hr[i]
  power = Math.max(0.000125, Math.sqrt(power / (2 * hl.length)))
  const scale = ((0.00125 / power) * (44100 / RATE) * E.room) / 2
  const h = new Float64Array(hl.length)
  for (let i = 0; i < h.length; i++) h[i] = (hl[i] + hr[i]) * scale
  const room = convolve(dry, h, n)
  const res = new Float32Array(n)
  for (let i = 0; i < n; i++) res[i] = out[i] + room[i]
  return res
}

/**
 * As it plays, from the sound at RATE: at its loudest (0.9), its silent end cut off (20 ms
 * kept, faded), in 8-bit steps.
 */
function finish(d: Float32Array): Float32Array {
  let pk = 0, end = 0
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]))
  for (let i = d.length - 1; i >= 0; i--) {
    if (Math.abs(d[i]) > pk * 0.001) {
      end = i
      break
    }
  }
  const n = Math.max(1, Math.min(d.length, end + Math.floor(0.02 * RATE)))
  const m = pk > 0 ? 0.9 / pk : 1, fl = Math.floor(0.02 * RATE)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(d[i] * m * (i > n - fl ? (n - i) / fl : 1) * 127) / 127
  return out
}

/** The sound, as it plays: mono, at RATE, 8-bit steps; null when nothing is drawn. */
export function renderSound(s: Sound): Float32Array | null {
  const dry = synthesize(s)
  return dry ? finish(addEcho(resample(dry, SR, RATE), s.echo)) : null
}

/** The sound without its echo: a pixel heard as it is drawn. */
export function renderDry(s: Sound): Float32Array | null {
  const dry = synthesize(s)
  return dry ? finish(resample(dry, SR, RATE)) : null
}

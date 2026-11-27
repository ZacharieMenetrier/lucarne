// Play mode: the game takes over the window, with a thin bar to pause or stop it.
//
// The game's code is game.js, in the game folder. On Mac, the local server rebuilds it
// from actors/ and code/ just before playing; on iPad, it is the file synced from GitHub.
// It gets the engine through globalThis.__lucarne (see server/build.mjs).

import * as engine from '../../runtime/index'
import { screenSize, type GameConfig } from '../../runtime/game'
import { setMaps, type TilesetData } from '../../runtime/maps'
import { setFonts, type FontData } from '../../runtime/fonts'
import type { Button } from '../../runtime/input'
import { Runner } from '../../runtime/runner'
import { waitingScripts } from '../../runtime/scripts'
import { attachScreen, writtenText } from '../../runtime/screen'
import { setSprites, type SpriteData } from '../../runtime/sprites'
import { heardSounds, setSounds } from '../../runtime/sounds'
import { time } from '../../runtime/time'
import { actorName, camera, cameraMapName, drawWorld, placeActors, resetWorld, setActorFiles, worldActors } from '../../runtime/world'
import type { Bitmap } from './bitmap'
import { TRANSPARENT } from './color'
import { h } from './dialog'
import { icon } from './icons'
import { currentPage } from './menu'
import { NO_GAME_SIZE, noGame } from './nogame'
import { toImageData } from './png'
import type { Project } from './project'
import { composeSheet, fontKey, isTileset, tilesetName, type Sprite } from './sprite'
import { readText, type Storage } from './storage'

const GAME_FILE = 'game.js'
const MAIN = 'code/main.ts'
/** Space between the screen and its caption (see .play-screen in style.css). */
const CAPTION_GAP = 20

let engineTurn: Promise<unknown> = Promise.resolve()

/**
 * Runs `fn` alone with the engine: its world, sprites and maps are one set, shared by the
 * game that starts and by the world editor, which runs the game's code to draw its actors.
 * One waits for the other.
 */
export function useEngine<T>(fn: () => Promise<T>): Promise<T> {
  const run = engineTurn.then(fn, fn)
  engineTurn = run.catch(() => {})
  return run
}

/** Is a game on screen (running or paused)? Editor shortcuts stay off meanwhile. */
export function isPlaying() {
  return document.body.dataset.playing === 'true'
}

export class Player {
  private runner: Runner | null = null
  private readonly root: HTMLElement
  private readonly stage: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly message: HTMLElement
  private readonly caption: HTMLElement
  private readonly pauseButton: HTMLButtonElement
  private readonly timings: HTMLElement
  private timingsTimer = 0
  private readonly resize = new ResizeObserver(() => this.fit())
  private loading = false

  constructor(
    private readonly project: Project,
    /** Saves what the editor has not saved yet, so the game plays the sprites as drawn. */
    private readonly saveFirst: () => Promise<void>,
  ) {
    this.pauseButton = h('button', {
      type: 'button',
      className: 'icon',
      title: 'Pause (Esc)',
      'aria-label': 'Pause',
      html: icon('pause'),
      onclick: () => this.togglePause(),
    })
    const stop = h('button', {
      type: 'button',
      className: 'icon',
      title: 'Stop and go back to the editor',
      'aria-label': 'Stop',
      html: icon('stop'),
      onclick: () => this.stop(),
    })
    this.canvas = h('canvas', { className: 'play-canvas' })
    this.message = h('div', { className: 'play-message', hidden: true })
    this.caption = h('div', { className: 'play-caption', hidden: true })
    this.stage = h('div', { className: 'play-stage' },
      h('div', { className: 'play-screen' }, this.canvas, this.caption), this.message)
    this.timings = h('span', { className: 'play-timings muted', title: 'Time per update and per displayed frame, out of 16.7 ms' })
    this.root = h('div', { id: 'play-mode', hidden: true },
      h('header', { className: 'page-bar play-bar' }, this.pauseButton, stop, h('span', { className: 'spacer' }), this.timings),
      this.stage)
    document.body.append(this.root)
    this.resize.observe(this.stage)

    this.watchPixelDensity()
    installHandle(this)

    window.addEventListener('keydown', (e) => this.onKey(e), true)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.runner?.pause()
      this.renderBar()
    })
  }

  /** Builds (on Mac), loads and starts the game. */
  async play() {
    if (this.loading) return
    this.loading = true
    ;(document.activeElement as HTMLElement | null)?.blur()
    this.runner?.stop()
    this.runner = null
    this.show(true)
    this.say('Loading…')
    try {
      await this.saveFirst()
      await useEngine(async () => {
        const code = await this.loadCode()
        if (code === null) return
        const settings = await loadGameData(this.project)
        // The game's code spawns its actors as it runs: in an empty world. Then come the
        // actors placed on the maps, whose classes exist once the code has run.
        resetWorld()
        const config = await importGame(code)
        placeActors()
        this.run(config, screenSize(settings))
      })
    } catch (err) {
      this.say(`The game could not start:\n\n${describe(err)}`, true)
    } finally {
      this.loading = false
      this.renderBar()
    }
  }

  private run(config: GameConfig, size: { width: number; height: number }, caption?: HTMLElement) {
    this.runner = new Runner(config, this.canvas, (err) => {
      this.runner = null
      this.renderBar()
      this.say(`The game stopped on an error:\n\n${describe(err)}`, true)
    }, size)
    this.say(null)
    this.caption.hidden = !caption
    this.caption.replaceChildren(...(caption ? [caption] : []))
    this.fit()
    this.runner.start()
  }

  /** The game has no code yet: a little scene instead, and how to start one. */
  private showNoGame() {
    const hint =
      this.storage.kind === 'server'
        ? h('p', {}, 'Write an actor in ', h('code', {}, 'actors/'), ' in the game folder, then press ▶ again.')
        : h('p', {}, 'Write an actor in ', h('code', {}, 'actors/'), ' on the Mac, push it, then sync here.')
    resetWorld()
    setMaps(16, [], [])
    setSounds([])
    setActorFiles({})
    this.run(noGame, NO_GAME_SIZE, h('div', {}, h('p', { className: 'play-caption-title' }, 'No game in Lucarne yet.'), hint))
  }

  togglePause() {
    const r = this.runner
    if (!r) return
    if (r.paused) r.resume()
    else r.pause()
    this.renderBar()
  }

  stop() {
    this.runner?.stop()
    this.runner = null
    this.show(false)
  }

  /** The running (or paused) game, for the AI handle. */
  get current() {
    return this.runner
  }

  private get storage() {
    return this.project.storage
  }

  /** Returns game.js, or null after explaining why there is none. */
  private async loadCode(): Promise<string | null> {
    const got = await fetchGameCode(this.storage)
    if ('code' in got) return got.code
    if ('error' in got) this.say(`The game's code does not build:\n\n${got.error}`, true)
    else if (this.storage.kind === 'server' && got.built) this.say('game.js is missing from the game folder.')
    else this.showNoGame()
    return null
  }

  private onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    if (target?.closest?.('input, textarea, select, dialog') || document.querySelector('dialog[open]')) return
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (!isPlaying()) {
        if (currentPage() !== 'settings') void this.play()
      } else if (this.runner?.paused) this.togglePause()
      else if (!this.runner) void this.play()
      return
    }
    if (!isPlaying()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (this.runner) this.togglePause()
      else this.stop()
    }
  }

  private show(on: boolean) {
    this.root.hidden = !on
    document.body.dataset.playing = String(on)
    clearInterval(this.timingsTimer)
    if (on) this.timingsTimer = window.setInterval(() => this.renderTimings(), 500)
  }

  /** How long the game takes, against the 16.7 ms an update may take. */
  private renderTimings() {
    const t = this.runner?.timings
    if (!t || this.runner?.paused) return
    const hz = t.frame > 0 ? ` · ${Math.round(1000 / t.frame)} Hz` : ''
    this.timings.textContent = `update ${t.update.toFixed(2)} ms · draw ${t.draw.toFixed(2)} ms${hz}`
  }

  /**
   * Fits the game again when the window moves to a screen with another pixel density
   * (a Retina screen and an external one): the stage keeps its size, so nothing else says.
   */
  private watchPixelDensity() {
    const watch = () => {
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
        this.fit()
        watch()
      }, { once: true })
    }
    watch()
  }

  private say(text: string | null, error = false) {
    this.message.hidden = text === null
    this.message.classList.toggle('error', error)
    this.message.replaceChildren(h('pre', {}, text ?? ''))
    this.canvas.hidden = text !== null
    if (text !== null) this.caption.hidden = true
  }

  private renderBar() {
    const paused = this.runner?.paused ?? false
    this.pauseButton.disabled = !this.runner
    this.pauseButton.innerHTML = icon(paused ? 'play' : 'pause')
    this.pauseButton.title = paused ? 'Resume (Esc)' : 'Pause (Esc)'
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume' : 'Pause')
    this.root.classList.toggle('paused', paused)
  }

  /**
   * Gives the game the stage's space, in display pixels: the runner picks the scale and
   * sizes the canvas. The canvas is then shown at one canvas pixel per display pixel; the
   * stage's black fills the rest.
   */
  private fit() {
    const r = this.runner
    if (!r) return
    const dpr = window.devicePixelRatio || 1
    const box = this.stage.getBoundingClientRect()
    const height = box.height - (this.caption.hidden ? 0 : this.caption.offsetHeight + CAPTION_GAP)
    r.fit(Math.floor(box.width * dpr), Math.floor(height * dpr))
    this.canvas.style.width = `${this.canvas.width / dpr}px`
    this.canvas.style.height = `${this.canvas.height / dpr}px`
  }
}

/**
 * game.js, rebuilt from code/ first on Mac (on iPad, the file synced from GitHub), or why
 * there is none: no code yet (`built` when the build said it was fine and the file is
 * still missing), or the error that stops it from building.
 */
export async function fetchGameCode(storage: Storage): Promise<{ code: string } | { error: string } | { missing: true; built: boolean }> {
  let built = false
  if (storage.kind === 'server') {
    const res = await fetch('/__lucarne/build', { method: 'POST' })
    if (!res.ok) throw new Error((await res.text()) || `Error ${res.status}`)
    const result = (await res.json()) as { ok: boolean; error?: string; missing?: boolean }
    if (result.missing) return { missing: true, built: false }
    if (!result.ok) return { error: result.error ?? '' }
    built = true
  }
  const code = await readText(storage, GAME_FILE)
  return code === null ? { missing: true, built } : { code }
}

/** Hands the engine every sprite, font, sound, tileset, actor file and map of the game, as saved,
 * before its code runs. Returns the game's settings. */
export async function loadGameData(project: Project) {
  const settings = await project.loadSettings()
  setSprites(await loadSprites(project))
  setFonts(await loadFonts(project))
  setSounds(await loadSounds(project))
  setMaps(settings.tileSize, await loadTilesets(project), await loadMaps(project))
  setActorFiles(Object.fromEntries(await project.loadActorFiles()))
  return settings
}

/** Every tileset of the game (tiles/), for the maps. */
async function loadTilesets(project: Project): Promise<TilesetData[]> {
  const names = (await project.listBoard()).filter(isTileset)
  return Promise.all(
    names.map(async (name) => {
      const sprite = await project.loadSprite(name)
      return { name: tilesetName(name), sheet: toCanvas(sprite.frames[0]), solid: sprite.meta.solid }
    }),
  )
}

/** Every map of the game (maps/): the whole world. */
async function loadMaps(project: Project) {
  return Promise.all((await project.listMaps()).map((name) => project.loadMap(name)))
}

/** Every sprite of the game, as saved, for the engine's `sprite()`. */
async function loadSprites(project: Project): Promise<SpriteData[]> {
  const names = await project.listSprites()
  return Promise.all(
    names.map(async (name) => {
      try {
        return toSpriteData(await project.loadSprite(name))
      } catch (err) {
        throw new Error(`The sprite "${name}" could not be read: ${describe(err)}`)
      }
    }),
  )
}

/** Every sound of the game (sounds/), for the engine's `sound()`. */
async function loadSounds(project: Project) {
  return Promise.all((await project.listSounds()).map(async (name) => ({ name, sound: await project.loadSound(name) })))
}

/** Every font of the game (fonts/), for the engine's `font()`. */
async function loadFonts(project: Project): Promise<FontData[]> {
  const names = await project.listFonts()
  return Promise.all(
    names.map(async (name) => {
      try {
        return toFontData(name, (await project.loadSprite(fontKey(name))).frames[0])
      } catch (err) {
        throw new Error(`The font "${name}" could not be read: ${describe(err)}`)
      }
    }),
  )
}

function toCanvas(bmp: Bitmap) {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  canvas.getContext('2d')!.putImageData(toImageData(bmp), 0, 0)
  return canvas
}

function toSpriteData(sprite: Sprite): SpriteData {
  const canvas = toCanvas(composeSheet(sprite))
  const { meta } = sprite
  return {
    name: sprite.name,
    frameWidth: meta.frameWidth,
    frameHeight: meta.frameHeight,
    durations: meta.frames.map((f) => f.duration),
    origin: meta.origin,
    sheet: canvas,
  }
}

export function toFontData(name: string, sheet: Bitmap): FontData {
  return { name, sheet: toCanvas(sheet), width: sheet.width, height: sheet.height, ink: (x, y) => sheet.get(x, y) !== TRANSPARENT }
}

/**
 * `window.lucarne`, to drive the game from a script (what an AI uses to test it), in play
 * mode. Everything works with the page hidden: the game only moves when told to.
 *
 *   await lucarne.step(60, ['right'])   // one second with "right" held, then shows the result
 *                                       // → { ticks, actors, sounds: ['jump'] }: the sounds played, not heard
 *   lucarne.actors()              // [{ actor: 'hero', x: 267, y: 120, box: { x, y, width, height }, … }]
 *   lucarne.picture()             // the frame at game resolution, as a PNG data URL
 *   lucarne.ui()                  // the text on screen: ['♥ 3', 'Want a sword?']
 *   lucarne.scripts()             // what each script waits on: [{ by: 'npc', waiting: 'press action' }]
 *   lucarne.camera()              // { x, y, map }: where the camera is, and in which map
 *   lucarne.timings()             // milliseconds per update, per drawing, per frame
 */
function installHandle(player: Player) {
  const runner = () => {
    const r = player.current
    if (!r) throw new Error('No game is running: open the editor with ?play, or press ▶.')
    return r
  }
  ;(window as unknown as { lucarne: unknown }).lucarne = {
    async step(count = 1, buttons: Button[] = []) {
      heardSounds()
      await runner().step(count, buttons)
      return { ticks: time.ticks, actors: describeActors(), sounds: heardSounds() }
    },
    pause() {
      runner().pause()
    },
    resume() {
      runner().resume()
    },
    actors: describeActors,
    camera: () => ({ x: camera.x, y: camera.y, map: cameraMapName() }),
    ui: () => writtenText().map((t) => t.text),
    scripts: waitingScripts,
    timings: () => ({ ...runner().timings }),
    /** The world as shown now, at 1 display pixel per game pixel. */
    async picture() {
      const r = runner()
      const canvas = new OffscreenCanvas(r.width, r.height)
      attachScreen(canvas, r.width, r.height)
      try {
        drawWorld(1, r.draw, r.ui)
      } finally {
        attachScreen(r.canvas, r.width, r.height)
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
    },
  }
}

/** Each actor's name (its file's, or its class's), position and own simple fields as they
 * are now (numbers, text, booleans, lists of text), and its box where it is in the world, to
 * check walls without a picture. */
function describeActors() {
  const round = (v: number) => Math.round(v * 1000) / 1000
  return worldActors()
    .filter((t) => !t.removed)
    .map((t) => {
      const out: Record<string, unknown> = { actor: actorName(t.constructor) ?? t.constructor.name }
      for (const [k, v] of Object.entries(t)) {
        if (['number', 'string', 'boolean'].includes(typeof v)) out[k] = typeof v === 'number' ? round(v) : v
        else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v
      }
      if (t.box) {
        const { x, y, width, height } = t.box
        out.box = { x: round(t.x + x), y: round(t.y + y), width, height }
      }
      return out
    })
}

/**
 * Runs game.js: it registers the actor files (see `actorClasses`), its top-level code runs
 * (spawning its actors), and it gives the game code/main.ts declares.
 */
export async function importGame(code: string): Promise<GameConfig> {
  ;(globalThis as { __lucarne?: unknown }).__lucarne = engine
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  let mod: Record<string, unknown>
  try {
    mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } finally {
    URL.revokeObjectURL(url)
  }
  const config = mod.default
  if (!config || typeof config !== 'object') {
    throw new Error(`${MAIN} must end with \`export default game({ … })\`.`)
  }
  return config as GameConfig
}

export function describe(err: unknown) {
  if (err instanceof Error) return `${err.name === 'Error' ? '' : `${err.name}: `}${err.message}`
  return String(err)
}

// Play mode: the game takes over the window, with a thin bar to pause or stop it.
//
// The game's code is game.js, in the game folder. On Mac, the local server rebuilds it
// from code/ just before playing; on iPad, it is the file synced from GitHub. It gets
// the engine through globalThis.__lucarne (see server/build.mjs).

import * as engine from '../../runtime/index'
import type { GameConfig, GameSettings } from '../../runtime/game'
import { setMaps, type TilesetData } from '../../runtime/maps'
import { setFonts, type FontData } from '../../runtime/fonts'
import type { Button } from '../../runtime/input'
import { Runner } from '../../runtime/runner'
import { attachScreen, writtenText } from '../../runtime/screen'
import { setSprites, type SpriteData } from '../../runtime/sprites'
import { time } from '../../runtime/time'
import { camera, cameraMapName, drawWorld, modalThing, resetWorld, worldThings } from '../../runtime/world'
import type { Bitmap } from './bitmap'
import type { FontMeta } from './font'
import { h } from './dialog'
import { icon } from './icons'
import { currentPage } from './menu'
import { NO_GAME_SIZE, noGame } from './nogame'
import { toImageData } from './png'
import type { Project } from './project'
import { composeSheet, isTileset, tilesetName, type Sprite } from './sprite'
import { readText } from './storage'

const GAME_FILE = 'game.js'
const ENTRY = 'code/main.ts'
/** Space between the screen and its caption (see .play-screen in style.css). */
const CAPTION_GAP = 20

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
      const code = await this.loadCode()
      if (code === null) return
      const settings = await this.project.loadSettings()
      setSprites(await this.loadSprites())
      setFonts(await this.loadFonts())
      setMaps(settings.tileSize, await this.loadTilesets(), await this.loadMaps())
      // The game's code creates its things as it runs: in an empty world.
      resetWorld()
      this.run(await importGame(code), settings)
    } catch (err) {
      this.say(`The game could not start:\n\n${describe(err)}`, true)
    } finally {
      this.loading = false
      this.renderBar()
    }
  }

  private run(config: GameConfig, size: Pick<GameSettings, 'width' | 'height'>, caption?: HTMLElement) {
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
        ? h('p', {}, 'Write ', h('code', {}, ENTRY), ' in the game folder, then press ▶ again.')
        : h('p', {}, 'Write ', h('code', {}, ENTRY), ' on the Mac, push it, then sync here.')
    resetWorld()
    setMaps(16, [], [])
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

  /** Every tileset of the game (tiles/), for the maps. */
  private async loadTilesets(): Promise<TilesetData[]> {
    const names = (await this.project.listBoard()).filter(isTileset)
    return Promise.all(
      names.map(async (name) => {
        const sprite = await this.project.loadSprite(name)
        return { name: tilesetName(name), sheet: toCanvas(sprite.frames[0]) }
      }),
    )
  }

  /** Every map of the game (maps/): the whole world. */
  private async loadMaps() {
    return Promise.all((await this.project.listMaps()).map((name) => this.project.loadMap(name)))
  }

  /** Every sprite of the game, as saved, for the engine's `sprite()`. */
  private async loadSprites(): Promise<SpriteData[]> {
    const names = await this.project.listSprites()
    return Promise.all(
      names.map(async (name) => {
        try {
          return toSpriteData(await this.project.loadSprite(name))
        } catch (err) {
          throw new Error(`The sprite "${name}" could not be read: ${describe(err)}`)
        }
      }),
    )
  }

  /** Every font of the game (fonts/), for the engine's `font()`. */
  private async loadFonts(): Promise<FontData[]> {
    const names = await this.project.listFonts()
    return Promise.all(
      names.map(async (name) => {
        try {
          return toFontData(name, await this.project.loadFont(name))
        } catch (err) {
          throw new Error(`The font "${name}" could not be read: ${describe(err)}`)
        }
      }),
    )
  }

  /** Returns game.js, or null after explaining why there is none. */
  private async loadCode(): Promise<string | null> {
    if (this.storage.kind === 'server') {
      const res = await fetch('/__lucarne/build', { method: 'POST' })
      if (!res.ok) throw new Error((await res.text()) || `Error ${res.status}`)
      const result = (await res.json()) as { ok: boolean; error?: string; missing?: boolean }
      if (result.missing) {
        this.showNoGame()
        return null
      }
      if (!result.ok) {
        this.say(`The game's code does not build:\n\n${result.error ?? ''}`, true)
        return null
      }
    }
    const code = await readText(this.storage, GAME_FILE)
    if (code === null) {
      if (this.storage.kind === 'server') this.say('game.js is missing from the game folder.')
      else this.showNoGame()
    }
    return code
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

function toFontData(name: string, font: { sheet: Bitmap; meta: FontMeta }): FontData {
  return { name, ...font.meta, sheet: toCanvas(font.sheet) }
}

/**
 * `window.lucarne`, to drive the game from a script (what an AI uses to test it), in play
 * mode. Everything works with the page hidden: the game only moves when told to.
 *
 *   lucarne.step(60, ['right'])   // one second with "right" held, then shows the result
 *   lucarne.things()              // [{ type: 'Hero', x: 267, y: 120, facing: 'east', … }]
 *   lucarne.picture()             // the frame at game resolution, as a PNG data URL
 *   lucarne.ui()                  // the text on screen, and the modal thing in charge
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
    step(count = 1, buttons: Button[] = []) {
      runner().step(count, buttons)
      return { ticks: time.ticks, things: describeThings() }
    },
    pause() {
      runner().pause()
    },
    resume() {
      runner().resume()
    },
    things: describeThings,
    camera: () => ({ x: camera.x, y: camera.y, map: cameraMapName() }),
    ui() {
      const modal = modalThing()
      return { modal: modal ? modal.constructor.name : null, text: writtenText().map((t) => t.text) }
    },
    timings: () => ({ ...runner().timings }),
    /** The world as shown now, at 1 display pixel per game pixel. */
    async picture() {
      const r = runner()
      const canvas = new OffscreenCanvas(r.width, r.height)
      attachScreen(canvas, r.width, r.height)
      try {
        drawWorld(1, r.draw)
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

/** Each thing's type, position and own simple fields (numbers, text, booleans). */
function describeThings() {
  return worldThings()
    .filter((t) => !t.removed)
    .map((t) => {
      const out: Record<string, unknown> = { type: t.constructor.name }
      for (const [k, v] of Object.entries(t)) {
        if (['number', 'string', 'boolean'].includes(typeof v)) out[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
      }
      return out
    })
}

async function importGame(code: string): Promise<GameConfig> {
  ;(globalThis as { __lucarne?: unknown }).__lucarne = engine
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  let mod: { default?: unknown }
  try {
    mod = (await import(/* @vite-ignore */ url)) as { default?: unknown }
  } finally {
    URL.revokeObjectURL(url)
  }
  const config = mod.default
  if (!config || typeof config !== 'object') {
    throw new Error(`${ENTRY} must end with \`export default game({ … })\`.`)
  }
  return config as GameConfig
}

function describe(err: unknown) {
  if (err instanceof Error) return `${err.name === 'Error' ? '' : `${err.name}: `}${err.message}`
  return String(err)
}

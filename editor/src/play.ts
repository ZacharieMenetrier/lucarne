// Play mode: the game takes over the window, with a thin bar to pause or stop it.
//
// The game's code is game.js, in the game folder. On Mac, the local server rebuilds it
// from code/ just before playing; on iPad, it is the file synced from GitHub. It gets
// the engine through globalThis.__lucarne (see server/build.mjs).

import * as engine from '../../runtime/index'
import type { GameConfig } from '../../runtime/game'
import { Runner } from '../../runtime/runner'
import { h } from './dialog'
import { icon } from './icons'
import { currentPage } from './menu'
import { noGame } from './nogame'
import { readText, type Storage } from './storage'

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
  private readonly resize = new ResizeObserver(() => this.fit())
  private loading = false

  constructor(private readonly storage: Storage) {
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
    this.root = h('div', { id: 'play-mode', hidden: true },
      h('header', { className: 'page-bar play-bar' }, this.pauseButton, stop, h('span', { className: 'spacer' })),
      this.stage)
    document.body.append(this.root)
    this.resize.observe(this.stage)

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
      const code = await this.loadCode()
      if (code === null) return
      this.run(await importGame(code))
    } catch (err) {
      this.say(`The game could not start:\n\n${describe(err)}`, true)
    } finally {
      this.loading = false
      this.renderBar()
    }
  }

  private run(config: GameConfig, caption?: HTMLElement) {
    this.runner = new Runner(config, this.canvas, (err) => {
      this.runner = null
      this.renderBar()
      this.say(`The game stopped on an error:\n\n${describe(err)}`, true)
    })
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
    this.run(noGame, h('div', {}, h('p', { className: 'play-caption-title' }, 'No game in Lucarne yet.'), hint))
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
        if (currentPage() === 'editor') void this.play()
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

  /** Largest whole scale (in device pixels) at which the game fits. */
  private fit() {
    const r = this.runner
    if (!r) return
    const dpr = window.devicePixelRatio || 1
    const box = this.stage.getBoundingClientRect()
    const height = box.height - (this.caption.hidden ? 0 : this.caption.offsetHeight + CAPTION_GAP)
    const scale = Math.max(1, Math.floor(Math.min((box.width * dpr) / r.width, (height * dpr) / r.height)))
    this.canvas.style.width = `${(r.width * scale) / dpr}px`
    this.canvas.style.height = `${(r.height * scale) / dpr}px`
  }
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

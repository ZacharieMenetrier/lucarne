// The burger menu (top left) and the pages it switches between: the engine's
// tools, and the settings. The editor stays loaded underneath other pages.

import { h } from './dialog'
import { icon } from './icons'

export type Page = 'editor' | 'actors' | 'world' | 'music' | 'settings'

const PAGES: Record<Page, string> = { editor: '', actors: '#actors', world: '#world', music: '#music', settings: '#settings' }

/**
 * The engine's editors, in the switch at the left of every top bar, in the order a game is
 * made: the pixels, the actors made of them, the world they are placed in, its music.
 */
const EDITORS: { page: Page; label: string; title: string }[] = [
  { page: 'editor', label: 'Pixels', title: 'Pixel art editor: sprites and tilesets' },
  { page: 'actors', label: 'Actors', title: 'Actors: the box and the values of each actor' },
  { page: 'world', label: 'World', title: 'World editor: maps and actors' },
  { page: 'music', label: 'Music', title: 'Music: songs, played by instruments' },
]

export function currentPage(): Page {
  if (location.hash === PAGES.settings) return 'settings'
  if (location.hash === PAGES.world) return 'world'
  if (location.hash === PAGES.actors) return 'actors'
  if (location.hash === PAGES.music) return 'music'
  return 'editor'
}

const listeners: ((page: Page) => void)[] = []

/** Calls `fn` now and on every page change (menu, back button). */
export function onPage(fn: (page: Page) => void) {
  listeners.push(fn)
  fn(currentPage())
}

function emit() {
  const page = currentPage()
  document.body.dataset.page = page
  for (const fn of listeners) fn(page)
}

export function goTo(page: Page) {
  if (page === currentPage()) return
  history.pushState(null, '', PAGES[page] || location.pathname + location.search)
  emit()
}

window.addEventListener('popstate', emit)
window.addEventListener('hashchange', emit)
document.body.dataset.page = currentPage()

/** A burger button with its drop-down menu, for the start of a top bar. `actions` go under the tools. */
export function createMenu(actions: MenuAction[] = []): HTMLElement {
  const items = h('div', { className: 'menu-list', role: 'menu', hidden: true })
  const button = h('button', {
    type: 'button',
    className: 'icon menu-button',
    title: 'Menu',
    'aria-label': 'Menu',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    html: icon('menu'),
  })
  const wrap = h('div', { className: 'menu' }, button, items)

  const item = (page: Page, label: string): HTMLElement =>
    h('button', {
      type: 'button',
      role: 'menuitemradio',
      className: 'menu-item',
      'data-page': page,
      onclick: () => {
        close()
        goTo(page)
      },
    }, label)

  items.append(
    ...actions.map((a) =>
      h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'menu-item',
        onclick: () => {
          close()
          a.run()
        },
      }, a.label),
    ),
    ...(actions.length ? [h('hr')] : []),
    item('settings', 'Settings'),
  )

  const close = dropdown(wrap, button, items, () => {
    const page = currentPage()
    for (const el of items.querySelectorAll<HTMLElement>('[data-page]')) {
      const on = el.dataset.page === page
      el.classList.toggle('current', on)
      el.setAttribute('aria-checked', String(on))
    }
  })
  return wrap
}

/**
 * The switch between the editors (Pixels | Actors | World | Music), next to the menu: going from one to the
 * other is what is done most, so it is always in view. On another page (settings), neither
 * is lit, and either one goes back.
 */
export function createEditorSwitch(): HTMLElement {
  const buttons = EDITORS.map((e) =>
    h('button', {
      type: 'button',
      role: 'radio',
      title: e.title,
      'data-editor': e.page,
      onclick: () => goTo(e.page),
    }, e.label))
  const el = h('div', { className: 'editor-switch', role: 'radiogroup', 'aria-label': 'Editor' }, ...buttons)
  onPage((page) => {
    for (const b of buttons) {
      const on = b.dataset.editor === page
      b.classList.toggle('active', on)
      b.setAttribute('aria-checked', String(on))
    }
  })
  return el
}

export interface MenuAction {
  label: string
  run: () => void
  danger?: boolean
}

/** A ⋮ button with a drop-down list of actions, opening below it towards the left,
 *  or above it when there is no room below (a row at the bottom of the screen). */
export function createActionsMenu(title: string, actions: MenuAction[]): { el: HTMLElement; button: HTMLButtonElement } {
  const items = h('div', { className: 'menu-list end', role: 'menu', hidden: true })
  const button = h('button', {
    type: 'button',
    className: 'small icon-btn',
    title,
    'aria-label': title,
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    html: icon('more'),
  })
  const wrap = h('div', { className: 'menu' }, button, items)
  // Fixed, so a scrolling list around the button does not clip it.
  const close = dropdown(wrap, button, items, () => {
    const r = button.getBoundingClientRect()
    const height = items.offsetHeight
    const below = r.bottom + 4
    const fits = below + height <= window.innerHeight - 8
    items.style.top = `${fits ? below : Math.max(8, r.top - 4 - height)}px`
    items.style.right = `${window.innerWidth - r.right}px`
  })
  items.append(
    ...actions.map((a) =>
      h('button', {
        type: 'button',
        role: 'menuitem',
        className: a.danger ? 'menu-item danger' : 'menu-item',
        onclick: () => {
          close()
          a.run()
        },
      }, a.label),
    ),
  )
  return { el: wrap, button }
}

/** Opens and closes `items` under `button` (outside click and Escape close it). Returns `close`.
 *  `onOpen` runs once `items` shows, so it can measure it. */
function dropdown(wrap: HTMLElement, button: HTMLButtonElement, items: HTMLElement, onOpen?: () => void) {
  const onOutside = (e: PointerEvent) => {
    if (!wrap.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close()
      button.focus()
    }
  }
  function open() {
    items.hidden = false
    onOpen?.()
    button.setAttribute('aria-expanded', 'true')
    button.classList.add('active')
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('keydown', onKey, true)
  }
  function close() {
    items.hidden = true
    button.setAttribute('aria-expanded', 'false')
    button.classList.remove('active')
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onKey, true)
  }
  button.addEventListener('click', () => (items.hidden ? open() : close()))
  return close
}

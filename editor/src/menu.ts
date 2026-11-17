// The burger menu (top left) and the pages it switches between: the engine's
// tools, and the settings. The editor stays loaded underneath other pages.

import { h } from './dialog'
import { icon } from './icons'

export type Page = 'editor' | 'settings'

const PAGES: Record<Page, string> = { editor: '', settings: '#settings' }

/** The engine's tools. More will come (map editor, code…). */
const TOOLS: { page: Page; label: string }[] = [{ page: 'editor', label: 'Pixel art editor' }]

export function currentPage(): Page {
  return location.hash === PAGES.settings ? 'settings' : 'editor'
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

/** A burger button with its drop-down menu, for the start of a top bar. */
export function createMenu(): HTMLElement {
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

  const item = (page: Page, label: string) =>
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
    h('div', { className: 'menu-label' }, 'Tools'),
    ...TOOLS.map((t) => item(t.page, t.label)),
    h('hr'),
    item('settings', 'Settings'),
  )

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
    const page = currentPage()
    for (const el of items.querySelectorAll<HTMLElement>('[data-page]')) {
      const on = el.dataset.page === page
      el.classList.toggle('current', on)
      el.setAttribute('aria-checked', String(on))
    }
    items.hidden = false
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
  return wrap
}

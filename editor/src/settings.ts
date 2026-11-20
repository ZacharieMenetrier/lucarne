// The settings page (#settings): the game's own settings (game.json), and GitHub sync.

import { h } from './dialog'
import {
  REPO_RE,
  isConfigured,
  lastSyncTime,
  loadSettings,
  normalizeFolder,
  saveSettings,
  testConnection,
  type GitHubSettings,
} from './github'
import { DEFAULT_SETTINGS, SETTING_LIMITS, screenSize, settingsError, type GameSettings } from '../../runtime/game'
import { createEditorSwitch, createMenu, onPage } from './menu'
import type { Storage } from './storage'

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** The game's settings, as the page reads and writes them. */
export interface GameSettingsAccess {
  settings(): GameSettings
  /** Every map's size, in tiles. */
  maps(): { name: string; width: number; height: number }[]
  /** The tilesets' names. */
  tilesets(): string[]
  save(settings: GameSettings): Promise<void>
}

/**
 * Builds the page and adds it to the document. `onSaved` runs after the
 * GitHub settings change (the editor shows or hides its sync button).
 */
export function buildSettingsPage(storage: Storage, onSaved: () => void, game: GameSettingsAccess) {
  const gameForm = buildGameForm(game)
  const field = (props: Record<string, unknown>) =>
    h('input', { type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, ...props })

  const token = field({ type: 'password', name: 'token', placeholder: 'github_pat_…' })
  const repo = field({ name: 'repo', placeholder: 'owner/my-game' })
  const branch = field({ name: 'branch', placeholder: 'main' })
  const folder = field({ name: 'folder', placeholder: 'Repository root' })
  const status = h('p', { className: 'settings-status', role: 'status' })
  const last = h('p', { className: 'muted settings-last' })
  const save = h('button', { type: 'submit', className: 'primary' }, 'Save')
  const test = h('button', { type: 'button' }, 'Test connection')
  const remove = h('button', { type: 'button', className: 'danger' }, 'Remove token')

  const read = (): GitHubSettings => ({
    token: token.value.trim(),
    repo: repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''),
    branch: branch.value.trim() || 'main',
    folder: normalizeFolder(folder.value).replace(/\/$/, ''),
  })
  const fill = () => {
    const s = loadSettings()
    token.value = s.token
    repo.value = s.repo
    branch.value = s.branch
    folder.value = s.folder
    remove.hidden = !s.token
    const time = isConfigured(s) ? lastSyncTime(s) : 0
    last.textContent = time ? `Last sync on this device: ${new Date(time).toLocaleString()}.` : ''
  }
  const setStatus = (text: string, kind: 'ok' | 'error' | '' = '') => {
    status.textContent = text
    status.dataset.kind = kind
  }
  const check = (s: GitHubSettings) => {
    if (s.repo && !REPO_RE.test(s.repo)) return 'Repository: use the owner/name form, e.g. zac/my-game.'
    if (/\s/.test(s.branch)) return 'Branch: no spaces.'
    return null
  }

  const form = h('form', { className: 'settings-form', autocomplete: 'off' },
    h('h2', {}, 'GitHub sync'),
    h('p', { className: 'muted' },
      'Keeps the game’s palette, board and sprites in sync with a GitHub repository, so you can work on iPad and on your computer. ',
      'Sync runs when you press the sync button in the top bar.'),
    storage.kind === 'server'
      ? h('p', { className: 'settings-note' },
        'This editor is working directly on the game folder of this computer (lucarne dev). Use git there: ',
        'the sync button only shows when the editor saves to the browser’s storage, as on iPad.')
      : null,
    h('label', {}, 'Token', token,
      h('small', {},
        'A fine-grained personal access token, limited to the game’s repository, with the permission Contents: Read and write. ',
        h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Create one on GitHub'),
        '. It stays in this browser, on this device only.')),
    h('label', {}, 'Repository', repo),
    h('div', { className: 'settings-row' },
      h('label', {}, 'Branch', branch),
      h('label', {}, 'Game folder in the repository', folder)),
    h('div', { className: 'settings-actions' }, save, test, h('span', { className: 'spacer' }), remove),
    status,
    last,
  )

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const s = read()
    const err = check(s)
    if (err) return setStatus(err, 'error')
    try {
      saveSettings(s)
    } catch {
      return setStatus('Could not save: this browser blocks local storage.', 'error')
    }
    fill()
    setStatus(isConfigured(s) ? 'Saved.' : 'Saved. Fill in the token and the repository to turn sync on.', 'ok')
    onSaved()
  })
  test.addEventListener('click', async () => {
    const s = read()
    const err = check(s) ?? (isConfigured(s) ? null : 'Fill in the token and the repository first.')
    if (err) return setStatus(err, 'error')
    test.disabled = true
    setStatus('Checking…')
    try {
      setStatus(await testConnection(s), 'ok')
    } catch (e) {
      setStatus((e as Error).message, 'error')
    } finally {
      test.disabled = false
    }
  })
  remove.addEventListener('click', () => {
    saveSettings({ ...read(), token: '' })
    fill()
    setStatus('Token removed from this device.', 'ok')
    onSaved()
  })

  const page = h('div', { id: 'settings-page' },
    h('header', { className: 'page-bar' }, createMenu(), createEditorSwitch(), h('h1', {}, 'Settings')),
    h('div', { className: 'page-body' }, gameForm.el, form),
  )
  document.body.append(page)

  onPage((p) => {
    if (p !== 'settings') return
    gameForm.fill()
    fill()
    setStatus('')
  })
}

/**
 * The game's settings: its screen, in tiles, and its tile size (game.json). Maps are never
 * smaller than the screen, so the screen cannot grow beyond the smallest map; and the tile size
 * cannot change once a map exists, since every map would be cut differently.
 */
function buildGameForm(game: GameSettingsAccess) {
  const number = (name: keyof GameSettings) => {
    const { min, max } = SETTING_LIMITS[name]
    return h('input', { type: 'number', name, min, max, inputMode: 'numeric' })
  }
  const columns = number('columns')
  const rows = number('rows')
  const tileSize = number('tileSize')
  const tileNote = h('small', {})
  const pixels = h('small', {})
  /** The screen in pixels, under the fields, as they are typed. */
  const showPixels = () => {
    const s = read()
    pixels.textContent = settingsError(s) ? '' : `${screenSize(s).width} × ${screenSize(s).height} game pixels.`
  }
  const status = h('p', { className: 'settings-status', role: 'status' })
  const save = h('button', { type: 'submit', className: 'primary' }, 'Save')
  const setStatus = (text: string, kind: 'ok' | 'error' | '' = '') => {
    status.textContent = text
    status.dataset.kind = kind
  }
  const fill = () => {
    const s = game.settings()
    columns.value = String(s.columns)
    rows.value = String(s.rows)
    tileSize.value = String(s.tileSize)
    showPixels()
    // Tilesets are drawn tile by tile, 8 tiles wide, and maps are counted in tiles: once
    // either exists, another size would cut them wrong.
    const maps = game.maps().length > 0
    const tilesets = game.tilesets().length > 0
    tileSize.disabled = maps || tilesets
    tileNote.textContent = maps || tilesets
      ? `The game has ${maps ? 'maps' : 'tilesets'}: ${maps ? 'their tiles are' : 'they are drawn'} at this size, so it can no longer change.`
      : `Tilesets are cut in squares of this size (${DEFAULT_SETTINGS.tileSize} unless set).`
    setStatus('')
  }
  function read(): GameSettings {
    return { columns: Number(columns.value), rows: Number(rows.value), tileSize: Number(tileSize.value) }
  }
  const check = (s: GameSettings) => {
    const err = settingsError(s)
    if (err) return err
    const small = game.maps().filter((m) => m.width < s.columns || m.height < s.rows).map((m) => `“${m.name}”`)
    if (small.length) {
      return `A map is never smaller than the screen: make ${small.join(', ')} bigger in the world editor first.`
    }
    return null
  }
  const form = h('form', { className: 'settings-form', autocomplete: 'off' },
    h('h2', {}, 'Game'),
    h('p', { className: 'muted' }, 'What the game is, saved in game.json in the game folder.'),
    h('div', { className: 'settings-row' },
      h('label', {}, 'Columns', columns, h('small', {}, 'Of the screen, in tiles.')),
      h('label', {}, 'Rows', rows, h('small', {}, 'Every display shows exactly this much, scaled up.'))),
    pixels,
    h('label', {}, 'Tile size', tileSize, tileNote),
    h('div', { className: 'settings-actions' }, save),
    status,
  )
  form.addEventListener('input', showPixels)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const s = read()
    const err = check(s)
    if (err) return setStatus(err, 'error')
    save.disabled = true
    game.save(s).then(
      () => setStatus('Saved.', 'ok'),
      (err: Error) => setStatus(`Could not save: ${err.message}`, 'error'),
    ).finally(() => (save.disabled = false))
  })
  return { el: form, fill }
}

// Syncing the game's editor files with a GitHub repository, through the
// GitHub REST API (no git on the device). Used on iPad, where the editor works
// from the browser's private storage.
//
// Sync is a three-way comparison per file: this device, GitHub, and the last
// synced version (its git blob hash, remembered on the device). A file changed
// on one side only follows that side; changed on both, the user picks.

import type { Storage } from './storage'

export interface GitHubSettings {
  token: string
  /** "owner/name" */
  repo: string
  branch: string
  /** Folder of the game inside the repository, "" for the root. */
  folder: string
}

const SETTINGS_KEY = 'lucarne.github'
const BASE_KEY = 'lucarne.github-sync'
const API = 'https://api.github.com'

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function loadSettings(): GitHubSettings {
  const empty: GitHubSettings = { token: '', repo: '', branch: 'main', folder: '' }
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<GitHubSettings> | null
    return { ...empty, ...raw }
  } catch {
    return empty
  }
}

export function saveSettings(s: GitHubSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function isConfigured(s: GitHubSettings) {
  return s.token !== '' && REPO_RE.test(s.repo) && s.branch !== ''
}

/** "art/game/" from " /art/game/ ", "" for the root. */
export function normalizeFolder(folder: string) {
  const parts = folder.split('/').map((p) => p.trim()).filter((p) => p !== '')
  return parts.length ? parts.join('/') + '/' : ''
}

/** The files the editor reads and writes, plus game.js (the code it plays): the only ones that sync. */
export function isEditorFile(path: string) {
  return (
    path === 'game.json' ||
    path === 'palette.json' ||
    path === 'board.json' ||
    path === 'game.js' ||
    /^sprites\/[^/]+\.(png|json)$/.test(path) ||
    /^tiles\/[^/]+\.(png|json)$/.test(path) ||
    /^maps\/[^/]+\.json$/.test(path) ||
    /^fonts\/[^/]+\.(png|license\.txt)$/.test(path) ||
    /^instruments\/[^/]+\.(wav|json|license\.txt)$/.test(path) ||
    /^songs\/[^/]+\.json$/.test(path) ||
    /^sounds\/[^/]+\.json$/.test(path)
  )
}

/** Files that belong together: a sprite's (a tileset's, a font's, an instrument's) files are one choice in a conflict. */
export function groupOf(path: string) {
  const m = /^(sprites|tiles|fonts|instruments)\/(.+?)\.(png|wav|json|license\.txt)$/.exec(path)
  return m ? `${m[1]}/${m[2]}` : path
}

// ---------------------------------------------------------------------------
// Three-way comparison

export type Change = 'same' | 'pull' | 'push' | 'conflict'

/** Hashes (null: no file) on this device, on GitHub, and at the last sync. */
export function classify(local: string | null, remote: string | null, base: string | null): Change {
  if (local === remote) return 'same'
  if (local === base) return 'pull'
  if (remote === base) return 'push'
  return 'conflict'
}

// ---------------------------------------------------------------------------
// Last synced state, per target (repository, branch, folder)

interface SyncBase {
  target: string
  files: Record<string, string>
  time: number
}

function targetOf(s: GitHubSettings) {
  return `${s.repo.toLowerCase()}#${s.branch}#${normalizeFolder(s.folder)}`
}

function loadBase(s: GitHubSettings): SyncBase {
  const target = targetOf(s)
  try {
    const raw = JSON.parse(localStorage.getItem(BASE_KEY) ?? 'null') as SyncBase | null
    if (raw && raw.target === target) return raw
  } catch {}
  return { target, files: {}, time: 0 }
}

function saveBase(base: SyncBase) {
  localStorage.setItem(BASE_KEY, JSON.stringify(base))
}

/** When this device last synced with the configured target (0: never). */
export function lastSyncTime(s: GitHubSettings) {
  return loadBase(s).time
}

// ---------------------------------------------------------------------------
// GitHub API

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function api<T>(s: GitHubSettings, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${s.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new GitHubError('Could not reach GitHub. Check the connection.', 0)
  }
  if (!res.ok) {
    let message = ''
    try {
      message = ((await res.json()) as { message?: string }).message ?? ''
    } catch {}
    if (res.status === 401) throw new GitHubError('GitHub refused the token (expired or wrong).', 401)
    throw new GitHubError(message || `GitHub error ${res.status}`, res.status)
  }
  return (await res.json()) as T
}

const repoPath = (s: GitHubSettings) => `/repos/${s.repo}`
const branchRef = (s: GitHubSettings) => s.branch.split('/').map(encodeURIComponent).join('/')

/** Checks the token, the repository and the branch. Resolves with a short report. */
export async function testConnection(s: GitHubSettings): Promise<string> {
  let repo: { full_name: string; permissions?: { push?: boolean } }
  try {
    repo = await api(s, 'GET', repoPath(s))
  } catch (err) {
    if ((err as GitHubError).status === 404) {
      throw new GitHubError(`Repository ${s.repo} not found, or the token has no access to it.`, 404)
    }
    throw err
  }
  if (!repo.permissions?.push) {
    throw new GitHubError(`The token can read ${repo.full_name} but not write to it. Give it Contents: Read and write.`, 403)
  }
  try {
    await api(s, 'GET', `${repoPath(s)}/branches/${branchRef(s)}`)
  } catch (err) {
    if ((err as GitHubError).status === 404) throw new GitHubError(`Branch “${s.branch}” not found in ${repo.full_name}.`, 404)
    throw err
  }
  return `Connected to ${repo.full_name}, branch ${s.branch}.`
}

// ---------------------------------------------------------------------------
// Sync

export type Side = 'local' | 'remote'

export interface Conflict {
  /** "palette.json", "board.json" or "sprites/<name>". */
  group: string
  /** The conflicting files of the group, with their state on each side. */
  files: { path: string; local: boolean; remote: boolean; base: boolean }[]
}

export interface SyncResult {
  pulled: number
  pushed: number
}

interface Plan {
  path: string
  local: string | null
  remote: string | null
  base: string | null
  change: Change
}

/**
 * Syncs the editor files. `resolve` is asked to pick a side for each
 * conflicting group; it resolves with null to cancel the sync.
 */
export async function syncWithGitHub(
  storage: Storage,
  s: GitHubSettings,
  resolve: (conflicts: Conflict[]) => Promise<Map<string, Side> | null>,
  progress: (message: string) => void,
): Promise<SyncResult | null> {
  const prefix = normalizeFolder(s.folder)
  const base = loadBase(s)

  // GitHub's side.
  progress('Reading GitHub…')
  let ref: { object: { sha: string } }
  try {
    ref = await api(s, 'GET', `${repoPath(s)}/git/ref/heads/${branchRef(s)}`)
  } catch (err) {
    const status = (err as GitHubError).status
    if (status === 409) throw new GitHubError('The repository is empty. Add a first file on GitHub (a README is enough), then sync again.', 409)
    if (status === 404) throw new GitHubError(`Branch “${s.branch}” not found in ${s.repo}, or the token has no access to it.`, 404)
    throw err
  }
  const commitSha = ref.object.sha
  const commit = await api<{ tree: { sha: string } }>(s, 'GET', `${repoPath(s)}/git/commits/${commitSha}`)
  const tree = await api<{ truncated: boolean; tree: { path: string; type: string; sha: string }[] }>(
    s, 'GET', `${repoPath(s)}/git/trees/${commit.tree.sha}?recursive=1`,
  )
  if (tree.truncated) throw new GitHubError('The repository is too large to read in one go.', 0)
  const remote = new Map<string, string>()
  for (const e of tree.tree) {
    if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue
    const rel = e.path.slice(prefix.length)
    if (isEditorFile(rel)) remote.set(rel, e.sha)
  }

  // This device's side.
  progress('Reading this device…')
  const local = new Map<string, string>()
  const contents = new Map<string, Uint8Array>()
  const localPaths = [
    ...(await storage.list('')),
    ...(await storage.list('sprites')).map((n) => `sprites/${n}`),
    ...(await storage.list('fonts')).map((n) => `fonts/${n}`),
    ...(await storage.list('tiles')).map((n) => `tiles/${n}`),
    ...(await storage.list('maps')).map((n) => `maps/${n}`),
    ...(await storage.list('instruments')).map((n) => `instruments/${n}`),
    ...(await storage.list('songs')).map((n) => `songs/${n}`),
    ...(await storage.list('sounds')).map((n) => `sounds/${n}`),
  ].filter(isEditorFile)
  for (const path of localPaths) {
    const data = await storage.read(path)
    if (!data) continue
    contents.set(path, data)
    local.set(path, await gitBlobSha(data))
  }

  // Compare.
  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(base.files)])
  const plans: Plan[] = [...paths].sort().map((path) => {
    const l = local.get(path) ?? null
    const r = remote.get(path) ?? null
    const b = base.files[path] ?? null
    return { path, local: l, remote: r, base: b, change: classify(l, r, b) }
  })

  // Conflicts: one choice per group, applied to every differing file of the group
  // (a sprite's PNG and JSON must come from the same side).
  const conflictGroups = new Map<string, Conflict>()
  for (const p of plans) {
    if (p.change !== 'conflict') continue
    const group = groupOf(p.path)
    const c = conflictGroups.get(group) ?? { group, files: [] }
    c.files.push({ path: p.path, local: p.local !== null, remote: p.remote !== null, base: p.base !== null })
    conflictGroups.set(group, c)
  }
  if (conflictGroups.size) {
    const choices = await resolve([...conflictGroups.values()])
    if (!choices) return null
    for (const p of plans) {
      const side = choices.get(groupOf(p.path))
      if (side && p.change !== 'same') p.change = side === 'local' ? 'push' : 'pull'
    }
  }

  const files = { ...base.files }
  const record = (path: string, sha: string | null) => {
    if (sha) files[path] = sha
    else delete files[path]
  }
  for (const p of plans) if (p.change === 'same') record(p.path, p.local)

  // Pull: GitHub → this device.
  const pulls = plans.filter((p) => p.change === 'pull')
  let done = 0
  for (const p of pulls) {
    progress(`Downloading ${++done}/${pulls.length}…`)
    if (p.remote === null) await storage.remove(p.path)
    else {
      const blob = await api<{ content: string; encoding: string }>(s, 'GET', `${repoPath(s)}/git/blobs/${p.remote}`)
      await storage.write(p.path, fromBase64(blob.content))
    }
    record(p.path, p.remote)
  }
  saveBase({ target: base.target, files, time: base.time })

  // Push: this device → GitHub, as one commit.
  const pushes = plans.filter((p) => p.change === 'push')
  if (pushes.length) {
    const entries: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
    done = 0
    for (const p of pushes) {
      progress(`Uploading ${++done}/${pushes.length}…`)
      let sha: string | null = null
      if (p.local !== null) {
        const blob = await api<{ sha: string }>(s, 'POST', `${repoPath(s)}/git/blobs`, {
          content: toBase64(contents.get(p.path)!),
          encoding: 'base64',
        })
        sha = blob.sha
      }
      entries.push({ path: prefix + p.path, mode: '100644', type: 'blob', sha })
    }
    progress('Creating the commit…')
    const newTree = await api<{ sha: string }>(s, 'POST', `${repoPath(s)}/git/trees`, { base_tree: commit.tree.sha, tree: entries })
    const newCommit = await api<{ sha: string }>(s, 'POST', `${repoPath(s)}/git/commits`, {
      message: commitMessage(pushes),
      tree: newTree.sha,
      parents: [commitSha],
    })
    try {
      await api(s, 'PATCH', `${repoPath(s)}/git/refs/heads/${branchRef(s)}`, { sha: newCommit.sha, force: false })
    } catch (err) {
      if ((err as GitHubError).status === 422) throw new GitHubError('GitHub changed during the sync. Sync again.', 422)
      throw err
    }
    for (const p of pushes) record(p.path, p.local)
  }
  saveBase({ target: base.target, files, time: Date.now() })
  return { pulled: pulls.length, pushed: pushes.length }
}

function commitMessage(pushes: Plan[]) {
  const groups = [...new Set(pushes.map((p) => groupOf(p.path)))]
  const names = groups.map((g) => g.replace(/^sprites\//, '').replace(/\.json$/, ''))
  const summary = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return `Update ${summary} from the Lucarne editor`
}

// ---------------------------------------------------------------------------
// Encoding

/** The hash git gives a file's content (what GitHub reports for each file). */
export async function gitBlobSha(data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${data.length}\0`)
  const buf = new Uint8Array(header.length + data.length)
  buf.set(header)
  buf.set(data, header.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function toBase64(data: Uint8Array) {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(text: string) {
  const s = atob(text.replace(/\s/g, ''))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

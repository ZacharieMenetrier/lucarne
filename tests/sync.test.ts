import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classify,
  fromBase64,
  gitBlobSha,
  groupOf,
  isEditorFile,
  normalizeFolder,
  saveSettings,
  syncWithGitHub,
  toBase64,
  type GitHubSettings,
  type Side,
} from '../editor/src/github'
import type { Storage } from '../editor/src/storage'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('sync helpers', () => {
  it('classifies three-way changes', () => {
    expect(classify('a', 'a', null)).toBe('same')
    expect(classify('a', 'b', 'a')).toBe('pull')
    expect(classify(null, 'b', null)).toBe('pull')
    expect(classify('b', 'a', 'a')).toBe('push')
    expect(classify(null, 'a', 'a')).toBe('push')
    expect(classify('b', 'c', 'a')).toBe('conflict')
    expect(classify('b', 'c', null)).toBe('conflict')
  })

  it('knows the editor files and their groups', () => {
    expect(isEditorFile('palette.json')).toBe(true)
    expect(isEditorFile('sprites/hero.png')).toBe(true)
    expect(isEditorFile('sprites/a/b.png')).toBe(false)
    expect(isEditorFile('README.md')).toBe(false)
    expect(isEditorFile('game.json')).toBe(true)
    expect(isEditorFile('tiles/outdoor.png')).toBe(true)
    expect(isEditorFile('maps/town.json')).toBe(true)
    expect(isEditorFile('tiles/outdoor.json')).toBe(true)
    expect(groupOf('sprites/hero.json')).toBe('sprites/hero')
    expect(groupOf('tiles/outdoor.json')).toBe('tiles/outdoor')
    expect(groupOf('board.json')).toBe('board.json')
  })

  it('normalizes the folder', () => {
    expect(normalizeFolder('')).toBe('')
    expect(normalizeFolder(' /games/demo/ ')).toBe('games/demo/')
  })

  it('hashes like git', async () => {
    expect(await gitBlobSha(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(await gitBlobSha(enc.encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('round-trips base64', () => {
    const data = new Uint8Array(70000).map((_, i) => i * 7)
    expect(fromBase64(toBase64(data))).toEqual(data)
  })
})

// ---------------------------------------------------------------------------
// A fake GitHub (git data API only) and a storage in memory.

class FakeGitHub {
  blobs = new Map<string, string>()
  trees = new Map<string, Map<string, string>>()
  commits = new Map<string, string>()
  head = ''
  private n = 0
  commitsMade = 0

  async init(files: Record<string, string>) {
    const tree = new Map<string, string>()
    for (const [path, text] of Object.entries(files)) tree.set(path, await this.addBlob(enc.encode(text)))
    this.head = this.addCommit(this.addTree(tree))
  }

  async addBlob(data: Uint8Array) {
    const sha = await gitBlobSha(data)
    this.blobs.set(sha, toBase64(data))
    return sha
  }
  addTree(tree: Map<string, string>) {
    const sha = `tree${this.n++}`
    this.trees.set(sha, tree)
    return sha
  }
  addCommit(tree: string) {
    const sha = `commit${this.n++}`
    this.commits.set(sha, tree)
    return sha
  }
  files() {
    const out: Record<string, string> = {}
    for (const [path, sha] of this.trees.get(this.commits.get(this.head)!)!) out[path] = dec.decode(fromBase64(this.blobs.get(sha)!))
    return out
  }
  async edit(files: Record<string, string | null>) {
    const tree = new Map(this.trees.get(this.commits.get(this.head)!)!)
    for (const [path, text] of Object.entries(files)) {
      if (text === null) tree.delete(path)
      else tree.set(path, await this.addBlob(enc.encode(text)))
    }
    this.head = this.addCommit(this.addTree(tree))
  }

  fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const path = url.pathname.replace('/repos/me/game', '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : null
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    let m: RegExpExecArray | null
    if (method === 'GET' && path === '/git/ref/heads/main') return json({ object: { sha: this.head } })
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(path))) return json({ tree: { sha: this.commits.get(m[1]) } })
    if (method === 'GET' && (m = /^\/git\/trees\/(\w+)$/.exec(path))) {
      const tree = [...this.trees.get(m[1])!].map(([p, sha]) => ({ path: p, type: 'blob', sha }))
      return json({ truncated: false, tree })
    }
    if (method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(path))) return json({ content: this.blobs.get(m[1]), encoding: 'base64' })
    if (method === 'POST' && path === '/git/blobs') return json({ sha: await this.addBlob(fromBase64(body.content)) })
    if (method === 'POST' && path === '/git/trees') {
      const tree = new Map(this.trees.get(body.base_tree)!)
      for (const e of body.tree) {
        if (e.sha === null) tree.delete(e.path)
        else tree.set(e.path, e.sha)
      }
      return json({ sha: this.addTree(tree) })
    }
    if (method === 'POST' && path === '/git/commits') {
      expect(body.parents).toEqual([this.head])
      return json({ sha: this.addCommit(body.tree) })
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      this.head = body.sha
      this.commitsMade++
      return json({})
    }
    return json({ message: `Unexpected ${method} ${path}` }, 500)
  }
}

class MemoryStorage implements Storage {
  readonly kind = 'opfs'
  readonly label = 'memory'
  files = new Map<string, Uint8Array>()
  constructor(files: Record<string, string> = {}) {
    for (const [p, t] of Object.entries(files)) this.files.set(p, enc.encode(t))
  }
  async read(path: string) {
    return this.files.get(path) ?? null
  }
  async write(path: string, data: Uint8Array) {
    this.files.set(path, data)
  }
  async list(dir: string) {
    const prefix = dir ? `${dir}/` : ''
    return [...this.files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length))
  }
  async remove(path: string) {
    this.files.delete(path)
  }
  text() {
    return Object.fromEntries([...this.files].map(([p, d]) => [p, dec.decode(d)]))
  }
}

describe('sync with GitHub', () => {
  const settings: GitHubSettings = { token: 't', repo: 'me/game', branch: 'main', folder: 'game' }
  let gh: FakeGitHub
  const noConflicts = async () => {
    throw new Error('no conflict expected')
  }
  const run = (storage: Storage, resolve: (c: unknown[]) => Promise<Map<string, Side> | null> = noConflicts) =>
    syncWithGitHub(storage, settings, resolve, () => {})

  beforeEach(async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    })
    gh = new FakeGitHub()
    vi.stubGlobal('fetch', gh.fetch)
    saveSettings(settings)
    await gh.init({ 'README.md': 'hi', 'game/palette.json': 'P1', 'game/sprites/hero.png': 'H1', 'game/sprites/hero.json': 'J1' })
  })

  it('pulls into an empty device, then pushes local edits as one commit', async () => {
    const device = new MemoryStorage()
    expect(await run(device)).toEqual({ pulled: 3, pushed: 0 })
    expect(device.text()).toEqual({ 'palette.json': 'P1', 'sprites/hero.png': 'H1', 'sprites/hero.json': 'J1' })

    await device.write('sprites/hero.png', enc.encode('H2'))
    await device.write('board.json', enc.encode('B1'))
    await device.remove('palette.json')
    expect(await run(device)).toEqual({ pulled: 0, pushed: 3 })
    expect(gh.commitsMade).toBe(1)
    expect(gh.files()).toEqual({ 'README.md': 'hi', 'game/sprites/hero.png': 'H2', 'game/sprites/hero.json': 'J1', 'game/board.json': 'B1' })

    expect(await run(device)).toEqual({ pulled: 0, pushed: 0 })
  })

  it('merges changes made on both sides to different files', async () => {
    const device = new MemoryStorage()
    await run(device)
    await gh.edit({ 'game/palette.json': 'P2', 'game/sprites/hero.json': null })
    await device.write('sprites/villain.png', enc.encode('V1'))
    expect(await run(device)).toEqual({ pulled: 2, pushed: 1 })
    expect(device.text()).toEqual({ 'palette.json': 'P2', 'sprites/hero.png': 'H1', 'sprites/villain.png': 'V1' })
    expect(gh.files()['game/sprites/villain.png']).toBe('V1')
  })

  it('asks once per sprite on a conflict, and applies the choice to both its files', async () => {
    const device = new MemoryStorage()
    await run(device)
    await gh.edit({ 'game/sprites/hero.png': 'H-remote' })
    await device.write('sprites/hero.png', enc.encode('H-local'))
    await device.write('sprites/hero.json', enc.encode('J-local'))

    const asked: unknown[] = []
    const result = await run(device, async (conflicts) => {
      asked.push(...conflicts)
      return new Map([['sprites/hero', 'remote' as Side]])
    })
    expect(asked).toEqual([{ group: 'sprites/hero', files: [{ path: 'sprites/hero.png', local: true, remote: true, base: true }] }])
    expect(result).toEqual({ pulled: 2, pushed: 0 })
    expect(device.text()['sprites/hero.png']).toBe('H-remote')
    expect(device.text()['sprites/hero.json']).toBe('J1')
  })

  it('cancels without touching anything', async () => {
    const device = new MemoryStorage({ 'palette.json': 'P-local' })
    expect(await run(device, async () => null)).toBeNull()
    expect(device.text()).toEqual({ 'palette.json': 'P-local' })
    expect(gh.commitsMade).toBe(0)
  })
})

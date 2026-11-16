// The game's working copy, seen as a small file system.
//
// - On Mac: the local server (`lucarne dev`) reads and writes the real folder.
// - On iPad (or without a server): the browser's private file system (OPFS).
//
// Paths are relative to the game root, separated by "/": "sprites/hero.png".

export interface Storage {
  readonly kind: 'server' | 'opfs'
  /** Name shown in the interface. */
  readonly label: string
  read(path: string): Promise<Uint8Array | null>
  write(path: string, data: Uint8Array): Promise<void>
  /** Names of the files (not folders) directly inside `dir`. */
  list(dir: string): Promise<string[]>
  remove(path: string): Promise<void>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function readText(storage: Storage, path: string): Promise<string | null> {
  const data = await storage.read(path)
  return data ? decoder.decode(data) : null
}

export function writeText(storage: Storage, path: string, text: string): Promise<void> {
  return storage.write(path, encoder.encode(text))
}

export function splitPath(path: string): string[] {
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`Invalid path: ${path}`)
  }
  return parts
}

// ---------------------------------------------------------------------------
// Local server

class ServerStorage implements Storage {
  readonly kind = 'server'
  constructor(readonly label: string) {}

  private url(route: string, key: string, value: string) {
    return `/__lucarne/${route}?${key}=${encodeURIComponent(value)}`
  }

  async read(path: string) {
    const res = await fetch(this.url('fs', 'path', path), { cache: 'no-store' })
    if (res.status === 404) return null
    await check(res)
    return new Uint8Array(await res.arrayBuffer())
  }

  async write(path: string, data: Uint8Array) {
    const res = await fetch(this.url('fs', 'path', path), {
      method: 'PUT',
      body: data as BodyInit,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    await check(res)
  }

  async list(dir: string) {
    const res = await fetch(this.url('list', 'dir', dir), { cache: 'no-store' })
    await check(res)
    return (await res.json()) as string[]
  }

  async remove(path: string) {
    await check(await fetch(this.url('fs', 'path', path), { method: 'DELETE' }))
  }
}

async function check(res: Response) {
  if (!res.ok) throw new Error((await res.text()) || `Error ${res.status}`)
}

// ---------------------------------------------------------------------------
// OPFS (the browser's private file system)

class OpfsStorage implements Storage {
  readonly kind = 'opfs'
  readonly label = 'Browser (offline)'

  constructor(
    private readonly projectDir: string,
    private readonly root: FileSystemDirectoryHandle,
  ) {}

  static async open(projectDir: string) {
    const opfs = await navigator.storage.getDirectory()
    const root = await opfs.getDirectoryHandle(projectDir, { create: true })
    // Asks the browser not to evict this data.
    navigator.storage.persist?.().catch(() => {})
    return new OpfsStorage(projectDir, root)
  }

  private async dir(parts: string[], create: boolean) {
    let dir = this.root
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create })
    return dir
  }

  async read(path: string) {
    const parts = splitPath(path)
    try {
      const dir = await this.dir(parts.slice(0, -1), false)
      const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async write(path: string, data: Uint8Array) {
    const parts = splitPath(path)
    const dir = await this.dir(parts.slice(0, -1), true)
    const handle = await dir.getFileHandle(parts.at(-1)!, { create: true })
    if ('createWritable' in handle) {
      const writable = await handle.createWritable()
      await writable.write(data as FileSystemWriteChunkType)
      await writable.close()
    } else {
      // Older Safari: writing is only available inside a worker.
      await workerWrite(this.projectDir, path, data)
    }
  }

  async list(dirPath: string) {
    try {
      const dir = await this.dir(dirPath === '' ? [] : splitPath(dirPath), false)
      const names: string[] = []
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') names.push(name)
      }
      return names.sort()
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }

  async remove(path: string) {
    const parts = splitPath(path)
    try {
      const dir = await this.dir(parts.slice(0, -1), false)
      await dir.removeEntry(parts.at(-1)!)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }
}

function isNotFound(err: unknown) {
  return err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')
}

const WORKER_SOURCE = `
onmessage = async (e) => {
  const { id, projectDir, parts, data } = e.data
  try {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(projectDir, { create: true })
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
    const file = await dir.getFileHandle(parts[parts.length - 1], { create: true })
    const access = await file.createSyncAccessHandle()
    access.truncate(0)
    access.write(data, { at: 0 })
    access.flush()
    access.close()
    postMessage({ id })
  } catch (err) {
    postMessage({ id, error: String(err) })
  }
}`

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

function workerWrite(projectDir: string, path: string, data: Uint8Array): Promise<void> {
  if (!worker) {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })))
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
      const p = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (e.data.error) p?.reject(new Error(e.data.error))
      else p?.resolve()
    }
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ id, projectDir, parts: splitPath(path), data })
  })
}

// ---------------------------------------------------------------------------

/**
 * Picks the storage: the local server if it answers, otherwise OPFS.
 * `?storage=opfs` in the URL forces OPFS (handy for testing on Mac).
 */
export async function openStorage(): Promise<Storage> {
  const forced = new URLSearchParams(location.search).get('storage')
  if (forced !== 'opfs') {
    try {
      const res = await fetch('/__lucarne/info', { cache: 'no-store' })
      if (res.ok && res.headers.get('Content-Type')?.includes('json')) {
        const info = (await res.json()) as { name: string }
        return new ServerStorage(info.name)
      }
    } catch {
      // No server: fall back to OPFS.
    }
  }
  if (!window.isSecureContext || !navigator.storage?.getDirectory) {
    throw new Error(
      'This browser does not allow local storage. Open the editor over HTTPS or on localhost.',
    )
  }
  return OpfsStorage.open('game')
}

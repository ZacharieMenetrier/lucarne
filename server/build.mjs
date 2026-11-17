// Builds the game's code: code/main.ts (TypeScript) → game.js (JavaScript), in the game folder.
//
// The browser cannot run TypeScript. On Mac, `lucarne dev` rebuilds game.js whenever a
// file in code/ changes; game.js is committed with the game, and the iPad, which has no
// server, plays that file.
//
// game.js contains only the game's code. `import … from 'lucarne'` reads the engine the
// editor provides when it starts the game (globalThis.__lucarne), so a game always runs
// on the engine of the editor that plays it.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { rolldown } from 'rolldown'

export const ENTRY = 'code/main.ts'
export const OUTPUT = 'game.js'

const HEADER = `// Built by \`lucarne dev\` from code/. Do not edit: changes are overwritten.\n`

const engineGlobal = {
  name: 'lucarne-engine',
  resolveId(id) {
    if (id === 'lucarne') return '\0lucarne'
  },
  load(id) {
    if (id === '\0lucarne') return 'module.exports = globalThis.__lucarne'
  },
}

/**
 * @param {string} gameDir
 * @param {{ info(msg: string): void, error(msg: string): void }} logger
 */
export function gameBuilder(gameDir, logger) {
  let running = null
  let again = false
  let lastError = null

  async function buildOnce() {
    const entry = path.join(gameDir, ENTRY)
    if (!fs.existsSync(entry)) return { ok: false, missing: true, error: `No ${ENTRY} in the game folder.` }
    try {
      const bundle = await rolldown({
        input: entry,
        cwd: gameDir,
        plugins: [engineGlobal],
        logLevel: 'silent',
        platform: 'browser',
      })
      try {
        const { output } = await bundle.generate({ format: 'esm', sourcemap: false })
        const code = HEADER + output[0].code
        const out = path.join(gameDir, OUTPUT)
        const previous = await fsp.readFile(out, 'utf8').catch(() => null)
        // Same content: leave the file alone (no needless change for git).
        if (previous !== code) {
          const tmp = path.join(gameDir, `.${OUTPUT}.${process.pid}.tmp`)
          await fsp.writeFile(tmp, code)
          await fsp.rename(tmp, out)
          logger.info(`[lucarne] ${OUTPUT} rebuilt`)
        }
      } finally {
        await bundle.close()
      }
      if (lastError) logger.info(`[lucarne] game code fixed`)
      lastError = null
      return { ok: true }
    } catch (err) {
      const error = cleanError(err, gameDir)
      if (error !== lastError) logger.error(`[lucarne] the game's code does not build:\n${error}`)
      lastError = error
      return { ok: false, error }
    }
  }

  /** Builds now; if a build is already running, waits for it and builds again after. */
  function build() {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      let result
      do {
        again = false
        result = await buildOnce()
      } while (again)
      running = null
      return result
    })()
    return running
  }

  /** Rebuilds when a file in code/ changes. Returns a function that stops watching. */
  function watch() {
    let timer = null
    let watcher
    try {
      watcher = fs.watch(gameDir, { recursive: true }, (_event, file) => {
        if (!file) return
        const rel = String(file).split(path.sep).join('/')
        if (!rel.startsWith('code/')) return
        clearTimeout(timer)
        timer = setTimeout(() => void build(), 80)
      })
    } catch (err) {
      logger.error(`[lucarne] cannot watch code/: ${err.message}`)
      return () => {}
    }
    return () => {
      clearTimeout(timer)
      watcher.close()
    }
  }

  return { build, watch }
}

function cleanError(err, gameDir) {
  return String(err?.message ?? err)
    .replace(/\x1b\[[0-9;]*m/g, '') // terminal colors
    .replace(/^Build failed with \d+ errors?:\s*/, '')
    .split(gameDir + path.sep)
    .join('')
    .trim()
}

// Builds the game's code: actors/*.ts and code/main.ts (TypeScript) → game.js (JavaScript),
// in the game folder.
//
// The browser cannot run TypeScript. On Mac, `lucarne dev` rebuilds game.js whenever a
// TypeScript file in actors/ or code/ changes; game.js is committed with the game, and the
// iPad, which has no server, plays that file.
//
// The entry is made here, not written by the game: it registers every actors/<name>.ts by
// its file name, then runs code/main.ts (optional: a game can be only actors on maps) and
// exports its game. Registering comes first so that the actors main.ts spawns at its top
// level already know their actor files (see "Actor files" in runtime/world.ts).
//
// game.js contains only the game's code. `import … from 'lucarne'` reads the engine the
// editor provides when it starts the game (globalThis.__lucarne), so a game always runs
// on the engine of the editor that plays it.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { rolldown } from 'rolldown'

export const MAIN = 'code/main.ts'
export const ACTORS = 'actors'
export const OUTPUT = 'game.js'
/** An actor's name: its file's, as maps place it (the same rule as sprites and maps). */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

const HEADER = `// Built by \`lucarne dev\` from actors/ and code/. Do not edit: changes are overwritten.\n`

const engineGlobal = {
  name: 'lucarne-engine',
  resolveId(id) {
    if (id === 'lucarne') return '\0lucarne'
  },
  load(id) {
    if (id === '\0lucarne') return 'module.exports = globalThis.__lucarne'
  },
}

/** The two modules game.js starts from: they exist only in the build. */
const ENTRY_ID = '\0lucarne-entry'
const REGISTER_ID = '\0lucarne-actors'

/** The actor files' names (actors/<name>.ts), sorted; throws on a name maps could not use. */
function actorNames(gameDir) {
  const dir = path.join(gameDir, ACTORS)
  if (!fs.existsSync(dir)) return []
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((f) => f.slice(0, -3)).sort()
  for (const n of names) {
    if (!NAME_RE.test(n)) throw new Error(`${ACTORS}/${n}.ts: an actor's file name is lowercase letters, digits, - and _ (it is the name maps place it by).`)
  }
  return names
}

/** The entry: registers the actors, then exports code/main.ts's game (or none). */
function gameEntry(gameDir, names) {
  const main = path.join(gameDir, MAIN)
  return {
    name: 'lucarne-entry',
    resolveId(id) {
      if (id === ENTRY_ID || id === REGISTER_ID) return id
    },
    load(id) {
      if (id === ENTRY_ID) {
        // Two modules, because imports run before the body of the module that holds them:
        // the registering module runs whole before main.ts starts.
        const game = fs.existsSync(main) ? `export { default } from ${JSON.stringify(main)}` : 'export default {}'
        return `import ${JSON.stringify(REGISTER_ID)}\n${game}\n`
      }
      if (id === REGISTER_ID) {
        const imports = names.map((n, i) => `import a${i} from ${JSON.stringify(path.join(gameDir, ACTORS, `${n}.ts`))}`)
        const found = names.map((n, i) => `${JSON.stringify(n)}: a${i}`).join(', ')
        return `import { registerActors } from 'lucarne'\n${imports.join('\n')}\nregisterActors({ ${found} })\n`
      }
    },
  }
}

/** Is it a file the game's code is built from? */
function isCodeFile(rel) {
  return rel.startsWith('code/') || (rel.startsWith(`${ACTORS}/`) && rel.endsWith('.ts'))
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
    try {
      const names = actorNames(gameDir)
      if (!names.length && !fs.existsSync(path.join(gameDir, MAIN))) {
        return { ok: false, missing: true, error: `No ${ACTORS}/*.ts nor ${MAIN} in the game folder.` }
      }
      const bundle = await rolldown({
        input: ENTRY_ID,
        cwd: gameDir,
        plugins: [engineGlobal, gameEntry(gameDir, names)],
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

  /** Rebuilds when a code file changes (or comes, or goes). Returns a function that stops watching. */
  function watch() {
    let timer = null
    let watcher
    try {
      watcher = fs.watch(gameDir, { recursive: true }, (_event, file) => {
        if (!file) return
        const rel = String(file).split(path.sep).join('/')
        if (!isCodeFile(rel)) return
        clearTimeout(timer)
        timer = setTimeout(() => void build(), 80)
      })
    } catch (err) {
      logger.error(`[lucarne] cannot watch the game's code: ${err.message}`)
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

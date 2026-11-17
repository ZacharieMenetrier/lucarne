#!/usr/bin/env node
// lucarne dev [folder] [--port 5173] [--host] [--no-open]
//
// Opens the editor on the game folder (the current folder by default).
// --host makes the editor reachable on the local network (to test on iPad).
// On macOS the editor opens in the Lucarne web app (Safari > File > Add to Dock)
// when it is installed, in Safari otherwise. --no-open skips that.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { lucarneFs } from '../server/fs-plugin.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const editorRoot = path.resolve(here, '../editor')

const args = process.argv.slice(2)
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'dev'

if (command !== 'dev') {
  console.log('Usage: lucarne dev [game-folder] [--port 5173] [--host] [--no-open]')
  process.exit(command === 'help' || command === '--help' ? 0 : 1)
}

let dir = '.'
let port = 5173
let host = false
let open = true
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--host') host = true
  else if (a === '--no-open') open = false
  else if (a === '--port') port = Number(args[++i])
  else dir = a
}

const gameDir = path.resolve(dir)
const engineRoot = path.resolve(here, '..')
if (gameDir === engineRoot || gameDir.startsWith(engineRoot + path.sep)) {
  console.error('The game folder must be outside the Lucarne repo, e.g. `npm run dev -- ../my-game`.')
  process.exit(1)
}
await fs.mkdir(gameDir, { recursive: true })

const server = await createServer({
  configFile: false,
  root: editorRoot,
  plugins: [lucarneFs(gameDir)],
  // The installed web app is tied to this exact origin, so never drift to another port.
  server: { port, host, strictPort: true },
})
try {
  await server.listen()
} catch (err) {
  if (err.code !== 'EADDRINUSE' && !/already in use/.test(err.message)) throw err
  console.error(`Port ${port} is already in use (another \`lucarne dev\`?). Stop it or pass --port.`)
  process.exit(1)
}
console.log(`\n  Lucarne — game folder: ${gameDir}`)
server.printUrls()
if (open) openEditor(`http://localhost:${port}/`)

function openEditor(url) {
  if (process.platform !== 'darwin') return server.openBrowser()
  const webApp = path.join(os.homedir(), 'Applications', 'Lucarne.app')
  fs.access(webApp).then(
    () => {
      execFile('open', ['-a', webApp])
      // Quit the web app with the server, so its window and Dock icon go away too.
      const quit = () => execFile('osascript', ['-e', 'quit app "Lucarne"'], () => process.exit(0))
      process.once('SIGINT', quit)
      process.once('SIGTERM', quit)
    },
    () => {
      execFile('open', ['-a', 'Safari', url])
      console.log('  Tip: Safari > File > Add to Dock installs Lucarne as an app; it opens there next time.\n')
    },
  )
}

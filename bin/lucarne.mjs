#!/usr/bin/env node
// lucarne dev [folder] [--port 5173] [--host]
//
// Opens the editor on the game folder (the current folder by default).
// --host makes the editor reachable on the local network (to test on iPad).

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { lucarneFs } from '../server/fs-plugin.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const editorRoot = path.resolve(here, '../editor')

const args = process.argv.slice(2)
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'dev'

if (command !== 'dev') {
  console.log('Usage: lucarne dev [game-folder] [--port 5173] [--host]')
  process.exit(command === 'help' || command === '--help' ? 0 : 1)
}

let dir = '.'
let port = 5173
let host = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--host') host = true
  else if (a === '--port') port = Number(args[++i])
  else dir = a
}

const gameDir = path.resolve(dir)
await fs.mkdir(gameDir, { recursive: true })

const server = await createServer({
  configFile: false,
  root: editorRoot,
  plugins: [lucarneFs(gameDir)],
  server: { port, host },
})
await server.listen()
console.log(`\n  Lucarne — game folder: ${gameDir}`)
server.printUrls()

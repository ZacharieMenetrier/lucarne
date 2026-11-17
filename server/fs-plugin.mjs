// Vite plugin that exposes the game folder to the editor, locally only.
//
//   GET    /__lucarne/info              → { name }
//   GET    /__lucarne/list?dir=sprites  → ["hero.png", "hero.json", …] (files only)
//   GET    /__lucarne/fs?path=…         → raw content (404 if missing)
//   PUT    /__lucarne/fs?path=…         → writes the request body
//   DELETE /__lucarne/fs?path=…         → deletes the file
//   POST   /__lucarne/build             → rebuilds game.js from code/ → { ok, error?, missing? }
//
// Paths are relative to the game folder. Paths that leave it, and paths that
// go through a hidden entry (.git, .env…), are rejected.

import fs from 'node:fs/promises'
import path from 'node:path'
import { gameBuilder } from './build.mjs'

const MAX_BODY = 32 * 1024 * 1024

export function lucarneFs(gameDir) {
  const root = path.resolve(gameDir)
  let builder = null

  function resolveSafe(rel) {
    if (typeof rel !== 'string' || rel === '') throw httpError(400, 'Missing path')
    const parts = rel.split('/')
    if (parts.some((p) => p === '' || p.startsWith('.') || p.includes('\\'))) {
      throw httpError(400, `Path rejected: ${rel}`)
    }
    const abs = path.resolve(root, ...parts)
    if (!abs.startsWith(root + path.sep)) throw httpError(400, `Path rejected: ${rel}`)
    return abs
  }

  async function handle(req, res) {
    // Reject requests from another site (the server only listens locally,
    // but a web page open in the browser could still call it).
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') throw httpError(403, 'Origin rejected')
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host) throw httpError(403, 'Origin rejected')

    const url = new URL(req.url, 'http://local')
    const route = url.pathname

    if (route === '/info' && req.method === 'GET') {
      return sendJson(res, { name: path.basename(root) })
    }

    if (route === '/list' && req.method === 'GET') {
      const dir = url.searchParams.get('dir') ?? ''
      const abs = dir === '' ? root : resolveSafe(dir)
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true })
        return sendJson(
          res,
          entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort(),
        )
      } catch (err) {
        if (err.code === 'ENOENT') return sendJson(res, [])
        throw err
      }
    }

    if (route === '/build' && req.method === 'POST') {
      return sendJson(res, await builder.build())
    }

    if (route === '/fs') {
      const abs = resolveSafe(url.searchParams.get('path'))
      if (req.method === 'GET') {
        try {
          const data = await fs.readFile(abs)
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          return res.end(data)
        } catch (err) {
          if (err.code === 'ENOENT') throw httpError(404, 'Not found')
          throw err
        }
      }
      if (req.method === 'PUT') {
        const body = await readBody(req)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        // Atomic write: hidden temporary file, then rename.
        const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`)
        await fs.writeFile(tmp, body)
        await fs.rename(tmp, abs)
        res.statusCode = 204
        return res.end()
      }
      if (req.method === 'DELETE') {
        await fs.rm(abs, { force: true })
        res.statusCode = 204
        return res.end()
      }
    }

    throw httpError(404, 'Unknown route')
  }

  return {
    name: 'lucarne-fs',
    configureServer(server) {
      builder = gameBuilder(root, server.config.logger)
      void builder.build()
      const unwatch = builder.watch()
      server.httpServer?.on('close', unwatch)
      server.middlewares.use('/__lucarne', (req, res) => {
        handle(req, res).catch((err) => {
          res.statusCode = err.status ?? 500
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(err.status ? err.message : `Server error: ${err.message}`)
          if (!err.status) server.config.logger.error(`[lucarne] ${err.stack ?? err}`)
        })
      })
    },
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function sendJson(res, value) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(httpError(413, 'File too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

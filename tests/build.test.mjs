// The build is the server's (plain JavaScript, run by node): so is its test.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { gameBuilder } from '../server/build.mjs'
import * as engine from '../runtime/index.ts'
import { actorClasses, actorName, resetActorClasses, resetWorld, worldActors } from '../runtime/world.ts'

const quiet = { info() {}, error() {} }
let dir = ''

/** A game folder with these files, built into game.js. */
async function build(files) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-build-'))
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  return await gameBuilder(dir, quiet).build()
}

/** Runs game.js as the editor does, with the engine as `lucarne`. */
async function run() {
  globalThis.__lucarne = engine
  resetWorld()
  resetActorClasses()
  const mod = await import(pathToFileURL(path.join(dir, 'game.js')).href)
  return mod.default
}

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('building game.js', () => {
  it('registers the actor files by name before code/main.ts runs', async () => {
    const result = await build({
      'actors/hero.ts': "import { Actor } from 'lucarne'\nexport default class Hero extends Actor { speed = 1 }\n",
      'actors/big-hero.ts': "import Hero from './hero'\nexport default class BigHero extends Hero {}\n",
      'code/main.ts': "import { game, spawn } from 'lucarne'\nimport Hero from '../actors/hero'\nspawn(Hero, { x: 3 })\nexport default game({})\n",
    })
    expect(result).toEqual({ ok: true })
    const config = await run()
    expect(config).toEqual({})
    expect([...actorClasses().keys()]).toEqual(['big-hero', 'hero'])
    // Spawned at the top level of main.ts, it already knew its file.
    expect(worldActors().map((a) => [actorName(a.constructor), a.x])).toEqual([['hero', 3]])
  })

  it('needs no code/main.ts: a game can be actors on maps', async () => {
    expect(await build({ 'actors/hero.ts': "import { Actor } from 'lucarne'\nexport default class extends Actor {}\n" })).toEqual({ ok: true })
    expect(await run()).toEqual({})
  })

  it('says when there is no code at all, or an actor file name maps could not use', async () => {
    expect(await build({})).toMatchObject({ ok: false, missing: true })
    expect(await build({ 'actors/Hero.ts': 'export default 1\n' })).toMatchObject({ ok: false, error: expect.stringContaining('actors/Hero.ts: an actor') })
  })
})

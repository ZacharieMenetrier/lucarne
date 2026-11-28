import { App } from './app'
import { keepIOSEdge } from './iosedge'
import { MusicPage } from './musicpage'
import { Project } from './project'
import { isTileset } from './sprite'
import { buildSettingsPage } from './settings'
import { SoundsPage } from './sfxpage'
import { openStorage } from './storage'
import { WorldPage } from './worldpage'

async function main() {
  keepIOSEdge()
  const storage = await openStorage()
  const project = new Project(storage)
  await project.load()
  const app = new App(project)
  await app.start()
  const world = new WorldPage(project, app)
  await world.load()
  await new MusicPage(project, app).load()
  await new SoundsPage(project, app).load()
  buildSettingsPage(storage, () => app.refreshSync(), {
    settings: () => project.settings,
    maps: () => world.mapSizes,
    tilesets: () => [...app.editor.sprites.keys()].filter(isTileset),
    save: async (s) => {
      await project.saveSettings(s)
      app.setTileSize(s.tileSize)
    },
  })
  // ?play opens straight into the game (what an AI uses to test it).
  if (new URLSearchParams(location.search).has('play')) app.play()
}

main().catch((err: Error) => {
  document.body.innerHTML = ''
  const p = document.createElement('p')
  p.className = 'fatal'
  p.textContent = `Lucarne could not start: ${err.message}`
  document.body.append(p)
  console.error(err)
})

// Installed version (iPad): works offline thanks to the service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

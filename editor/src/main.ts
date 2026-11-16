import { App } from './app'
import { Project } from './project'
import { openStorage } from './storage'

async function main() {
  const storage = await openStorage()
  const project = new Project(storage)
  await project.load()
  await new App(project).start()
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

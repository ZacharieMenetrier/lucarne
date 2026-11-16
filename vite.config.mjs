// Used by `npm run build` (static version that can be installed on iPad).
// Dev mode goes through `bin/lucarne.mjs`, which wires up the game folder.
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'editor',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
})

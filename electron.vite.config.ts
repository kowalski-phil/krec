import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      // electron-store is ESM-only; bundle it into the CommonJS main build instead of require()-ing it.
      externalizeDeps: { exclude: ['electron-store'] }
    }
  },
  preload: {},
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          panel: resolve(__dirname, 'src/renderer/panel/index.html'),
          picker: resolve(__dirname, 'src/renderer/picker/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html')
        }
      }
    }
  }
})

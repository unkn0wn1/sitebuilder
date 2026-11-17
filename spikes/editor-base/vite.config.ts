import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const dir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: dir,
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { outDir: 'dist', emptyOutDir: true },
})

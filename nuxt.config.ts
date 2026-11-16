// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  typescript: {
    strict: true,
  },
  nitro: {
    // SQL migrations ship inside the server build (ADR 0009).
    serverAssets: [{ baseName: 'migrations', dir: fileURLToPath(new URL('./server/db/migrations', import.meta.url)) }],
  },
})

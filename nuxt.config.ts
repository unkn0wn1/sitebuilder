// https://nuxt.com/docs/api/configuration/nuxt-config
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOTSTRAP_SCRIPT } from './app/utils/theme'
import { flowbiteClassDarkPlugin } from './build/flowbite-class-dark'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['./modules/flowbite-vue.ts'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      script: [{ innerHTML: THEME_BOOTSTRAP_SCRIPT, tagPosition: 'head' }],
    },
  },
  vite: {
    plugins: [flowbiteClassDarkPlugin(), tailwindcss()],
  },
  typescript: {
    strict: true,
  },
  routeRules: {
    '/login': { ssr: false },
    '/pages/**': { ssr: false },
    '/site-parts/**': { ssr: false },
    '/media/**': { ssr: false },
    '/forms/**': { ssr: false },
    '/approvals/**': { ssr: false },
    '/brand/**': { ssr: false },
    '/templates/**': { ssr: false },
    '/settings/**': { ssr: false },
  },
  runtimeConfig: {
    version: JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string,
  },
  nitro: {
    // SQL migrations ship inside the server build (ADR 0009).
    serverAssets: [{ baseName: 'migrations', dir: fileURLToPath(new URL('./server/db/migrations', import.meta.url)) }],
  },
})

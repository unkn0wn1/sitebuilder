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
      title: 'Skewstone',
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
    '/**': { headers: { 'cache-control': 'private, no-store' } },
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
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
    public: {
      // Nitro expands this from the process environment before the config is frozen.
      // An unset key stays as the placeholder; the login page treats that as empty.
      turnstileSiteKey: '{{SITEBUILDER_TURNSTILE_SITE_KEY}}',
    },
  },
  nitro: {
    experimental: {
      // Lets {{SITEBUILDER_TURNSTILE_SITE_KEY}} resolve at process start. The shared
      // runtime config is frozen before plugins run, so a later assignment throws.
      envExpansion: true,
    },
    // SQL migrations ship inside the server build (ADR 0009).
    serverAssets: [{ baseName: 'migrations', dir: fileURLToPath(new URL('./server/db/migrations', import.meta.url)) }],
  },
})

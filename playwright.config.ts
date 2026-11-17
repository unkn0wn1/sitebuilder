import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3010',
    channel: 'chrome',
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
  outputDir: 'tests/e2e-results',
})

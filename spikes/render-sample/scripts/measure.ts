// Measure the rendered sample against the budgets in docs/17-testing-and-budgets.md.
import { gzipSync } from 'node:zlib'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { outDir, renderPage, writeRelease } from '../src/render.ts'

const budgets = {
  htmlGzip: 50 * 1024,
  cssGzip: 30 * 1024,
  jsOurGzip: 20 * 1024,
  heroAvif640: 120 * 1024,
  fonts: 0,
  jsWithoutInteractive: 0,
}

function gzipSize(buf: Buffer): number {
  return gzipSync(buf, { level: 9 }).length
}

await (async () => {
  const { html, deps } = await renderPage()
  writeRelease(html, deps)
  const htmlBuf = readFileSync(join(outDir, 'index.html'))
  const cssBuf = readFileSync(join(outDir, 'theme.css'))
  const jsBuf = readFileSync(join(outDir, 'embed.js'))
  const avif = statSync(join(outDir, 'media', 'hero-poster-640.avif')).size
  const video = statSync(join(outDir, 'media', 'hero.mp4')).size
  const webp1280 = statSync(join(outDir, 'media', 'hero-poster-1280.webp')).size

  const rows = [
    { measure: 'HTML per page (gzip)', bytes: gzipSize(htmlBuf), budget: budgets.htmlGzip, raw: htmlBuf.length },
    { measure: 'CSS whole site (gzip)', bytes: gzipSize(cssBuf), budget: budgets.cssGzip, raw: cssBuf.length },
    { measure: 'Our JS island (gzip, excluding Virtuous)', bytes: gzipSize(jsBuf), budget: budgets.jsOurGzip, raw: jsBuf.length },
    { measure: 'Hero poster 640px AVIF', bytes: avif, budget: budgets.heroAvif640 },
  ]

  const report = {
    at: new Date().toISOString(),
    bundleId: deps.bundleId,
    videoBytes: video,
    poster1280WebpBytes: webp1280,
    fonts: 0,
    note: 'Measured on the spike output, gzip level 9. Not served through Cloudflare. Virtuous script is not included in the JS figure.',
    rows: rows.map((r) => ({ ...r, pass: r.bytes <= r.budget })),
  }
  writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('Measure (gzip, spike output)\n')
  for (const r of report.rows) {
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.measure}: ${kb(r.bytes)} (budget ${kb(r.budget)})`)
  }
  console.log(`  video hero: ${(video / 1024).toFixed(1)} KB (no formal budget; compressed 4s 854×480)`)
  console.log(`  fonts: 0 files (system-ui)`)
  if (report.rows.some((r) => !r.pass)) process.exit(1)
})()

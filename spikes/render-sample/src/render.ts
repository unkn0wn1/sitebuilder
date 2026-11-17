// Render the sample page to static HTML with Vue's server renderer, the way a publish job would.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Page } from './blocks'
import { BUNDLE_ID, samplePage, siteShell } from './sample'

const root = fileURLToPath(new URL('..', import.meta.url))
export const outDir = join(root, 'out')

export interface DependencyMap {
  pageId: string
  versionId: string
  path: string
  bundleId: string
  siteParts: string[]
  media: string[]
  links: string[]
}

export function dependencyMap(): DependencyMap {
  const media: string[] = []
  const links: string[] = []
  for (const block of samplePage.blocks) {
    const p = block.props as Record<string, unknown>
    for (const key of ['video', 'poster', 'poster640', 'poster640Webp']) {
      if (typeof p[key] === 'string') media.push(p[key] as string)
    }
    const cta = p.cta as { href?: string } | undefined
    if (cta?.href) links.push(cta.href)
    if (typeof p.fallbackHref === 'string') links.push(p.fallbackHref)
  }
  return {
    pageId: samplePage.id,
    versionId: samplePage.versionId,
    path: samplePage.path,
    bundleId: BUNDLE_ID,
    siteParts: ['header', 'footer'],
    media: [...new Set(media)],
    links: [...new Set(links)],
  }
}

export async function renderPage(): Promise<{ html: string; deps: DependencyMap }> {
  const app = createSSRApp(Page)
  const body = await renderToString(app)
  const deps = dependencyMap()
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(samplePage.title)} · ${escapeHtml(siteShell.name)}</title>
  <meta name="description" content="${escapeHtml(samplePage.description)}">
  <link rel="stylesheet" href="/theme.css">
  <link rel="preload" as="image" href="/media/hero-poster-640.avif" type="image/avif" media="(max-width: 640px)">
  <link rel="preload" as="image" href="/media/hero-poster-1280.webp" type="image/webp" media="(min-width: 641px)">
</head>
<body>
  ${body}
  <script type="module" src="/embed.js"></script>
</body>
</html>
`
  return { html, deps }
}

export function writeRelease(html: string, deps: DependencyMap) {
  mkdirSync(join(outDir, 'media'), { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html)
  writeFileSync(join(outDir, 'deps.json'), JSON.stringify(deps, null, 2) + '\n')
  copyFileSync(join(root, 'src', 'theme.css'), join(outDir, 'theme.css'))
  copyFileSync(join(root, 'src', 'embed.js'), join(outDir, 'embed.js'))
  const mediaSrc = join(root, 'media')
  for (const name of ['hero.mp4', 'hero-poster-1280.webp', 'hero-poster-640.avif', 'hero-poster-640.webp']) {
    copyFileSync(join(mediaSrc, name), join(outDir, 'media', name))
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { html, deps } = await renderPage()
  writeRelease(html, deps)
  console.log(`Wrote ${outDir} (${deps.bundleId})`)
}

// Filesystem release writer (ADR 0004, ADR 0005): a new release starts as a hard-link
// copy of the previous one, changed pages are overwritten, then `current` is switched
// with an atomic symlink replace. sitemap.xml, robots.txt, nginx maps and the dependency
// map are rewritten on every publish.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync, linkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { redirects, releases, type ReleaseManifest } from '../db/schema'
import type { ServiceCtx } from './context'
import type { ReleaseWriter } from './publish'
import { BRAND_ICON_FILES, buildBrandIcons } from './brand-icons'
import { mediaDir as defaultMediaDir } from '../utils/state'
import {
  BUNDLE_ID,
  EMBED_JS,
  HEADER_JS,
  HERO_JS,
  THERMOMETER_JS,
  htmlPathFor,
  loadPageDoc,
  loadSiteRenderContext,
  nginxMapLines,
  redirectsMap,
  renderAnalyticsJs,
  renderManifestPage,
  robotsTxt,
  sitemapXml,
  type PageDependencies,
  type SiteRenderContext,
} from './render'

export const RELEASES_TO_KEEP = 10

export interface FileReleaseWriterOptions {
  /** How many release folders to keep after a switch. The live symlink is never deleted. */
  keep?: number
  /** Folder of original uploads and renditions, used to generate favicons from the brand logo. */
  mediaDir?: string
}

export function createFileReleaseWriter(root: string, opts: FileReleaseWriterOptions = {}): ReleaseWriter {
  const keep = opts.keep ?? RELEASES_TO_KEEP
  const iconsFrom = opts.mediaDir ?? defaultMediaDir()
  const releasesDir = join(root, 'releases')
  const currentLink = join(root, 'current')

  const dirFor = (id: string) => join(releasesDir, id)

  async function writeRelease(input: Parameters<ReleaseWriter['writeRelease']>[0]): Promise<void> {
    if (!input.ctx) throw new Error('The release writer needs a service context.')
    const ctx = input.ctx
    const dest = dirFor(input.releaseId)
    mkdirSync(releasesDir, { recursive: true })
    const prev = input.previousReleaseId ? dirFor(input.previousReleaseId) : null
    if (prev && existsSync(prev)) hardLinkCopy(prev, dest)
    else mkdirSync(dest, { recursive: true })

    const previous = input.previousReleaseId
      ? ctx.db.select({ manifest: releases.manifest }).from(releases).where(eq(releases.id, input.previousReleaseId)).get()?.manifest
      : null
    const site = loadSiteRenderContext(ctx, input.manifest, previous)
    const deps = readExistingDeps(dest)

    for (const path of input.removedPaths) removePublishedPath(dest, path)

    for (const pageId of input.changedPageIds) {
      if (!input.manifest.pages[pageId]) {
        delete deps[pageId]
        continue
      }
      const rendered = await renderManifestPage(ctx, input.manifest, pageId, site)
      writeNew(join(dest, htmlPathFor(rendered.deps.path)), rendered.html)
      deps[pageId] = rendered.deps
    }

    writeSiteFiles(ctx, dest, input.manifest, site, deps)
    await writeBrandIconFiles(ctx, dest, site, iconsFrom)
  }

  async function refreshMaps(ctx: ServiceCtx, releaseId: string): Promise<void> {
    const dest = dirFor(releaseId)
    if (!existsSync(dest)) return
    const live = ctx.db.select().from(releases).where(eq(releases.id, releaseId)).get()
    const manifest = live?.manifest
    if (!manifest) return
    const site = loadSiteRenderContext(ctx, manifest)
    writeSiteFiles(ctx, dest, manifest, site, readExistingDeps(dest))
    await writeBrandIconFiles(ctx, dest, site, iconsFrom)
  }

  function switchCurrent(releaseId: string): void {
    const target = dirFor(releaseId)
    if (!existsSync(target)) throw new Error(`Release folder ${releaseId} is missing.`)
    mkdirSync(root, { recursive: true })
    const tmp = join(root, `.current-${process.pid}-${Date.now()}`)
    symlinkSync(join('releases', releaseId), tmp)
    renameSync(tmp, currentLink)
    prune(releaseId, keep)
  }

  function prune(liveId: string, keepCount: number) {
    if (!existsSync(releasesDir)) return
    const sorted = readdirSync(releasesDir)
      .filter((name) => {
        try {
          return lstatSync(join(releasesDir, name)).isDirectory()
        } catch {
          return false
        }
      })
      .map((name) => ({ name, mtime: lstatSync(join(releasesDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const folder of sorted.slice(keepCount)) {
      if (folder.name === liveId) continue
      rmSync(join(releasesDir, folder.name), { recursive: true, force: true })
    }
  }

  return { writeRelease, switchCurrent, refreshMaps }
}

async function writeBrandIconFiles(ctx: ServiceCtx, dest: string, site: SiteRenderContext, mediaDir: string) {
  const files = await buildBrandIcons(ctx, site, mediaDir)
  if (!files) {
    for (const name of BRAND_ICON_FILES) {
      const path = join(dest, name)
      if (existsSync(path)) unlinkSync(path)
    }
    return
  }
  writeNew(join(dest, 'favicon.png'), files.favicon)
  writeNew(join(dest, 'apple-touch-icon.png'), files.appleTouch)
}

function writeSiteFiles(ctx: ServiceCtx, dest: string, manifest: ReleaseManifest, site: SiteRenderContext, deps: Record<string, PageDependencies>) {
  const docs: Record<string, ReturnType<typeof loadPageDoc>> = {}
  for (const [pageId, entry] of Object.entries(manifest.pages)) {
    try {
      docs[pageId] = loadPageDoc(ctx, entry.versionId)
    } catch {
      /* A page whose version is missing cannot go in the sitemap. */
    }
  }

  writeNew(join(dest, 'sitemap.xml'), sitemapXml(site, manifest, docs))
  writeNew(join(dest, 'robots.txt'), robotsTxt(site))
  writeNew(join(dest, 'embed.js'), EMBED_JS)
  writeNew(join(dest, 'bundle.json'), JSON.stringify({ bundleId: BUNDLE_ID, theme: 'default' }) + '\n')
  writeNew(join(dest, 'deps.json'), JSON.stringify(deps, null, 2) + '\n')

  const analytics = renderAnalyticsJs(site.tracking)
  const analyticsPath = join(dest, 'analytics.js')
  if (analytics) writeNew(analyticsPath, analytics)
  else if (existsSync(analyticsPath)) unlinkSync(analyticsPath)

  const tagEntries = Object.entries(manifest.pages).map(([id, entry]) => ({ uri: entry.path, value: `page-${id} shell` }))
  writeNew(join(dest, 'cache-tags.map'), nginxMapLines(tagEntries))

  const cspEntries: { uri: string; value: string }[] = []
  let needsHeaderJs = false
  let needsHeroJs = false
  let needsThermometerJs = false
  for (const [id, entry] of Object.entries(manifest.pages)) {
    const file = join(dest, htmlPathFor(entry.path))
    if (!existsSync(file)) continue
    const html = readFileSync(file, 'utf8')
    if (html.includes('src="/header.js"')) needsHeaderJs = true
    if (html.includes('src="/hero.js"')) needsHeroJs = true
    if (html.includes('src="/thermometer.js"')) needsThermometerJs = true
    const match = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)
    if (match?.[1]) cspEntries.push({ uri: entry.path, value: unescapeHtml(match[1]) })
  }
  // Write header.js, hero.js and thermometer.js into this release only when a page references them.
  // Leave an existing file in place when this release does not ask for it: hardLinkCopy already
  // linked the previous release's copy, and a later publish that drops the block keeps that file.
  // Nothing outside this release directory is removed.
  if (needsHeaderJs) writeNew(join(dest, 'header.js'), HEADER_JS)
  if (needsHeroJs) writeNew(join(dest, 'hero.js'), HERO_JS)
  if (needsThermometerJs) writeNew(join(dest, 'thermometer.js'), THERMOMETER_JS)
  writeNew(join(dest, 'csp.map'), nginxMapLines(cspEntries))

  const rows = ctx.db.select().from(redirects).where(eq(redirects.siteId, ctx.siteId)).all()
  const maps = redirectsMap(rows)
  writeNew(join(dest, 'redirects.map'), maps.uri)
  writeNew(join(dest, 'redirect-status.map'), maps.status)
}

function unescapeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

function readExistingDeps(dest: string): Record<string, PageDependencies> {
  const file = join(dest, 'deps.json')
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, PageDependencies>
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function removePublishedPath(dest: string, sitePath: string) {
  const file = join(dest, htmlPathFor(sitePath))
  if (existsSync(file)) unlinkSync(file)
  cleanupEmptyDirs(dest, dirname(file))
}

function cleanupEmptyDirs(root: string, dir: string) {
  let current = dir
  const base = resolve(root)
  while (current.startsWith(base) && current !== base) {
    try {
      if (readdirSync(current).length === 0) rmSync(current)
      else return
    } catch {
      return
    }
    current = dirname(current)
  }
}

/** Copy a release tree using hard links so unchanged files share disk and inodes. */
export function hardLinkCopy(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    const st = lstatSync(from)
    if (st.isDirectory()) hardLinkCopy(from, to)
    else if (st.isFile()) {
      if (existsSync(to)) unlinkSync(to)
      linkSync(from, to)
    }
  }
}

let nextWrite = 0

/** Replace `filePath` by renaming a new file over it. The existing inode is never opened for writing, so a hard link from the previous release keeps the old bytes. */
export function writeNew(filePath: string, content: string | Buffer) {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${basename(filePath)}.${process.pid}.${nextWrite++}.tmp`)
  try {
    writeFileSync(tmp, content)
    renameSync(tmp, filePath)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // The temp was not created, or rename already took it.
    }
    throw error
  }
}

export function readCurrentReleaseId(root: string): string | null {
  const current = join(root, 'current')
  if (!existsSync(current)) return null
  try {
    return readlinkSync(current).split(/[/\\]/).pop() ?? null
  } catch {
    return null
  }
}

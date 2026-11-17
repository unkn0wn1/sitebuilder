// Internal site paths and the pages they point at. Used when rendering and when deciding
// which live pages to re-render after a title, address or publish-state change.

/** A path on this site, like /about-us. Hash-only, mailto, tel and off-site URLs are ignored. */
export function internalSitePath(href: string, origin?: string | null): string | null {
  const raw = href.trim()
  if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return null
  try {
    let url: URL
    if (raw.startsWith('/')) {
      if (raw.startsWith('//')) return null
      url = new URL(raw, 'https://site.invalid')
    } else if (/^https?:/i.test(raw)) {
      url = new URL(raw)
      if (!origin) return null
      if (url.origin !== new URL(origin).origin) return null
    } else {
      return null
    }
    let path = url.pathname
    if (path.length > 1) path = path.replace(/\/+$/, '')
    return path.startsWith('/') ? path : null
  } catch {
    return null
  }
}

export function pageIdByPath(pages: Record<string, { path: string }>): Map<string, string> {
  return new Map(Object.entries(pages).map(([id, page]) => [page.path, id]))
}

export function pageIdForHref(href: string, pages: Map<string, string>, origin?: string | null, aliases?: Map<string, string>): string | null {
  const path = internalSitePath(href, origin)
  if (!path) return null
  return pages.get(path) ?? aliases?.get(path) ?? null
}

/** Current path for a page id, from a path→id map. */
export function pathForPageId(pages: Map<string, string>, pageId: string): string | null {
  for (const [path, id] of pages) {
    if (id === pageId) return path
  }
  return null
}

/** Collect page ids referenced by hrefs or { type: 'page', pageId } targets in a document. */
export function collectLinkedPageIds(doc: unknown, pages: Map<string, string>, origin?: string | null, aliases?: Map<string, string>): string[] {
  const ids = new Set<string>()
  walk(doc, pages, origin, aliases, ids)
  return [...ids]
}

function walk(value: unknown, pages: Map<string, string>, origin: string | null | undefined, aliases: Map<string, string> | undefined, ids: Set<string>) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, pages, origin, aliases, ids)
    return
  }
  const rec = value as Record<string, unknown>
  if (rec.type === 'page' && typeof rec.pageId === 'string') ids.add(rec.pageId)
  if (typeof rec.href === 'string') {
    const id = pageIdForHref(rec.href, pages, origin, aliases)
    if (id) ids.add(id)
  }
  if (typeof rec.url === 'string' && rec.type === 'url') {
    const id = pageIdForHref(rec.url, pages, origin, aliases)
    if (id) ids.add(id)
  }
  for (const item of Object.values(rec)) walk(item, pages, origin, aliases, ids)
}

/** Old addresses of pages that have since moved, so stored hrefs still resolve. */
export function pathAliases(previous: Record<string, { path: string }>, next: Record<string, { path: string }>): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const [id, prev] of Object.entries(previous)) {
    const current = next[id]
    if (current && prev.path !== current.path) aliases.set(prev.path, id)
  }
  return aliases
}

/** Follow stored redirects so an older path still maps to the live page. */
export function aliasesFromRedirects(rows: { fromPath: string; toPath: string }[], liveByPath: Map<string, string>): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const row of rows) {
    if (!row.toPath.startsWith('/')) continue
    let to = row.toPath
    for (let hops = 0; hops < 6; hops++) {
      const id = liveByPath.get(to)
      if (id) {
        aliases.set(row.fromPath, id)
        break
      }
      const next = rows.find((r) => r.fromPath === to)
      if (!next) break
      to = next.toPath
    }
  }
  return aliases
}

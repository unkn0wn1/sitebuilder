// Editable robots.txt with a safe default, used at publish. See Settings > SEO.
export const ROBOTS_MAX_CHARS = 8_000

const ALLOWED_DIRECTIVES = /^(user-agent|allow|disallow|sitemap|crawl-delay|host)$/i

export function defaultRobotsTxt(origin?: string | null): string {
  const sitemap = origin ? `Sitemap: ${origin.replace(/\/+$/, '')}/sitemap.xml\n` : 'Sitemap: /sitemap.xml\n'
  return `User-agent: *\nAllow: /\n${sitemap}`
}

export function sanitizeRobotsTxt(raw: string): { ok: true; text: string } | { ok: false; message: string } {
  if (raw.includes('\u0000') || /[<>]/.test(raw)) {
    return { ok: false, message: 'robots.txt can only be plain text — no HTML.' }
  }
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (normalised.length > ROBOTS_MAX_CHARS) {
    return { ok: false, message: `Keep robots.txt under ${ROBOTS_MAX_CHARS.toLocaleString()} characters.` }
  }
  const lines: string[] = []
  for (const line of normalised.split('\n')) {
    const trimmed = line.trimEnd()
    if (trimmed.trim() === '' || trimmed.trim().startsWith('#')) {
      lines.push(trimmed)
      continue
    }
    const colon = trimmed.indexOf(':')
    if (colon <= 0) return { ok: false, message: `Each line needs a directive, for example "Disallow: /drafts".` }
    const name = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (!ALLOWED_DIRECTIVES.test(name)) {
      return { ok: false, message: `"${name}" isn't a supported robots.txt directive.` }
    }
    const directive = name.toLowerCase() === 'sitemap' ? 'Sitemap' : name.replace(/^./, (c) => c.toUpperCase()).replace(/-./g, (s) => s.toUpperCase())
    // Keep conventional casing for the common ones.
    const label =
      directive.toLowerCase() === 'user-agent'
        ? 'User-agent'
        : directive.toLowerCase() === 'crawl-delay'
          ? 'Crawl-delay'
          : directive.toLowerCase() === 'sitemap'
            ? 'Sitemap'
            : directive
    if (label === 'Sitemap') {
      if (!/^https:\/\/[^\s]+$|^\/[^\s]*$/.test(value)) {
        return { ok: false, message: 'A Sitemap line must be an https:// address or a path starting with /.' }
      }
    }
    if ((label === 'Allow' || label === 'Disallow') && value && !value.startsWith('/') && value !== '*') {
      return { ok: false, message: 'Allow and Disallow paths should start with /.' }
    }
    lines.push(`${label}: ${value}`)
  }
  return { ok: true, text: lines.join('\n').replace(/\n+$/, '') + (lines.length ? '\n' : '') }
}

export function renderRobotsTxt(opts: { allowIndexing: boolean; origin?: string | null; custom?: string | null }): string {
  if (!opts.allowIndexing) return 'User-agent: *\nDisallow: /\n'
  const custom = opts.custom?.trim()
  if (!custom) return defaultRobotsTxt(opts.origin)
  const clean = sanitizeRobotsTxt(custom)
  const body = clean.ok ? clean.text : defaultRobotsTxt(opts.origin)
  if (/^sitemap:/im.test(body)) return body.endsWith('\n') ? body : `${body}\n`
  const sitemap = opts.origin ? `Sitemap: ${opts.origin.replace(/\/+$/, '')}/sitemap.xml\n` : 'Sitemap: /sitemap.xml\n'
  return `${body.endsWith('\n') ? body : `${body}\n`}${sitemap}`
}

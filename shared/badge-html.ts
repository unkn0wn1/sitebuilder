// Allow-listed badge snippets for the Trust strip (Charity Navigator, Candid/GuideStar, and similar).
// Inline scripts, event handlers and unknown hosts are dropped. See docs/research/charity-blocks-2026-11.md.

export const BADGE_HOST_SUFFIXES = [
  'charitynavigator.org',
  'guidestar.org',
  'candid.org',
  'greatnonprofits.org',
  'give.org',
  'bbb.org',
  'jscache.com',
  'tacdn.com',
] as const

/** Country sites whose root is brand.tld, not brand.com (TripAdvisor, Kayak). */
const BADGE_BRAND_TLDS: Record<string, readonly string[]> = {
  tripadvisor: ['com', 'in', 'co.uk', 'co.in', 'ca', 'com.au', 'ie', 'com.sg', 'co.nz', 'de', 'fr', 'it', 'es', 'co.jp', 'com.mx', 'com.br', 'co.za'],
  kayak: ['com', 'co.uk', 'co.in', 'com.au', 'ca', 'de', 'fr', 'es', 'it', 'co.jp'],
}

const ALLOWED_TAGS = new Set(['a', 'img', 'iframe', 'script', 'noscript', 'div', 'span', 'p', 'br', 'ul', 'li'])
const VOID_TAGS = new Set(['img', 'br'])
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'title', 'class', 'id']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'title', 'class', 'id']),
  iframe: new Set(['src', 'title', 'width', 'height', 'loading', 'referrerpolicy', 'class']),
  script: new Set(['src', 'async', 'defer', 'type', 'charset']),
  noscript: new Set(['class']),
  div: new Set(['class', 'id', 'title']),
  span: new Set(['class', 'id', 'title']),
  p: new Set(['class']),
  ul: new Set(['class', 'id']),
  li: new Set(['class', 'id']),
  br: new Set([]),
}

export interface SanitizedBadge {
  html: string
  scriptSrcs: string[]
  imgSrcs: string[]
  frameSrcs: string[]
}

export function isAllowedBadgeHost(host: string): boolean {
  const value = host.trim().toLowerCase()
  if (!value) return false
  if (BADGE_HOST_SUFFIXES.some((suffix) => value === suffix || value.endsWith(`.${suffix}`))) return true
  for (const [brand, tlds] of Object.entries(BADGE_BRAND_TLDS)) {
    for (const tld of tlds) {
      const root = `${brand}.${tld}`
      if (value === root || value.endsWith(`.${root}`)) return true
    }
  }
  return false
}

export function isAllowedBadgeUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && isAllowedBadgeHost(url.hostname)
  } catch {
    return false
  }
}

const ATTR_RE = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const TOKEN_RE = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)([^>]*?)\s*(\/?)\s*>|([^<]+)/g

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(raw))) {
    const name = match[1]!.toLowerCase()
    if (name === '/' || name === '') continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[name] = decodeAttr(value)
  }
  return attrs
}

export function sanitizeBadgeHtml(input: string): SanitizedBadge {
  const scriptSrcs: string[] = []
  const imgSrcs: string[] = []
  const frameSrcs: string[] = []
  const trimmed = input.trim()
  if (!trimmed) return { html: '', scriptSrcs, imgSrcs, frameSrcs }

  type Node = { type: 'text'; text: string } | { type: 'tag'; tag: string; attrs: Record<string, string>; children: Node[]; selfClosing: boolean }

  const root: Node[] = []
  const stack: { tag: string; children: Node[] }[] = [{ tag: '#root', children: root }]
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(trimmed))) {
    const current = stack[stack.length - 1]!
    if (match[0].startsWith('<!--')) continue
    if (match[1]) {
      const tag = match[1].toLowerCase()
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    if (match[2]) {
      const tag = match[2].toLowerCase()
      const selfClosing = Boolean(match[4]) || VOID_TAGS.has(tag)
      const node: Node = { type: 'tag', tag, attrs: parseAttrs(match[3] ?? ''), children: [], selfClosing }
      current.children.push(node)
      if (!selfClosing) stack.push({ tag, children: node.children })
      continue
    }
    if (match[5]) current.children.push({ type: 'text', text: match[5] })
  }

  function render(nodes: Node[]): string {
    let out = ''
    for (const node of nodes) {
      if (node.type === 'text') {
        out += escapeText(node.text)
        continue
      }
      if (!ALLOWED_TAGS.has(node.tag)) {
        out += render(node.children)
        continue
      }
      if (node.tag === 'script') {
        const src = node.attrs.src?.trim() ?? ''
        if (!isAllowedBadgeUrl(src)) continue
        const type = (node.attrs.type ?? 'text/javascript').toLowerCase()
        if (type && type !== 'text/javascript' && type !== 'application/javascript' && type !== 'module') continue
        // Inline script bodies are never kept.
        scriptSrcs.push(src)
        const parts = [`src="${escapeAttr(src)}"`]
        if ('async' in node.attrs) parts.push('async')
        if ('defer' in node.attrs) parts.push('defer')
        if (type === 'module') parts.push('type="module"')
        if ((node.attrs.charset ?? '').toLowerCase() === 'utf-8') parts.push('charset="utf-8"')
        out += `<script ${parts.join(' ')}></script>`
        continue
      }
      const allowed = ALLOWED_ATTRS[node.tag] ?? new Set<string>()
      const parts: string[] = []
      for (const [name, value] of Object.entries(node.attrs)) {
        if (name.startsWith('on') || name === 'srcdoc' || name === 'style' || name.startsWith('xmlns')) continue
        if (!allowed.has(name)) continue
        if (name === 'src' || name === 'href') {
          if (!isAllowedBadgeUrl(value)) continue
          if (name === 'src' && node.tag === 'img') imgSrcs.push(value)
          if (name === 'src' && node.tag === 'iframe') frameSrcs.push(value)
          parts.push(`${name}="${escapeAttr(value.trim())}"`)
          continue
        }
        if (name === 'width' || name === 'height') {
          if (!/^\d{1,4}(px)?$/.test(value.trim())) continue
          parts.push(`${name}="${escapeAttr(value.trim())}"`)
          continue
        }
        if (name === 'loading' && value !== 'lazy' && value !== 'eager') continue
        if (name === 'referrerpolicy' && !/^[a-z-]+$/.test(value)) continue
        if (name === 'target') {
          if (value !== '_blank' && value !== '_self') continue
          parts.push('target="_blank"')
          continue
        }
        if (name === 'rel') continue
        if (name === 'type') continue
        if (name === 'id' || name === 'class' || name === 'title' || name === 'alt') {
          if (/[<>"']/.test(value) || value.length > 200) continue
          parts.push(`${name}="${escapeAttr(value)}"`)
        }
      }
      if (node.tag === 'a') {
        const href = node.attrs.href
        if (!href || !isAllowedBadgeUrl(href)) {
          out += render(node.children)
          continue
        }
        if (node.attrs.target === '_blank' && !parts.some((p) => p.startsWith('rel='))) parts.push('rel="noopener noreferrer"')
      }
      if (node.tag === 'iframe') {
        const src = node.attrs.src
        if (!src || !isAllowedBadgeUrl(src)) continue
        if (!parts.some((p) => p.startsWith('title='))) parts.push('title="Organisation badge"')
        if (!parts.some((p) => p.startsWith('loading='))) parts.push('loading="lazy"')
        if (!parts.some((p) => p.startsWith('referrerpolicy='))) parts.push('referrerpolicy="no-referrer"')
      }
      if (node.tag === 'img') {
        const src = node.attrs.src
        if (!src || !isAllowedBadgeUrl(src)) continue
        if (!parts.some((p) => p.startsWith('alt='))) parts.push('alt=""')
      }
      const attrStr = parts.length ? ' ' + parts.join(' ') : ''
      if (VOID_TAGS.has(node.tag)) {
        out += `<${node.tag}${attrStr}>`
        continue
      }
      out += `<${node.tag}${attrStr}>${render(node.children)}</${node.tag}>`
    }
    return out
  }

  return { html: render(root).trim(), scriptSrcs, imgSrcs, frameSrcs }
}

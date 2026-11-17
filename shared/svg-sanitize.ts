// Server-side SVG sanitiser for media uploads. Scripts, event handlers, foreign
// objects and external references are stripped. The result is served as image/svg+xml
// with a tight Content-Security-Policy.
export const SVG_MAX_BYTES = 1024 * 1024
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'defs', 'clippath', 'mask', 'lineargradient', 'radialgradient',
  'stop', 'use', 'symbol', 'title', 'desc', 'marker', 'pattern', 'filter', 'view',
  'style', 'switch', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'feflood', 'fefunca',
  'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode',
  'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight',
  'fetile', 'feturbulence',
])

const ALLOWED_ATTRS = new Set([
  'id', 'class', 'viewbox', 'xmlns', 'xmlns:xlink', 'xmlns:svg', 'version', 'width', 'height',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'd', 'points',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'opacity', 'color', 'clip-path', 'clip-rule', 'mask', 'filter', 'display', 'visibility',
  'overflow', 'preserveaspectratio', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'offset', 'stop-color', 'stop-opacity', 'fx', 'fy', 'fr', 'marker-start', 'marker-mid',
  'marker-end', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits',
  'patternunits', 'patterncontentunits', 'patterntransform', 'filterunits', 'primitiveunits',
  'stddeviation', 'in', 'in2', 'result', 'mode', 'type', 'values', 'operator', 'k1', 'k2', 'k3', 'k4',
  'surfaceScale'.toLowerCase(), 'specularconstant', 'specularexponent', 'azimuth', 'elevation',
  'basefrequency', 'numoctaves', 'seed', 'stitchtiles', 'preservealpha',
  'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant', 'text-anchor',
  'text-decoration', 'letter-spacing', 'word-spacing', 'dominant-baseline', 'alignment-baseline',
  'baseline-shift', 'direction', 'unicode-bidi', 'writing-mode',
  'aria-hidden', 'aria-label', 'role', 'focusable', 'tabindex',
  'href', 'xlink:href', 'xlink:title',
  'style',
])

const URL_ATTRS = new Set(['href', 'xlink:href'])

export function looksLikeSvg(data: Buffer): boolean {
  const start = data.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (start.startsWith('<svg') || start.startsWith('<?xml')) {
    return /<svg[\s>]/i.test(start)
  }
  return false
}

export class SvgSanitiseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SvgSanitiseError'
  }
}

const ATTR_RE = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[\s\S]*?>|<\?[\s\S]*?\?>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)([^>]*?)\s*(\/?)\s*>|([^<]+)/g

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

function isSafeStyle(value: string): boolean {
  const v = value.toLowerCase()
  if (v.includes('expression(') || v.includes('javascript:') || v.includes('@import') || v.includes('behavior:')) return false
  if (/url\s*\(\s*['"]?\s*(https?:|\/\/|data:(?!image\/(?:png|jpeg|jpg|webp|gif)))/i.test(value)) return false
  return true
}

function isSafeHref(tag: string, value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('#')) return true
  if (tag === 'image' || tag === 'feimage') {
    return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/]+=*$/i.test(v.replace(/\s+/g, ''))
  }
  // No external or same-document file references on <use> or anything else.
  return false
}

function parseAttrs(raw: string, tag: string): string {
  const out: string[] = []
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = ATTR_RE.exec(raw))) {
    const name = m[1]!.toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)
    if (name.startsWith('on')) continue
    if (name.startsWith('xmlns:') && name !== 'xmlns:xlink' && name !== 'xmlns:svg') continue
    if (!ALLOWED_ATTRS.has(name) && name !== 'xmlns') continue
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    const decoded = decodeAttr(value)
    if (name === 'style' && !isSafeStyle(decoded)) continue
    if (URL_ATTRS.has(name) && !isSafeHref(tag, decoded)) continue
    if (/javascript:|vbscript:|data:text\/html/i.test(decoded)) continue
    if (name === 'tabindex' && decoded.trim() !== '-1' && decoded.trim() !== '0') continue
    out.push(value === '' && m[2] === undefined && m[3] === undefined && m[4] === undefined ? name : `${name}="${escapeAttr(decoded)}"`)
  }
  return out.length ? ' ' + out.join(' ') : ''
}

function sanitizeStyleText(css: string): string {
  if (!isSafeStyle(css)) return ''
  return css.replace(/@import[^;]+;?/gi, '')
}

/** Return sanitised SVG markup, or throw if the file cannot be used. */
export function sanitizeSvg(input: string | Buffer): string {
  const raw = typeof input === 'string' ? input : input.toString('utf8')
  if (Buffer.byteLength(raw, 'utf8') > SVG_MAX_BYTES) throw new SvgSanitiseError('That SVG is too big. Keep it under 1 MB.')
  if (raw.includes('\u0000')) throw new SvgSanitiseError('That SVG could not be used.')
  const text = raw.replace(/^\uFEFF/, '')
  if (!looksLikeSvg(Buffer.from(text))) throw new SvgSanitiseError('That file is not a usable SVG.')
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE/i.test(text)) {
    // Drop the doctype (and any entity declarations) before parsing tokens.
  }
  let out = ''
  let depth = 0
  let sawSvg = false
  const stack: string[] = []
  let skipping = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  const src = text.replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<\?xml[\s\S]*?\?>/i, '').trim()
  while ((m = TOKEN_RE.exec(src))) {
    if (m[0].startsWith('<!--') || m[0].startsWith('<?') || m[0].startsWith('<!DOCTYPE') || m[0].startsWith('<![CDATA[')) {
      continue
    }
    if (m[1]) {
      const tag = m[1].toLowerCase()
      if (skipping) {
        if (ALLOWED_TAGS.has(tag) === false) {
          /* still inside a skipped subtree */
        }
        skipping = Math.max(0, skipping - 1)
        if (stack.length && stack[stack.length - 1] === tag) stack.pop()
        continue
      }
      if (!stack.length) continue
      if (stack[stack.length - 1] !== tag) continue
      stack.pop()
      depth -= 1
      out += `</${tag}>`
      continue
    }
    if (m[2]) {
      const tag = m[2].toLowerCase()
      const selfClosing = !!m[4] || m[0].trimEnd().endsWith('/>')
      if (skipping) {
        if (!selfClosing) skipping += 1
        continue
      }
      if (!ALLOWED_TAGS.has(tag) || (tag === 'svg' && sawSvg && depth === 0)) {
        if (!selfClosing) skipping += 1
        continue
      }
      if (tag === 'svg') sawSvg = true
      if (!sawSvg) continue
      const attrs = parseAttrs(m[3] ?? '', tag)
      if (selfClosing) {
        out += `<${tag}${attrs}/>`
      } else {
        stack.push(tag)
        depth += 1
        out += `<${tag}${attrs}>`
      }
      continue
    }
    if (m[5] !== undefined) {
      if (skipping) continue
      const current = stack[stack.length - 1]
      if (current === 'style') out += sanitizeStyleText(m[5])
      else if (current === 'title' || current === 'desc' || current === 'text' || current === 'tspan' || current === 'textpath') {
        out += m[5].replace(/[<>]/g, '')
      }
    }
  }
  if (!sawSvg || !out.includes('<svg')) throw new SvgSanitiseError('That SVG could not be used.')
  if (skipping || stack.length) {
    while (stack.length) out += `</${stack.pop()}>`
  }
  // Always emit a clean XML declaration-less svg with the svg namespace if missing.
  if (!/\sxmlns=/.test(out.slice(0, 200))) {
    out = out.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return out
}

export function svgPublicName(id: string): string {
  return `${id}.svg`
}

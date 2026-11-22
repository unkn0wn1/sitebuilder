// Check and emit custom CSS. Check mode returns the author's text. Emit mode returns generated CSS,
// prefixed when the scope is a section. Nothing in an error message is taken from the source.
import { generate, parse, walk, type CssNode } from 'css-tree'
import { CssRejected } from './errors'
import { DATA_URL_MAX_CHARS, MAX_RULES, SECTION_CSS_MAX_BYTES, SECTION_ID, SITE_CSS_MAX_BYTES } from './limits'
import { prefixSectionCss } from './prefix'

export { CssRejected, cssIssueMessage } from './errors'
export { DATA_URL_MAX_CHARS, MAX_RULES, SECTION_CSS_MAX_BYTES, SITE_CSS_MAX_BYTES, STYLE_MAX_BYTES } from './limits'

const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'keyframes'])

const AT_RULE_MESSAGES: Record<string, string> = {
  import: '@import is not allowed.',
  charset: '@charset is not allowed.',
  namespace: '@namespace is not allowed.',
  'font-face': '@font-face is not allowed.',
  page: '@page is not allowed.',
  layer: '@layer is not allowed.',
  scope: '@scope is not allowed.',
  document: '@document is not allowed.',
  nest: '@nest is not allowed.',
}

const MEDIA_URL = /^\/media\/med_[0-9A-Z]{26}(?:-[A-Za-z0-9._-]+)?$/
const DATA_URL = /^data:image\/(?:png|webp|avif|gif|svg\+xml)(?:;base64)?,([A-Za-z0-9+/]+={0,2})$/i

interface ScanHit {
  message: string
}

const SCAN_PATTERNS: { test: (flat: string) => boolean; message: string }[] = [
  { test: (flat) => flat.includes('</style'), message: 'Custom CSS cannot contain </style>.' },
  { test: (flat) => flat.includes('@import'), message: '@import is not allowed.' },
  { test: (flat) => flat.includes('@charset'), message: '@charset is not allowed.' },
  { test: (flat) => flat.includes('@namespace'), message: '@namespace is not allowed.' },
  { test: (flat) => flat.includes('@font-face'), message: '@font-face is not allowed.' },
  { test: (flat) => flat.includes('@page'), message: '@page is not allowed.' },
  { test: (flat) => flat.includes('@layer'), message: '@layer is not allowed.' },
  { test: (flat) => flat.includes('@scope'), message: '@scope is not allowed.' },
  { test: (flat) => flat.includes('@document'), message: '@document is not allowed.' },
  { test: (flat) => flat.includes('@nest'), message: '@nest is not allowed.' },
  { test: (flat) => flat.includes('expression('), message: 'expression() is not allowed.' },
  { test: (flat) => flat.includes('javascript:'), message: 'javascript: URLs are not allowed.' },
  { test: (flat) => flat.includes('vbscript:'), message: 'vbscript: URLs are not allowed.' },
  { test: (flat) => /(^|[^a-z0-9-])-moz-binding([^a-z0-9-]|$)/.test(flat), message: '-moz-binding is not allowed.' },
  { test: (flat) => /(^|[^a-z0-9-])behavior([^a-z0-9-]|$)/.test(flat), message: 'The behavior property is not allowed.' },
]

export interface SanitizeOptions {
  scope: 'section' | 'site'
  sectionId?: string
  mode: 'check' | 'emit'
}

function positionAt(source: string, index: number): { line: number; column: number } {
  let line = 1
  let column = 1
  const stop = Math.min(index, source.length)
  for (let i = 0; i < stop; i++) {
    if (source[i] === '\n') {
      line++
      column = 1
    } else column++
  }
  return { line, column }
}

function locOf(node: CssNode): { line: number; column: number } {
  const line = node.loc?.start?.line ?? 1
  const column = node.loc?.start?.column ?? 1
  return { line: line > 0 ? line : 1, column: column > 0 ? column : 1 }
}

function isHex(ch: string): boolean {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
}

function codePointChar(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return '\uFFFD'
  return String.fromCodePoint(cp)
}

/** Decode CSS escapes, keeping at most `maxHex` hex digits per escape. Shorter caps catch `\73cript` as `script`. */
export function decodeCssEscapes(input: string, maxHex: number): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (ch !== '\\') {
      out += ch
      continue
    }
    if (i + 1 >= input.length) {
      out += '\\'
      break
    }
    const next = input[i + 1]!
    if (next === '\n') {
      i += 1
      continue
    }
    if (next === '\r') {
      i += 1
      if (input[i + 1] === '\n') i += 1
      continue
    }
    let hex = ''
    let j = i + 1
    while (hex.length < maxHex && j < input.length && isHex(input[j]!)) {
      hex += input[j]!
      j++
    }
    if (hex.length > 0) {
      out += codePointChar(Number.parseInt(hex, 16))
      i = j - 1
      continue
    }
    out += next
    i += 1
  }
  return out
}

function flatten(decoded: string): string {
  return decoded.replace(/\/\*|\*\//g, '').replace(/\s+/g, '').toLowerCase()
}

function scanSource(source: string): ScanHit | null {
  for (let maxHex = 1; maxHex <= 6; maxHex++) {
    const flat = flatten(decodeCssEscapes(source, maxHex))
    for (const pattern of SCAN_PATTERNS) {
      if (pattern.test(flat)) return { message: pattern.message }
    }
  }
  return null
}

function assertBytes(source: string, scope: SanitizeOptions['scope']) {
  const cap = scope === 'site' ? SITE_CSS_MAX_BYTES : SECTION_CSS_MAX_BYTES
  if (Buffer.byteLength(source, 'utf8') > cap) {
    const shown = cap.toLocaleString('en-GB')
    throw new CssRejected(1, 1, `Custom CSS is limited to ${shown} bytes.`)
  }
}

function assertNoRawAngle(source: string) {
  const lower = source.toLowerCase()
  const styleAt = lower.indexOf('</style')
  const angleAt = source.indexOf('<')
  if (styleAt < 0 && angleAt < 0) return
  const at = styleAt >= 0 && (angleAt < 0 || styleAt <= angleAt) ? styleAt : angleAt
  const pos = positionAt(source, at)
  const message = styleAt >= 0 && at === styleAt ? 'Custom CSS cannot contain </style>.' : 'Custom CSS cannot contain <.'
  throw new CssRejected(pos.line, pos.column, message)
}

function unescapeIdent(value: string): string {
  return decodeCssEscapes(value, 6)
}

function isSyntaxError(error: unknown): error is { line: number; column: number; source: string } {
  if (!error || typeof error !== 'object') return false
  const row = error as { name?: unknown; line?: unknown; column?: unknown; source?: unknown }
  return row.name === 'SyntaxError' && typeof row.line === 'number' && typeof row.column === 'number' && typeof row.source === 'string'
}

function parseCss(source: string): CssNode {
  try {
    return parse(source, { positions: true })
  } catch (error) {
    if (isSyntaxError(error)) throw new CssRejected(error.line, error.column, 'Could not parse the CSS.')
    throw error
  }
}

function stringValue(node: CssNode): string {
  return typeof node.value === 'string' ? node.value : ''
}

function allowedUrl(value: string): boolean {
  const url = value.trim()
  if (MEDIA_URL.test(url)) return true
  if (url.length > DATA_URL_MAX_CHARS) return false
  return DATA_URL.test(url)
}

function urlLike(value: string): boolean {
  const url = value.trim()
  return url.includes(':') || url.startsWith('/') || url.startsWith('\\')
}

function eachChild(node: CssNode, fn: (child: CssNode) => void) {
  const kids = node.children
  if (!kids) return
  if (Array.isArray(kids)) {
    for (const child of kids) fn(child)
    return
  }
  kids.forEach((child) => fn(child))
}

function assertAst(ast: CssNode) {
  let rules = 0
  walk(ast, (node) => {
    if (node.type === 'Rule') {
      rules++
      if (rules > MAX_RULES) throw new CssRejected(locOf(node).line, locOf(node).column, `Custom CSS can have at most ${MAX_RULES} rules.`)
    }
    if (node.type === 'Atrule') {
      const name = unescapeIdent(typeof node.name === 'string' ? node.name : '').toLowerCase()
      if (!ALLOWED_AT_RULES.has(name)) {
        const pos = locOf(node)
        throw new CssRejected(pos.line, pos.column, AT_RULE_MESSAGES[name] ?? 'This at-rule is not allowed.')
      }
    }
    if (node.type === 'Declaration' && typeof node.property === 'string') {
      const prop = unescapeIdent(node.property).toLowerCase()
      const pos = locOf(node)
      if (prop === 'behavior') throw new CssRejected(pos.line, pos.column, 'The behavior property is not allowed.')
      if (prop === '-moz-binding') throw new CssRejected(pos.line, pos.column, '-moz-binding is not allowed.')
    }
    if (node.type === 'Function' && typeof node.name === 'string') {
      const name = unescapeIdent(node.name).toLowerCase()
      if (name === 'expression') throw new CssRejected(locOf(node).line, locOf(node).column, 'expression() is not allowed.')
      if (name === 'image-set' || name === '-webkit-image-set') {
        eachChild(node, (child) => {
          if (child.type === 'String' && urlLike(stringValue(child)) && !allowedUrl(stringValue(child))) {
            throw new CssRejected(locOf(child).line, locOf(child).column, 'Only images from this site are allowed.')
          }
        })
      }
    }
    if (node.type === 'Url') {
      const url = stringValue(node)
      if (!allowedUrl(url)) throw new CssRejected(locOf(node).line, locOf(node).column, 'Only images from this site are allowed.')
    }
  })
}

/** css-tree writes `<` through in strings. Escape those, and refuse a `<` anywhere else. */
function beltGenerated(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]!
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ch
      i++
      while (i < css.length) {
        const next = css[i]!
        if (next === '\\') {
          out += next
          i++
          if (i < css.length) {
            out += css[i]!
            i++
          }
          continue
        }
        if (next === '<') {
          out += '\\3c '
          i++
          continue
        }
        out += next
        i++
        if (next === quote) break
      }
      continue
    }
    if (ch === '<') throw new CssRejected(1, 1, 'The generated CSS was rejected.')
    out += ch
    i++
  }
  if (out.includes('<') || out.toLowerCase().includes('</style')) throw new CssRejected(1, 1, 'The generated CSS was rejected.')
  return out
}

/**
 * `check` parses and rejects, then returns the author's text unchanged.
 * `emit` does that again, prefixes a section, and returns the generated CSS.
 */
export function sanitizeCss(source: string, options: SanitizeOptions): string {
  assertBytes(source, options.scope)
  assertNoRawAngle(source)
  const scanned = scanSource(source)
  if (scanned) throw new CssRejected(1, 1, scanned.message)
  const ast = parseCss(source)
  assertAst(ast)
  if (options.mode === 'check') return source
  if (options.scope === 'section') {
    if (!options.sectionId || !SECTION_ID.test(options.sectionId)) throw new CssRejected(1, 1, 'The section id is not valid.')
    prefixSectionCss(ast, options.sectionId)
  }
  return beltGenerated(generate(ast))
}

import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { CssRejected, sanitizeCss } from '../shared/css/sanitize'
import { emptyPageDoc, migratePageDoc, validatePageDoc } from '../shared/page'
import { richTextFromParagraphs } from '../shared/richtext'

const MARKER = 'MARKER9f3c'
const registry = createDefaultRegistry()

function reject(css: string, scope: 'section' | 'site' = 'section') {
  try {
    sanitizeCss(css, { scope, mode: 'check' })
  } catch (error) {
    expect(error).toBeInstanceOf(CssRejected)
    const err = error as CssRejected
    expect(err.line).toBeGreaterThan(0)
    expect(err.column).toBeGreaterThan(0)
    expect(err.message).not.toContain(MARKER)
    expect(err.message).not.toContain('<style')
    return err
  }
  throw new Error('expected the CSS to be rejected')
}

function allow(css: string, scope: 'section' | 'site' = 'section') {
  expect(sanitizeCss(css, { scope, mode: 'check' })).toBe(css)
}

describe('CSS sanitiser rejections', () => {
  const hostile: [string, string, string?][] = [
    ['import string', `@import "${MARKER}.css";`, '@import'],
    ['import url', `@import url("https://evil.example/${MARKER}.css");`, '@import'],
    ['import layer supports media', `@import "${MARKER}.css" layer(foo) supports(display: flex) print;`, '@import'],
    ['import uppercase', `@IMPORT "${MARKER}.css";`, '@import'],
    ['import escaped', `@\\69 mport "${MARKER}.css";`, '@import'],
    ['import in a comment', `/* @import ${MARKER} */ .a { color: red }`, '@import'],
    ['expression', `a { width: expression(${MARKER}) }`, 'expression'],
    ['expression in a string', `a { content: "expression(${MARKER})" }`, 'expression'],
    ['javascript url', `a { background: url(javascript:${MARKER}) }`, 'javascript:'],
    ['javascript uppercase', `a { background: url(JAVASCRIPT:${MARKER}) }`, 'javascript:'],
    ['javascript whitespace', `a { background: url(java\n script:${MARKER}) }`, 'javascript:'],
    ['javascript escape letter', `a { background: url(java\\script:${MARKER}) }`, 'javascript:'],
    ['javascript hex escape', `a { background: url(java\\73cript:${MARKER}) }`, 'javascript:'],
    ['javascript newline escape', `a { background: url(java\\0a script:${MARKER}) }`, 'javascript:'],
    ['vbscript', `a { background: url(vbscript:${MARKER}) }`, 'vbscript:'],
    ['behavior', `a { behavior: url(${MARKER}) }`, 'behavior'],
    ['moz-binding', `a { -moz-binding: url(${MARKER}) }`, '-moz-binding'],
    ['external url', `a { background: url(https://evil.example/${MARKER}.png) }`, 'images from this site'],
    ['protocol-relative url', `a { background: url(//evil.example/${MARKER}.png) }`, 'images from this site'],
    ['image-set external', `a { background: image-set(url(https://evil.example/${MARKER}.png) 1x) }`, 'images from this site'],
    ['image-set string', `a { background: image-set("https://evil.example/${MARKER}.png" 1x) }`, 'images from this site'],
    ['font-face', `@font-face { font-family: ${MARKER}; src: url(https://evil.example/a.woff) }`, '@font-face'],
    ['charset', `@charset "${MARKER}";`, '@charset'],
    ['namespace', `@namespace ${MARKER} url(https://evil.example/);`, '@namespace'],
    ['page', `@page { margin: 1px; content: "${MARKER}" }`, '@page'],
    ['layer', `@layer ${MARKER} { .a { color: red } }`, '@layer'],
    ['style in a string', `a { content: "</style>${MARKER}" }`, '</style>'],
    ['style uppercase in a string', `a { content: "</STYLE>${MARKER}" }`, '</style>'],
    ['style in a comment', `/* </style>${MARKER} */ .a { color: red }`, '</style>'],
    ['style in a selector', `a</style>${MARKER} { color: red }`, '</style>'],
    ['style in a value', `a { width: </style>${MARKER} }`, '</style>'],
    ['bare angle', `a { content: "x<${MARKER}" }`, 'cannot contain <'],
  ]

  it.each(hostile)('rejects %s', (_label, css, fragment) => {
    const err = reject(css)
    if (fragment) expect(err.message.toLowerCase()).toContain(fragment.toLowerCase())
  })

  it('rejects a section over 8,192 bytes and a site sheet over 32,768 bytes', () => {
    const section = `/* ${MARKER} */` + 'a{color:red}'.repeat(800)
    expect(Buffer.byteLength(section, 'utf8')).toBeGreaterThan(8192)
    expect(reject(section).message).toContain('8,192')
    const site = `/* ${MARKER} */` + 'a{color:red}'.repeat(3000)
    expect(Buffer.byteLength(site, 'utf8')).toBeGreaterThan(32768)
    expect(reject(site, 'site').message).toContain('32,768')
    const mid = `a{${'color:red;'.repeat(900)}}`
    expect(Buffer.byteLength(mid, 'utf8')).toBeGreaterThan(8192)
    expect(Buffer.byteLength(mid, 'utf8')).toBeLessThanOrEqual(32768)
    expect(sanitizeCss(mid, { scope: 'site', mode: 'check' })).toBe(mid)
  })

  it('rejects 201 rules and allows 200', () => {
    const one = '.a{color:red}'
    expect(reject(Array.from({ length: 201 }, () => `${one}/*${MARKER}*/`).join('')).message).toContain('200')
    allow(Array.from({ length: 200 }, () => one).join(''))
  })

  it('allows ordinary CSS, including scroll-behavior, and still fails closed on a comment', () => {
    allow('.wrap { padding-block: 4rem; scroll-behavior: smooth; position: fixed }')
    allow('@media (min-width: 40rem) { .a { color: red } }')
    allow('@supports (display: grid) { .a { color: red } }')
    allow('@container (min-width: 20rem) { .card { color: red } }')
    allow('@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .a { animation: fade 1s ease; animation-name: fade }')
    allow(`a { background: url(/media/med_00000000000000000000000001) }`)
    allow(`a { background: url(/media/med_00000000000000000000000001-1280.webp) }`)
    allow('a { background: url(data:image/png;base64,iVBORw0KGgo=) }')
    allow('a { background: url(data:image/svg+xml;base64,PHN2Zy8+) }')
    allow(':root { color: red }')
    allow('body .wrap { color: red }')
    allow('& { background: #f6f1ea }')
    allow('.a:is(.b, .c) { color: red }')
    allow('.a::before { content: "" }')
    allow('.a + .b { color: red }')
    reject(`/* just talking about @import ${MARKER} */ .a { color: red }`)
  })
})

describe('page documents keep optional css', () => {
  function page(css?: string) {
    const doc = emptyPageDoc('Hello')
    doc.blocks = [{ id: 'b_text1', type: 'RichText', v: 1, props: { content: richTextFromParagraphs(['Hello']) }, ...(css !== undefined ? { css } : {}) }]
    return doc
  }

  it('accepts a page with no css field', () => {
    const result = validatePageDoc(page(), registry, null)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc.blocks[0]).not.toHaveProperty('css')
  })

  it('drops whitespace and keeps the author text when it passes', () => {
    const blank = validatePageDoc(page('   \n'), registry, null)
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.doc.blocks[0]).not.toHaveProperty('css')
    const source = '& { background: #f6f1ea }'
    const kept = validatePageDoc(page(source), registry, null)
    expect(kept.ok).toBe(true)
    if (kept.ok) expect(kept.doc.blocks[0]?.css).toBe(source)
    const migrated = migratePageDoc(page(source), registry)
    expect(migrated.blocks[0]?.css).toBe(source)
  })

  it('reports the line and column and does not echo the source', () => {
    const result = validatePageDoc(page(`a { background: url(javascript:${MARKER}) }`), registry, null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('blocks.0.css')
      expect(result.issues[0]?.message).toMatch(/^Line \d+, column \d+:/)
      expect(result.issues[0]?.message).not.toContain(MARKER)
    }
  })
})

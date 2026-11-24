import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLE_ID, MISSING_PLUGIN_TEXT, THEME_CSS, renderPageHtml, type SiteRenderContext } from '../server/services/render'
import { PLUGIN_RENDER_UNSAFE, judgePluginHtml, testRenderPlugin } from '../server/services/plugins/render-check'
import { clearPluginRuntimes, type PluginBlockRuntime } from '../server/services/plugins/runtime'
import { defaultBrandDoc, validateBrandDoc } from '../shared/brand'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { runChecks } from '../shared/checks'
import { emptyPageDoc, type PageDoc } from '../shared/page'
import type { PluginBlock, PluginManifest } from '../shared/plugins/manifest'
import type { CompiledField } from '../shared/plugins/schema-subset'
import { compileTemplate } from '../shared/plugins/template'
import { richTextFromParagraphs } from '../shared/richtext'
import { IMG } from './helpers'

afterEach(() => {
  clearPluginRuntimes()
})

function site(overrides: Partial<SiteRenderContext> = {}): SiteRenderContext {
  return {
    name: 'Test charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: false,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: null,
    footer: null,
    banner: null,
    menus: {},
    pagesById: {},
    media: {},
    embeds: {},
    ...overrides,
  }
}

function render(doc: PageDoc, overrides: Partial<SiteRenderContext> = {}) {
  return renderPageHtml({ doc, pageId: 'pg_plugin', versionId: 'ver_plugin', path: '/plugin', site: site(overrides) })
}

function styleText(html: string): string {
  const start = html.indexOf('<style>')
  const end = html.indexOf('</style>')
  return html.slice(start + '<style>'.length, end)
}

function directive(csp: string, name: string): string {
  const part = csp.split('; ').find((item) => item.startsWith(`${name} `) || item === name)
  if (!part) throw new Error(`missing ${name}`)
  return part.replace(/;$/, '')
}

function runtime(source: string, fields: CompiledField[], over: Partial<PluginBlockRuntime> = {}, imageSlots?: Record<string, { width: number; height: number }>): PluginBlockRuntime {
  const { render: _render, ...rest } = over
  return {
    storedType: 'hello-note/Note',
    pluginId: 'hello-note',
    css: '',
    head: [],
    csp: { img: [], frame: [], connect: [], font: [] },
    settings: {},
    computed: rest.computed ?? [],
    render: compileTemplate(source, { fields, computed: rest.computed ?? [], imageSlots }),
    ...(imageSlots ? { imageSlots } : {}),
    ...rest,
  }
}

function pluginBlock(over: Partial<PluginBlock> = {}): PluginBlock {
  return {
    type: 'Note',
    v: 1,
    label: 'Note',
    category: 'Text',
    props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
    template: 'note.html',
    example: { heading: 'Hello' },
    computed: [],
    agent: { writable: false, describe: 'A note' },
    agentNever: [],
    money: false,
    ...over,
  }
}

function pluginManifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'hello-note',
    name: 'Hello note',
    version: '1.0.0',
    sitebuilder: '>=0.1.0 <0.2.0',
    permissions: ['blocks'],
    csp: { img: [], frame: [], script: [], connect: [], font: [] },
    head: [],
    blocks: [pluginBlock()],
    ...over,
  }
}

function archiveFiles(html: string, extra: { path: string; bytes: Buffer }[] = []) {
  return [{ path: 'note.html', bytes: Buffer.from(html) }, ...extra]
}

describe('plugin pages', () => {
  it('leaves a page with no plugin block byte-identical', async () => {
    const doc = emptyPageDoc('Plain')
    doc.blocks = [{ id: 'b_hero0001', type: 'Hero', v: 1, props: { heading: 'Stay', image: IMG } }]
    const noisy = runtime('<section>Plugin</section>', [], {
      css: '.note{color:#0a1b2c}',
      head: [{ tag: 'meta', name: 'theme-color', content: 'blue' }],
      csp: { img: ['https://images.example'], frame: ['https://frames.example'], connect: ['https://connect.example'], font: ['https://fonts.example'] },
    })
    const plain = await render(doc)
    const unused = await render(doc, { pluginBlocks: { 'hello-note/Note': noisy } })
    expect(unused.html).toBe(plain.html)
    expect(plain.html).not.toContain('data-sb-plugin')
    expect(plain.html).not.toContain('https://images.example')
    expect(plain.html).not.toContain('https://fonts.example')
    expect(directive(plain.csp, 'font-src')).toBe("font-src 'self'")
    expect(plain.deps.bundleId).toBe(BUNDLE_ID)
    expect(plain.deps.bundleId).toBe('theme-default-5')
  })

  it('emits plugin CSS once, before section CSS, and prefixes clip ids per section', async () => {
    const doc = emptyPageDoc('Tubes')
    doc.blocks = [
      { id: 'b_hero0001', type: 'Hero', v: 1, props: { heading: 'Stay', image: IMG } },
      { id: 'b_tube0001', type: 'hello-note/Note', v: 1, props: {}, css: '.wrap{color:#3c2b1a}' },
      { id: 'b_tube0002', type: 'hello-note/Note', v: 1, props: {} },
    ]
    const tube = '<svg viewBox="0 0 10 10"><clipPath id="tube"><rect width="10" height="10"></rect></clipPath><rect clip-path="url(#tube)" width="10" height="10"></rect></svg>'
    const block = runtime(tube, [], { css: '@keyframes fade{from{opacity:0}to{opacity:1}}.note{animation:fade 1s;color:#0a1b2c}' })
    const brand = validateBrandDoc({ ...defaultBrandDoc(), customCss: 'a.sitewide { color: #abcdef }' })
    expect(brand.ok).toBe(true)
    if (!brand.ok) return
    const rendered = await render(doc, { brand: brand.doc, pluginBlocks: { 'hello-note/Note': block } })
    const css = styleText(rendered.html)
    const pluginRule = '[data-sb-plugin="hello-note/Note"]'
    expect(css.startsWith(THEME_CSS)).toBe(true)
    expect(css.split(pluginRule).length - 1).toBe(1)
    expect(css).toContain('hello-note-note__fade')
    expect(css).toContain('#0a1b2c')
    expect(css.indexOf('a.sitewide')).toBeGreaterThanOrEqual(THEME_CSS.length)
    expect(css.indexOf(pluginRule)).toBeGreaterThan(css.indexOf('a.sitewide'))
    expect(css.indexOf('[data-sb-css="b_tube0001"]')).toBeGreaterThan(css.indexOf(pluginRule))
    expect(css).toContain('#3c2b1a')
    expect(css).not.toContain('[data-sb-css="b_tube0002"]')
    const body = rendered.html.slice(rendered.html.indexOf('<body'))
    expect(body.split('data-sb-plugin="hello-note/Note"').length - 1).toBe(2)
    expect(body).toContain('<h1>Stay</h1>')
    expect(body).toContain('url(#phello-note-note-b_tube0001-tube)')
    expect(body).toContain('url(#phello-note-note-b_tube0002-tube)')
    expect(directive(rendered.csp, 'font-src')).toBe("font-src 'self'")
    expect(directive(rendered.csp, 'script-src')).toBe("script-src 'self'")
    expect(rendered.deps.bundleId).toBe(BUNDLE_ID)
  })

  it('adds CSP origins and head tags only for a plugin the page uses', async () => {
    const doc = emptyPageDoc('Origins')
    const source = '<section><h2>{{heading}}</h2>{{link give}}{{link bad}}{{image photo}}{{richtext body}}</section>'
    const fields: CompiledField[] = [
      { name: 'heading', type: 'string' },
      { name: 'give', type: 'link' },
      { name: 'bad', type: 'link' },
      { name: 'photo', type: 'image' },
      { name: 'body', type: 'richtext' },
    ]
    const block = runtime(source, fields, {
      head: [
        { tag: 'meta', name: 'theme-color', content: '{{settings.tone}}' },
        { tag: 'meta', property: 'og:test', content: '{{settings.count}}' },
        { tag: 'link', rel: 'preconnect', href: 'https://images.example' },
      ],
      settings: { tone: 'sea <blue>', count: 4 },
      csp: { img: ['https://images.example'], frame: ['https://frames.example'], connect: ['https://connect.example'], font: ['https://fonts.example'] },
    }, { photo: { width: 640, height: 480 } })
    const props = {
      heading: '</style>',
      give: { label: 'Give today', href: '/give' },
      bad: { label: 'Do not show this label', href: 'javascript:MARKER' },
      photo: IMG,
      body: richTextFromParagraphs(['<script>']),
    }
    doc.blocks = [
      { id: 'b_note0001', type: 'hello-note/Note', v: 1, props },
      { id: 'b_note0002', type: 'hello-note/Note', v: 1, props },
    ]
    const rendered = await render(doc, { pluginBlocks: { 'hello-note/Note': block } })
    const html = rendered.html
    expect(html).toContain('&lt;/style&gt;')
    expect(html).toContain('<span>&lt;script&gt;</span>')
    expect(html).toContain('href="/give"')
    expect(html).toContain('Give today')
    expect(html).toContain('class="btn"')
    expect(html).not.toContain('Do not show this label')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('width="640"')
    expect(html).toContain(`/media/${IMG.media}`)
    expect(judgePluginHtml(html)).toEqual({ ok: true })
    const headAt = html.indexOf('<meta name="theme-color" content="sea &lt;blue&gt;">')
    const styleAt = html.indexOf('<style>')
    expect(headAt).toBeGreaterThan(0)
    expect(headAt).toBeLessThan(styleAt)
    expect(html).toContain('<meta property="og:test" content="">')
    expect(html).toContain('<link rel="preconnect" href="https://images.example">')
    expect(rendered.csp.split('https://images.example').length - 1).toBe(1)
    expect(rendered.csp.split('https://fonts.example').length - 1).toBe(1)
    expect(rendered.csp.split('https://frames.example').length - 1).toBe(1)
    expect(rendered.csp.split('https://connect.example').length - 1).toBe(1)
    expect(directive(rendered.csp, 'img-src')).toBe("img-src 'self' data: https://images.example")
    expect(directive(rendered.csp, 'font-src')).toBe("font-src 'self' https://fonts.example")
    expect(directive(rendered.csp, 'frame-src')).toBe('frame-src https://frames.example')
    expect(directive(rendered.csp, 'connect-src')).toBe("connect-src 'self' https://connect.example")
    expect(directive(rendered.csp, 'script-src')).toBe("script-src 'self'")
    const body = html.slice(html.toLowerCase().indexOf('<body'))
    expect(body.toLowerCase()).not.toContain('</style')
    expect(body.toLowerCase()).not.toContain('<script')
  })

  it('drops a missing plugin on publish and shows a note in preview', async () => {
    const doc = emptyPageDoc('Missing')
    doc.blocks = [{ id: 'b_miss0001', type: 'missing/Widget', v: 1, props: { heading: 'Secret heading' }, css: '.secret{color:#654321}' }]
    const published = await render(doc, { pluginBlocks: {} })
    expect(published.html).not.toContain('Secret heading')
    expect(published.html).not.toContain(MISSING_PLUGIN_TEXT)
    expect(published.html).not.toContain('#654321')
    expect(published.html).not.toContain('data-sb-plugin')
    expect(published.html).not.toContain('data-sb-css')
    const preview = await render(doc, { pluginBlocks: {}, preview: true })
    expect(preview.html).toContain(MISSING_PLUGIN_TEXT)
    expect(preview.html).toContain('data-block-id="b_miss0001"')
    expect(preview.html).not.toContain('Secret heading')
    expect(preview.html).not.toContain('#654321')
  })

  it('still refuses a core block whose type is misspelled', async () => {
    const doc = emptyPageDoc('Typo')
    doc.blocks = [{ id: 'b_hero0001', type: 'Herro', v: 1, props: { heading: 'Hi' } }]
    await expect(render(doc)).rejects.toThrow('Unknown section type "Herro" cannot be published.')
  })

  it('warns when a plugin section has no plugin, and does not block review', () => {
    const doc = emptyPageDoc('Missing')
    doc.blocks = [
      { id: 'b_miss0001', type: 'missing/Widget', v: 1, props: { heading: 'Secret heading' } },
      { id: 'b_hero0001', type: 'Hero', v: 1, props: { heading: 'Stay' } },
    ]
    const checks = runChecks(doc, createDefaultRegistry(), null)
    expect(checks.warnings).toContainEqual({ path: 'blocks.0.type', message: 'Plugin missing. This section is left out of the published page.' })
    expect(checks.blocking.some((issue) => issue.message === 'Plugin missing. This section is left out of the published page.')).toBe(false)
    expect(checks.warnings.some((issue) => issue.path === 'blocks.1.type')).toBe(false)
  })
})

describe('plugin install render check', () => {
  it('accepts escaped text and rejects HTML that would break the page', async () => {
    const ok = await testRenderPlugin({
      manifest: pluginManifest({ blocks: [pluginBlock({ example: { heading: '</style><script>' } })] }),
      files: archiveFiles('<section><p>{{heading}}</p></section>'),
    })
    expect(ok.ok).toBe(true)

    const extraStyle = '<!DOCTYPE html><html><head><style>a{}</style></head><body><p>MARKER</style</p></body></html>'
    expect(judgePluginHtml(extraStyle)).toEqual({ ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE })
    const scripted = '<!DOCTYPE html><html><head><style>a{}</style></head><body><script>MARKER</script></body></html>'
    expect(judgePluginHtml(scripted)).toEqual({ ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE })
    const clicked = '<!DOCTYPE html><html><head><style>a{}</style></head><body><div onclick="MARKER">x</div></body></html>'
    expect(judgePluginHtml(clicked)).toEqual({ ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE })
    const styled = '<!DOCTYPE html><html><head><style>a{}</style></head><body><div style="color:red">MARKER</div></body></html>'
    expect(judgePluginHtml(styled)).toEqual({ ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE })
    expect(PLUGIN_RENDER_UNSAFE).not.toContain('MARKER')
  })

  it('reports compile and CSS failures without echoing the source', async () => {
    const compiled = await testRenderPlugin({
      manifest: pluginManifest(),
      files: archiveFiles('<section><script>MARKER</script></section>'),
    })
    expect(compiled.ok).toBe(false)
    if (compiled.ok) return
    expect(compiled.path).toBe('note.html')
    expect(compiled.message).toMatch(/^Line \d+, column \d+: This tag is not allowed\.$/)
    expect(compiled.message).not.toContain('MARKER')
    expect(compiled.message).not.toContain('script')

    const missing = await testRenderPlugin({
      manifest: pluginManifest(),
      files: [{ path: 'other.html', bytes: Buffer.from('<section>Hi</section>') }],
    })
    expect(missing).toEqual({ ok: false, path: 'note.html', message: 'This file is not in the archive.' })

    const badText = await testRenderPlugin({
      manifest: pluginManifest(),
      files: [{ path: 'note.html', bytes: Buffer.from([0xff]) }],
    })
    expect(badText).toEqual({ ok: false, path: 'note.html', message: 'This template is not valid.' })

    const cssFile = pluginManifest({ blocks: [pluginBlock({ css: 'note.css' })] })
    const hostile = await testRenderPlugin({
      manifest: cssFile,
      files: archiveFiles('<section>Hello</section>', [{ path: 'note.css', bytes: Buffer.from('a{background:url(https://evil.example/MARKER)}') }]),
    })
    expect(hostile.ok).toBe(false)
    if (hostile.ok) return
    expect(hostile.path).toBe('note.css')
    expect(hostile.message).toMatch(/^Line \d+, column \d+: Only images from this site are allowed\.$/)
    expect(hostile.message).not.toContain('MARKER')
    expect(hostile.message).not.toContain('evil.example')
    expect(hostile.message).not.toContain('https://')

    const badCss = await testRenderPlugin({
      manifest: cssFile,
      files: archiveFiles('<section>Hello</section>', [{ path: 'note.css', bytes: Buffer.from([0xff]) }]),
    })
    expect(badCss).toEqual({ ok: false, path: 'note.css', message: 'This CSS file is not valid.' })

    const missingCss = await testRenderPlugin({
      manifest: cssFile,
      files: archiveFiles('<section>Hello</section>'),
    })
    expect(missingCss).toEqual({ ok: false, path: 'note.css', message: 'This file is not in the archive.' })

    const huge = `a{color:#112233}${'x'.repeat(9000)}`
    const sized = await testRenderPlugin({
      manifest: cssFile,
      files: archiveFiles('<section>Hello</section>', [{ path: 'note.css', bytes: Buffer.from(huge) }]),
    })
    expect(sized).toEqual({ ok: false, path: 'note.css', message: 'Line 1, column 1: Custom CSS is limited to 8,192 bytes.' })
  })

  it('rejects prefixed plugin CSS that exceeds the page reserve', async () => {
    const rules = Array.from({ length: 200 }, (_, i) => `.m${i}{color:#112233}`).join('')
    expect(Buffer.byteLength(rules, 'utf8')).toBeLessThanOrEqual(8192)
    const capped = await testRenderPlugin({
      manifest: pluginManifest({ blocks: [pluginBlock({ css: 'note.css' })] }),
      files: archiveFiles('<section>Hello</section>', [{ path: 'note.css', bytes: Buffer.from(rules) }]),
    })
    expect(capped.ok).toBe(false)
    if (capped.ok) return
    expect(capped.path).toBe('(render)')
    expect(capped.message).toBe("This page's plugin CSS is over the limit.")
    expect(capped.message).not.toContain('#112233')
  })
})

// Install-time render check. Compile templates, sanitise CSS, and draw one example block.
import { CssRejected, cssIssueMessage } from '../../../shared/css/sanitize'
import { sanitizeCss } from '../../../shared/css/sanitize'
import { emptyPageDoc } from '../../../shared/page'
import type { PluginBlock, PluginManifest } from '../../../shared/plugins/manifest'
import { compileObjectSchema } from '../../../shared/plugins/schema-subset'
import { compileTemplate, TemplateRejected, type TemplateSetting } from '../../../shared/plugins/template'
import type { SiteRenderContext } from '../render'
import { renderPageHtml } from '../render'
import type { PluginBlockRuntime } from './runtime'

export interface RenderCheckInput {
  manifest: PluginManifest
  files: { path: string; bytes: Buffer }[]
}

export const PLUGIN_RENDER_UNSAFE = 'This plugin cannot be shown safely.'

export type RenderCheckResult = { ok: true; blocks: PluginBlockRuntime[] } | { ok: false; path: string; message: string }

const PAGE_CAP = "This page's plugin CSS is over the limit."

export function judgePluginHtml(html: string): { ok: true } | { ok: false; path: '(render)'; message: string } {
  const lower = html.toLowerCase()
  if (lower.split('</style').length - 1 !== 1) return { ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE }
  const bodyAt = lower.indexOf('<body')
  const body = bodyAt >= 0 ? html.slice(bodyAt) : html
  if (/<script[\s>/]/i.test(body)) return { ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE }
  if (/\son[a-z0-9:-]*\s*=/i.test(body)) return { ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE }
  if (/\sstyle\s*=/i.test(body)) return { ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE }
  return { ok: true }
}

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function fileBytes(files: RenderCheckInput['files'], path: string): Buffer | null {
  return files.find((file) => file.path === path)?.bytes ?? null
}

function settingInfo(manifest: PluginManifest): { values: Record<string, unknown>; kinds: TemplateSetting[] } {
  const values: Record<string, unknown> = {}
  const kinds: TemplateSetting[] = []
  if (!manifest.settings) return { values, kinds }
  const compiled = compileObjectSchema(manifest.settings, { path: 'settings', mode: 'settings' })
  for (const field of compiled.settingsFields) {
    if (field.hasDefault) values[field.key] = field.defaultValue
  }
  const rawFields = manifest.settings && typeof manifest.settings === 'object' ? (manifest.settings as { fields?: unknown }).fields : undefined
  if (rawFields && typeof rawFields === 'object') {
    for (const [name, field] of Object.entries(rawFields)) {
      if (!field || typeof field !== 'object') continue
      const type = (field as { type?: unknown }).type
      if (type === 'string' || type === 'number' || type === 'boolean' || type === 'enum') kinds.push({ name, type })
    }
  }
  return { values, kinds }
}

function checkFailure(error: unknown, templatePath: string, cssPath: string | undefined): RenderCheckResult {
  if (error instanceof TemplateRejected) {
    return { ok: false, path: templatePath, message: `Line ${error.line}, column ${error.column}: ${error.message}` }
  }
  if (error instanceof CssRejected) {
    if (error.message === PAGE_CAP || error.message.startsWith('This page CSS is over')) {
      return { ok: false, path: '(render)', message: error.message }
    }
    return { ok: false, path: cssPath ?? '(css)', message: cssIssueMessage(error) }
  }
  return { ok: false, path: '(render)', message: PLUGIN_RENDER_UNSAFE }
}

function compileBlock(manifest: PluginManifest, block: PluginBlock, files: RenderCheckInput['files'], settings: ReturnType<typeof settingInfo>): RenderCheckResult | PluginBlockRuntime {
  const templateBytes = fileBytes(files, block.template)
  if (!templateBytes) return { ok: false, path: block.template, message: 'This file is not in the archive.' }
  const source = decodeUtf8(templateBytes)
  if (source === null) return { ok: false, path: block.template, message: 'This template is not valid.' }
  let css = ''
  if (block.css) {
    const cssBytes = fileBytes(files, block.css)
    if (!cssBytes) return { ok: false, path: block.css, message: 'This file is not in the archive.' }
    const cssText = decodeUtf8(cssBytes)
    if (cssText === null) return { ok: false, path: block.css, message: 'This CSS file is not valid.' }
    try {
      sanitizeCss(cssText, { scope: 'plugin', pluginType: `${manifest.id}/${block.type}`, mode: 'check' })
    } catch (error) {
      return checkFailure(error, block.template, block.css)
    }
    css = cssText
  }
  const compiled = compileObjectSchema(block.props, { path: 'props', mode: 'block' })
  if (!compiled.schema) return { ok: false, path: block.template, message: 'The plugin manifest is not valid.' }
  let render
  try {
    render = compileTemplate(source, { fields: compiled.fields, computed: block.computed, settings: settings.kinds, imageSlots: block.imageSlots })
  } catch (error) {
    return checkFailure(error, block.template, block.css)
  }
  return {
    storedType: `${manifest.id}/${block.type}`,
    pluginId: manifest.id,
    css,
    head: manifest.head,
    csp: { img: manifest.csp.img, frame: manifest.csp.frame, connect: manifest.csp.connect, font: manifest.csp.font },
    settings: settings.values,
    computed: block.computed,
    ...(block.imageSlots ? { imageSlots: block.imageSlots } : {}),
    render,
  }
}

function minimalSite(pluginBlocks: Record<string, PluginBlockRuntime>): SiteRenderContext {
  return {
    name: 'Plugin check',
    origin: 'https://example.org',
    titlePattern: '{page}',
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
    pluginBlocks,
  }
}

export async function testRenderPlugin(input: RenderCheckInput): Promise<RenderCheckResult> {
  const settings = settingInfo(input.manifest)
  const blocks: PluginBlockRuntime[] = []
  for (const block of input.manifest.blocks) {
    const built = compileBlock(input.manifest, block, input.files, settings)
    if ('ok' in built) return built
    const doc = emptyPageDoc('Plugin check')
    doc.blocks = [{ id: 'b_plugincheck1', type: built.storedType, v: block.v, props: block.example }]
    try {
      const rendered = await renderPageHtml({
        doc,
        pageId: 'pg_plugincheck',
        versionId: 'ver_plugincheck',
        path: '/plugin-check',
        site: minimalSite({ [built.storedType]: built }),
      })
      const verdict = judgePluginHtml(rendered.html)
      if (!verdict.ok) return verdict
    } catch (error) {
      return checkFailure(error, block.template, block.css)
    }
    blocks.push(built)
  }
  return { ok: true, blocks }
}

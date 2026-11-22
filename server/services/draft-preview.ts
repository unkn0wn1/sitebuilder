// Builder previews drawn by the real publish renderer (Spencer, 21 Nov 2026): the editor canvas and the approval
// preview show exactly the HTML a release would hold, with the live header, footer, menus and look, so they cannot
// drift from the published page. The HTML is adjusted only so it works inside the builder: photos and the page
// scripts come from signed-in builder routes, analytics and third-party scripts are left out, and sections carry
// their block id for click to select.
import { emptyPageDoc, migratePageDoc, type PageDoc } from '../../shared/page'
import { validateSitePartDoc, type BannerDoc, type FooterDoc, type HeaderDoc, type MenuDoc } from '../../shared/site-parts'
import type { ServiceCtx } from './context'
import { AppError } from './errors'
import { EMPTY_MANIFEST, currentRelease } from './publish'
import { loadPageDoc, loadSiteRenderContext, renderPageHtml } from './render'
import { requireSitePart } from './site-parts'

export const PREVIEW_MEDIA_PREFIX = '/api/v1/preview/media/'
export const PREVIEW_ASSET_PREFIX = '/api/v1/preview/assets/'
export const PREVIEW_ASSETS = ['embed.js'] as const

export async function renderDraftPreview(ctx: ServiceCtx, raw: unknown, opts: { pageId?: string; path?: string } = {}) {
  const doc: PageDoc = migratePageDoc(raw, ctx.registry)
  const manifest = structuredClone(currentRelease(ctx)?.manifest ?? EMPTY_MANIFEST)
  const path = opts.path || '/preview'
  const pageId = opts.pageId || 'pg_preview'
  // The page itself counts as live here, so links to it and "you are here" in menus work as they will.
  manifest.pages[pageId] = { versionId: 'ver_preview', path }
  const site = loadSiteRenderContext(ctx, manifest)
  site.preview = true
  site.tracking = { ga4: null, gtm: null, plausible: null, cookiebot: null }
  const rendered = await renderPageHtml({ doc, pageId, versionId: 'ver_preview', path, site })
  return { html: previewHtml(rendered.html, rendered.csp) }
}

/** Where a menu shows on the site, so its preview can say so (and show an unused menu in the header). */
export type MenuUse = 'header' | 'footer' | 'legal' | 'unused'

/**
 * A live page drawn with draft site parts swapped in: the header screen (header and top strip together), a menu or
 * the footer. Everything else is as published. Pages default to the home page, then the first live page.
 */
export async function renderSitePartPreview(ctx: ServiceCtx, input: { parts: { partId: string; doc: unknown }[]; pageId?: string }) {
  const manifest = structuredClone(currentRelease(ctx)?.manifest ?? EMPTY_MANIFEST)
  const overrides = input.parts.map(({ partId, doc }) => {
    const part = requireSitePart(ctx, partId)
    const valid = validateSitePartDoc(part.kind, doc)
    if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]?.message ?? 'This can not be drawn yet.', valid.issues)
    return { part, doc: valid.doc }
  })

  const live = Object.entries(manifest.pages)
  const chosen = (input.pageId && manifest.pages[input.pageId] ? input.pageId : null) ?? live.find(([, e]) => e.path === '/')?.[0] ?? live[0]?.[0] ?? null
  let pageId = 'pg_preview'
  let path = '/preview'
  let doc: PageDoc
  if (chosen) {
    pageId = chosen
    path = manifest.pages[chosen]!.path
    doc = loadPageDoc(ctx, manifest.pages[chosen]!.versionId)
  } else {
    doc = emptyPageDoc('Preview')
    manifest.pages[pageId] = { versionId: 'ver_preview', path }
  }

  const site = loadSiteRenderContext(ctx, manifest)
  site.preview = true
  site.tracking = { ga4: null, gtm: null, plausible: null, cookiebot: null }
  let menuUse: MenuUse | undefined
  for (const { part, doc: partDoc } of overrides) {
    if (part.kind === 'header') site.header = { id: part.id, doc: partDoc as HeaderDoc }
    else if (part.kind === 'footer') site.footer = { id: part.id, doc: partDoc as FooterDoc }
    else if (part.kind === 'banner') site.banner = { id: part.id, doc: partDoc as BannerDoc }
    else site.menus[part.key] = { id: part.id, doc: partDoc as MenuDoc }
  }
  const menu = overrides.find((o) => o.part.kind === 'menu')
  if (menu) {
    const key = menu.part.key
    menuUse = site.header?.doc.menuKey === key ? 'header' : site.footer?.doc.linksMenuKey === key ? 'footer' : site.footer?.doc.legalMenuKey === key ? 'legal' : 'unused'
    // A menu nothing uses yet is shown in the header, so there is something to look at.
    if (menuUse === 'unused' && site.header) site.header = { ...site.header, doc: { ...site.header.doc, menuKey: key } }
  }
  const rendered = await renderPageHtml({ doc, pageId, versionId: 'ver_preview', path, site })
  return { html: previewHtml(rendered.html, rendered.csp), page: chosen ? { id: chosen, path } : null, menuUse }
}

/** Point photos and scripts at builder routes and tighten the CSP for use inside the builder. */
export function previewHtml(html: string, csp: string): string {
  const policy = previewCsp(csp)
  return html
    .replace(/(["'(\s,])\/media\//g, `$1${PREVIEW_MEDIA_PREFIX}`)
    .replace(/src="\/(embed)\.js"/g, (_m, name: string) => `src="${PREVIEW_ASSET_PREFIX}${name}.js"`)
    .replace(/<script src="\/analytics\.js"[^>]*><\/script>/g, '')
    .replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}">`)
}

/** Only the builder's own scripts run in a preview, it talks to nothing, and it frames nothing. */
export function previewCsp(csp: string): string {
  const out = csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !/^(script-src|style-src|connect-src|frame-src|frame-ancestors|form-action)\b/.test(d))
  // Inline styles let the builder outline the selected and changed sections. Scripts stay limited to the builder's own.
  out.push(`script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'`)
  return out.join('; ') + ';'
}

// Builder previews drawn by the real publish renderer (Spencer, 21 Nov 2026): the editor canvas and the approval
// preview show exactly the HTML a release would hold, with the live header, footer, menus and look, so they cannot
// drift from the published page. The HTML is adjusted only so it works inside the builder: photos and the page
// scripts come from signed-in builder routes, analytics and third-party scripts are left out, and sections carry
// their block id for click to select.
import { migratePageDoc, type PageDoc } from '../../shared/page'
import type { ServiceCtx } from './context'
import { EMPTY_MANIFEST, currentRelease } from './publish'
import { loadSiteRenderContext, renderPageHtml } from './render'

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

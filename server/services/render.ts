// Public-site renderer: Vue's server renderer turns a page document and the site shell
// into static HTML. Theme CSS is inlined (spike 001). Each page records a dependency map
// and a Content-Security-Policy. This is the hand-written v1 render bundle; a Vite compile
// step can replace the block components later (ADR 0004).
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { cloneVNode, createSSRApp, defineComponent, h, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { sanitizeBadgeHtml } from '../../shared/badge-html'
import { CssRejected, sanitizeCss, STYLE_MAX_BYTES } from '../../shared/css/sanitize'
import { formatMoney, hasEnded, progressPercent, endOfUtcDay } from '../../shared/amounts'
import { virtuousPrefill } from '../../shared/donate-prefill'
import type { ImageRef } from '../../shared/blocks/define'
import type { StoredBlock } from '../../shared/blocks/registry'
import { migratePageDoc, type PageDoc } from '../../shared/page'
import type { RichTextDoc, TextNode } from '../../shared/richtext'
import {
  migrateSitePartDoc,
  type BannerDoc,
  type FooterDoc,
  type HeaderDoc,
  type LinkTarget,
  type MenuDoc,
  type SitePartKind,
} from '../../shared/site-parts'
import { BUNDLE_ID, EMBED_JS, HEADER_JS, THEME_CSS } from '../theme/default'
import { migrateBrandDoc, validateBrandDoc, type BrandDoc } from '../../shared/brand'
import { BANNER_ACCENT_CSS, FOOTER_COLUMNS_CSS, HEART_CSS, OVER_HERO_CSS, TILE_CSS, UTILITY_CSS, brandChromeCss, themeCssFromTokens } from '../../shared/theme-css'
import { embeds, media, mediaCrops, pages, redirects, siteParts, sites, versions, type ReleaseManifest } from '../db/schema'
import type { ServiceCtx } from './context'
import { widthsFor } from './media'
import { readSettings, type SiteSettings } from '../../shared/settings'
import { renderRobotsTxt } from '../../shared/robots'
import { aliasesFromRedirects, pageIdByPath, pageIdForHref, pathForPageId } from '../../shared/internal-links'

export { BUNDLE_ID, EMBED_JS, HEADER_JS, THEME_CSS }

export function styleHash(css: string = THEME_CSS): string {
  return `'sha256-${createHash('sha256').update(css).digest('base64')}'`
}
export const STYLE_HASH = styleHash(THEME_CSS)

const VIRTUOUS_SCRIPT = 'https://cdn.virtuoussoftware.com/virtuous.embed.min.js'
const DEFAULT_WIDTHS = [320, 640, 960, 1280]

export interface PageDependencies {
  pageId: string
  versionId: string
  path: string
  bundleId: string
  siteParts: string[]
  media: string[]
  links: string[]
  linkedPageIds: string[]
}

export interface RenderedPage {
  html: string
  deps: PageDependencies
  csp: string
  cacheTags: string[]
}

export interface MediaCatalogEntry {
  id: string
  width: number | null
  height: number | null
  alt: string | null
  decorative: boolean
  status: string
  kind: string
  mime: string
  cropRatios: string[]
  /** Width of the approved crop for each ratio. Crop renditions are made up to this width, not the original's. */
  cropWidths?: Record<string, number>
}

export interface EmbedCatalogEntry {
  id: string
  provider: string
  name: string
  config: Record<string, unknown>
}

export interface ResolvedLink {
  href: string
  label: string
  pageId?: string
}

export interface SiteRenderContext {
  name: string
  origin: string | null
  titlePattern: string
  allowIndexing: boolean
  robotsTxt?: string | null
  defaultSocialImage: string | null
  tracking: SiteSettings['tracking']
  header: { id: string; doc: HeaderDoc } | null
  footer: { id: string; doc: FooterDoc } | null
  banner: { id: string; doc: BannerDoc } | null
  brand?: BrandDoc | null
  themeCss?: string
  menus: Record<string, { id: string; doc: MenuDoc }>
  pagesById: Record<string, { path: string; title: string }>
  /** Former paths of pages that have moved, so stored hrefs still resolve to the live address. */
  pathAliases?: Map<string, string>
  media: Record<string, MediaCatalogEntry>
  /** True when `media` is the whole library (the real site). Then a photo or video that is not in it is left out
   * instead of published as a broken image (a sample placeholder, or a deleted file). */
  mediaComplete?: boolean
  /** Builder preview of a draft: sections carry data-block-id, a missing photo shows a placeholder, and a section
   * that cannot be drawn shows a note instead of failing the whole page. Never set for a release. */
  preview?: boolean
  embeds: Record<string, EmbedCatalogEntry>
}

interface Collector {
  media: Set<string>
  links: Set<string>
  linkedPageIds: Set<string>
  siteParts: Set<string>
  scriptSrcs: Set<string>
  frameSrcs: Set<string>
  imgSrcs: Set<string>
  connectSrcs: Set<string>
  needsEmbedJs: boolean
  needsHeaderJs: boolean
  pageIdByPath: Map<string, string>
  origin: string | null
  aliases: Map<string, string>
}

function newCollector(site: SiteRenderContext): Collector {
  return { media: new Set(), links: new Set(), linkedPageIds: new Set(), siteParts: new Set(), scriptSrcs: new Set(), frameSrcs: new Set(), imgSrcs: new Set(), connectSrcs: new Set(), needsEmbedJs: false, needsHeaderJs: false, pageIdByPath: pageIdByPath(site.pagesById), origin: site.origin, aliases: site.pathAliases ?? new Map() }
}

/** Record an internal target and return the href that should be written (the live path, if known). */
function resolvedHref(href: string, bag: Collector): string {
  bag.links.add(href)
  const id = pageIdForHref(href, bag.pageIdByPath, bag.origin, bag.aliases)
  if (!id) return href
  bag.linkedPageIds.add(id)
  return pathForPageId(bag.pageIdByPath, id) ?? href
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function htmlPathFor(sitePath: string): string {
  if (sitePath === '/') return 'index.html'
  return `${sitePath.replace(/^\//, '').replace(/\/+$/, '')}/index.html`
}

export function publicUrl(origin: string | null, path: string): string {
  if (!origin) return path
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function applyTitlePattern(pattern: string, page: string, site: string): string {
  return pattern.replaceAll('{page}', page).replaceAll('{site}', site)
}

export function resolveLink(target: LinkTarget, label: string, site: SiteRenderContext, bag: Collector): ResolvedLink {
  if (target.type === 'url') {
    return { href: resolvedHref(target.url, bag), label }
  }
  bag.linkedPageIds.add(target.pageId)
  const page = site.pagesById[target.pageId]
  const href = page?.path ?? '#'
  bag.links.add(href)
  return { href, label, pageId: target.pageId }
}

function textNodes(nodes: TextNode[] | undefined, bag: Collector): VNode[] {
  return (nodes ?? []).map((n) => {
    let child: VNode | string = n.text
    for (const mark of n.marks ?? []) {
      if (mark.type === 'bold') child = h('strong', [child])
      else if (mark.type === 'italic') child = h('em', [child])
      else if (mark.type === 'link') {
        child = h('a', { href: resolvedHref(mark.href, bag) }, [child])
      }
    }
    return typeof child === 'string' ? h('span', child) : child
  })
}

function renderRichText(doc: RichTextDoc | null | undefined, bag: Collector): VNode[] {
  if (!doc) return []
  return doc.content.map((node) => {
    if (node.type === 'paragraph') return h('p', textNodes(node.content, bag))
    if (node.type === 'heading') return h(`h${node.level}`, textNodes(node.content, bag))
    const tag = node.type === 'orderedList' ? 'ol' : 'ul'
    return h(tag, node.content.map((item) => h('li', item.content.map((p) => h('p', textNodes(p.content, bag))))))
  })
}

function ratioKey(ratio: string): string {
  return ratio.replace(':', 'x')
}

function widthsForMedia(entry: MediaCatalogEntry | undefined, cropRatio?: string | null): number[] {
  const cropWidth = cropRatio ? entry?.cropWidths?.[cropRatio] : undefined
  if (cropWidth) return widthsFor(cropWidth)
  if (entry?.width) return widthsFor(entry.width)
  return [...DEFAULT_WIDTHS]
}

export function pictureVNode(
  image: ImageRef | undefined,
  site: SiteRenderContext,
  bag: Collector,
  opts: { slot?: { width: number; height: number }; eager?: boolean; class?: string },
): VNode | null {
  if (!image) return null
  const entry = site.media[image.media]
  if (!entry && site.preview) return h('img', { class: opts.class, src: previewPlaceholder(image.media), alt: image.alt ?? '', width: opts.slot?.width, height: opts.slot?.height, 'data-sample-photo': '' })
  if (!entry && site.mediaComplete) return null
  bag.media.add(image.media)
  if (entry?.kind === 'svg' || entry?.mime === 'image/svg+xml') {
    const alt = image.decorative || entry?.decorative ? '' : (image.alt ?? entry?.alt ?? '')
    const width = opts.slot?.width ?? entry?.width ?? undefined
    const height = opts.slot?.height ?? entry?.height ?? undefined
    return h('img', {
      class: opts.class,
      src: `/media/${image.media}.svg`,
      alt,
      width,
      height,
      loading: opts.eager ? 'eager' : 'lazy',
      decoding: 'async',
      fetchpriority: opts.eager ? 'high' : undefined,
    })
  }
  const ratio = opts.slot && opts.slot.height ? ratioFor(opts.slot.width, opts.slot.height) : null
  const useCrop = ratio && entry?.cropRatios.includes(ratio)
  const base = useCrop ? `${image.media}-${ratioKey(ratio!)}` : image.media
  const widths = widthsForMedia(entry, useCrop ? ratio : null)
  const avif = widths.map((w) => `/media/${base}-${w}.avif ${w}w`).join(', ')
  const webp = widths.map((w) => `/media/${base}-${w}.webp ${w}w`).join(', ')
  const fallbackW = widths.includes(1280) ? 1280 : widths[widths.length - 1]!
  const alt = image.decorative || entry?.decorative ? '' : (image.alt ?? entry?.alt ?? '')
  const width = opts.slot?.width ?? entry?.width ?? fallbackW
  const height = opts.slot?.height ?? entry?.height ?? undefined
  return h('picture', { class: opts.class }, [
    h('source', { type: 'image/avif', srcset: avif, sizes: '100vw' }),
    h('source', { type: 'image/webp', srcset: webp, sizes: '100vw' }),
    h('img', {
      src: `/media/${base}-${fallbackW}.webp`,
      alt,
      width,
      height,
      loading: opts.eager ? 'eager' : 'lazy',
      decoding: 'async',
      fetchpriority: opts.eager ? 'high' : undefined,
    }),
  ])
}

function ratioFor(width: number, height: number): string {
  const g = gcd(width, height)
  return `${width / g}:${height / g}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function linkButton(link: { label: string; href: string } | undefined, bag: Collector, className = 'btn'): VNode | null {
  if (!link) return null
  return h('a', { class: className, href: resolvedHref(link.href, bag) }, link.label)
}

const SAMPLE_ID = 'med_00000000000000000000000001'

/** What a builder preview shows where a photo is not in the library: the sample photo of a new section, or a lost one. */
export function previewPlaceholder(mediaId: string): string {
  const [line1, line2] = mediaId === SAMPLE_ID ? ['Sample photo', 'Choose one in the panel'] : ['Photo not found', 'Choose another in the panel']
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><rect width="960" height="720" fill="#e5e7eb"/><rect x="24" y="24" width="912" height="672" fill="none" stroke="#9ca3af" stroke-width="4" stroke-dasharray="16 12"/><text x="480" y="350" font-family="system-ui,sans-serif" font-size="44" fill="#374151" text-anchor="middle">${line1}</text><text x="480" y="410" font-family="system-ui,sans-serif" font-size="30" fill="#4b5563" text-anchor="middle">${line2}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function authoredCss(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : ''
}

function emitSectionCss(block: StoredBlock): string {
  const css = authoredCss(block.css)
  if (!css) return ''
  return sanitizeCss(css, { scope: 'section', sectionId: block.id, mode: 'emit' })
}

function emitSiteCss(brand: SiteRenderContext['brand']): string {
  if (!brand) return ''
  const css = authoredCss(brand.customCss)
  if (!css) return ''
  return sanitizeCss(css, { scope: 'site', mode: 'emit' })
}

/** The attribute is added only when this section has CSS, so pages without it stay byte-identical. */
function withSectionCss(block: StoredBlock, vnode: VNode): VNode {
  if (!authoredCss(block.css)) return vnode
  const attrs = { 'data-sb-css': block.id }
  if (vnode && typeof vnode.type === 'string') return cloneVNode(vnode, attrs)
  return h('div', attrs, [vnode])
}

/** In a builder preview, mark each section with its block id (for click to select), and never let one bad section
 * stop the page from drawing. */
function previewBlock(block: StoredBlock, draw: () => VNode): VNode {
  let vnode: VNode
  try {
    vnode = draw()
  } catch {
    vnode = h('section', { class: 'section' }, [h('div', { class: 'wrap' }, [h('p', `This ${block.type} section can't be shown until the problems in the panel on the right are fixed.`)])])
  }
  if (vnode && typeof vnode.type === 'string') return cloneVNode(vnode, { 'data-block-id': block.id })
  return h('div', { 'data-block-id': block.id }, [vnode])
}

function wrapSection(children: VNode | null | Array<VNode | null>, className = 'section'): VNode {
  return h('section', { class: className }, [h('div', { class: 'wrap' }, Array.isArray(children) ? children : [children])])
}

function renderBlock(block: StoredBlock, site: SiteRenderContext, bag: Collector, firstHero: boolean): VNode {
  const p = block.props as Record<string, unknown>
  switch (block.type) {
    case 'Hero':
      return h('section', { class: 'hero', 'aria-label': String(p.heading ?? '') }, [
        pictureVNode(p.image as ImageRef | undefined, site, bag, { slot: { width: 1280, height: 720 }, eager: firstHero, class: 'hero-media' }),
        h('div', { class: 'hero-inner' }, [
          h('h1', String(p.heading ?? '')),
          p.subheading ? h('p', String(p.subheading)) : null,
          linkButton(p.cta as { label: string; href: string } | undefined, bag),
        ]),
      ])
    case 'VideoHero': {
      const videoId = typeof p.video === 'string' ? p.video : ''
      if (videoId && (site.media[videoId] || !site.mediaComplete)) bag.media.add(videoId)
      const clip = videoId ? site.media[videoId] : undefined
      const playVideo = !!videoId && (!!clip || !site.mediaComplete)
      const ext = clip?.mime === 'video/webm' ? 'webm' : 'mp4'
      const mime = clip?.mime === 'video/webm' ? 'video/webm' : 'video/mp4'
      return h('section', { class: 'hero', 'aria-label': String(p.heading ?? '') }, [
        pictureVNode(p.poster as ImageRef | undefined, site, bag, { slot: { width: 1280, height: 720 }, eager: firstHero, class: 'hero-media' }),
        playVideo
          ? h('video', { class: 'hero-video', autoplay: true, muted: true, loop: true, playsinline: true, preload: 'none', 'aria-hidden': 'true' }, [
              h('source', { src: `/media/${videoId}.${ext}`, type: mime, media: '(min-width: 641px)' }),
            ])
          : null,
        h('div', { class: 'hero-inner' }, [
          h('h1', String(p.heading ?? '')),
          p.subheading ? h('p', String(p.subheading)) : null,
          linkButton(p.cta as { label: string; href: string } | undefined, bag),
        ]),
      ])
    }
    case 'RichText':
      return wrapSection([h('div', { class: 'prose' }, renderRichText(p.content as RichTextDoc, bag))])
    case 'TextAndImage': {
      const layout = p.layout === 'image-left' ? 'split split-image-left' : 'split'
      return wrapSection(
        h('div', { class: layout }, [
          h('div', { class: 'split-copy prose' }, [
            p.heading ? h('h2', String(p.heading)) : null,
            ...renderRichText(p.content as RichTextDoc, bag),
          ]),
          pictureVNode(p.image as ImageRef | undefined, site, bag, { slot: { width: 960, height: 720 } }),
        ]),
      )
    }
    case 'Image':
      return wrapSection(
        h('figure', { class: 'figure' }, [
          pictureVNode(p.image as ImageRef | undefined, site, bag, { slot: { width: 1280, height: 853 } }),
          p.caption ? h('figcaption', String(p.caption)) : null,
        ]),
      )
    case 'Gallery': {
      const images = (p.images as ImageRef[] | undefined) ?? []
      return wrapSection([
        p.heading ? h('h2', String(p.heading)) : null,
        h('div', { class: 'gallery' }, images.map((img) => pictureVNode(img, site, bag, { slot: { width: 800, height: 800 } }))),
      ])
    }
    case 'Quote':
      return wrapSection(
        h('blockquote', { class: 'quote' }, [h('p', String(p.text ?? '')), p.attribution ? h('footer', String(p.attribution)) : null]),
      )
    case 'Stats': {
      const items = (p.items as { value: string; label: string }[] | undefined) ?? []
      return wrapSection([
        p.heading ? h('h2', String(p.heading)) : null,
        h('div', { class: 'stats' }, items.map((item) => h('div', [h('span', { class: 'stat-value' }, item.value), h('span', { class: 'stat-label' }, item.label)]))),
      ])
    }
    case 'CardGrid': {
      const cards = (p.cards as { title: string; text?: string; image?: ImageRef; link?: { label: string; href: string } }[] | undefined) ?? []
      return wrapSection([
        p.heading ? h('h2', String(p.heading)) : null,
        h(
          'div',
          { class: 'cards' },
          cards.map((card) =>
            h('article', { class: 'card' }, [
              pictureVNode(card.image, site, bag, { slot: { width: 640, height: 480 } }),
              h('div', { class: 'card-body' }, [
                h('h3', card.title),
                card.text ? h('p', card.text) : null,
                linkButton(card.link, bag),
              ]),
            ]),
          ),
        ),
      ])
    }
    case 'CallToAction':
      return h('section', { class: `cta-band tone-${String(p.tone ?? 'accent')}` }, [
        h('div', { class: 'wrap' }, [
          h('h2', String(p.heading ?? '')),
          p.text ? h('p', String(p.text)) : null,
          linkButton(p.button as { label: string; href: string } | undefined, bag),
        ]),
      ])
    case 'FAQ': {
      const items = (p.items as { question: string; answer: RichTextDoc }[] | undefined) ?? []
      return wrapSection([
        p.heading ? h('h2', String(p.heading)) : null,
        h(
          'div',
          { class: 'faq' },
          items.map((item) => h('details', [h('summary', item.question), h('div', { class: 'prose' }, renderRichText(item.answer, bag))])),
        ),
      ])
    }
    case 'DonationEmbed':
    case 'Embed':
      return renderEmbed(block.type, p, site, bag)
    case 'ImpactTiers':
      return renderImpactTiers(p, site, bag)
    case 'DonationProgress':
      return renderDonationProgress(p, bag)
    case 'MatchBanner':
      return renderMatchBanner(p, bag)
    case 'StoryBeforeAfter':
      return renderStoryBeforeAfter(p, site, bag)
    case 'TrustStrip':
      return renderTrustStrip(p, site, bag)
    default:
      throw new Error(`Unknown section type "${block.type}" cannot be published.`)
  }
}


function asLink(value: unknown): { label: string; href: string } | undefined {
  if (value && typeof value === 'object' && 'label' in value && 'href' in value) {
    const link = value as { label: string; href: string }
    if (link.label && link.href) return link
  }
  return undefined
}

function addCspOrigin(set: Set<string>, src: string) {
  try {
    const url = new URL(src)
    set.add(`${url.protocol}//${url.host}`)
  } catch {
    /* ignore */
  }
}

function applyBadgeHtml(raw: string, bag: Collector): string {
  const sanitized = sanitizeBadgeHtml(raw)
  for (const src of sanitized.scriptSrcs) {
    bag.scriptSrcs.add(src)
    addCspOrigin(bag.connectSrcs, src)
  }
  for (const src of sanitized.imgSrcs) addCspOrigin(bag.imgSrcs, src)
  for (const src of sanitized.frameSrcs) addCspOrigin(bag.frameSrcs, src)
  return sanitized.html
}

function frequencyLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value === 'once') return 'One-time'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function renderImpactTiers(p: Record<string, unknown>, site: SiteRenderContext, bag: Collector): VNode {
  const items = (p.items as { amount: string; title?: string; explanation?: string; frequency?: string; image?: ImageRef }[] | undefined) ?? []
  bag.needsEmbedJs = true
  return wrapSection([
    p.heading ? h('h2', String(p.heading)) : null,
    p.intro ? h('p', { class: 'lede' }, String(p.intro)) : null,
    h(
      'div',
      { class: 'tiers' },
      items.map((item) => {
        const prefill = virtuousPrefill({ amount: item.amount, frequency: item.frequency, label: item.amount })
        const attrs: Record<string, string> = { class: 'tier-give', href: '#donate' }
        if (prefill.amount) attrs['data-donate-amount'] = prefill.amount
        if (prefill.frequency) attrs['data-donate-frequency'] = prefill.frequency
        if (prefill.label) attrs['data-donate-label'] = prefill.label
        return h('article', { class: 'tier' }, [
          h('a', attrs, [
            pictureVNode(item.image, site, bag, { slot: { width: 640, height: 480 } }),
            h('div', { class: 'tier-body' }, [
              h('p', { class: 'tier-amount' }, item.amount),
              item.title ? h('h3', item.title) : null,
              item.explanation ? h('p', item.explanation) : null,
              prefill.frequency ? h('p', { class: 'tier-frequency' }, frequencyLabel(prefill.frequency) ?? prefill.frequency) : null,
            ]),
          ]),
        ])
      }),
    ),
    p.otherAmount ? h('p', { class: 'tier-other' }, [h('a', { class: 'tier-give', href: '#donate' }, String(p.otherAmount))]) : null,
    linkButton(asLink(p.cta), bag),
  ])
}

function renderDonationProgress(p: Record<string, unknown>, bag: Collector): VNode {
  const raised = String(p.raised ?? '')
  const goal = String(p.goal ?? '')
  const currency = typeof p.currency === 'string' ? p.currency : ''
  const percent = progressPercent(raised, goal)
  const raisedLabel = formatMoney(currency, raised)
  const goalLabel = formatMoney(currency, goal)
  const label = typeof p.label === 'string' && p.label ? p.label : 'raised so far'
  return wrapSection([
    p.heading ? h('h2', String(p.heading)) : null,
    percent !== null
      ? h('progress', { class: 'goal-progress', max: 100, value: percent, 'aria-label': `${percent}% of the goal` }, `${percent}%`)
      : null,
    h('p', { class: 'progress-meta' }, `${raisedLabel} ${label} of ${goalLabel}`),
    p.matchLine ? h('p', { class: 'progress-match' }, String(p.matchLine)) : null,
    p.endDate ? h('p', { class: 'progress-date' }, `Until ${String(p.endDate)}`) : null,
    linkButton(asLink(p.cta), bag),
  ])
}

function renderMatchBanner(p: Record<string, unknown>, bag: Collector): VNode {
  const endDate = typeof p.endDate === 'string' ? p.endDate : undefined
  const hideWhenPassed = p.hideWhenPassed !== false
  if (endDate && hideWhenPassed && hasEnded(endDate)) {
    return h('section', { class: 'match-banner is-ended', hidden: true, 'aria-hidden': 'true' })
  }
  const end = endDate ? endOfUtcDay(endDate) : null
  if (end) bag.needsEmbedJs = true
  const toneName = String(p.tone ?? 'neutral')
  return h('section', { class: `match-banner tone-${toneName}`, 'data-countdown': end ? end.toISOString() : undefined, 'data-hide-when-passed': end && hideWhenPassed ? 'true' : undefined }, [
    h('div', { class: 'wrap' }, [
      h('p', { class: 'match-message' }, String(p.message ?? '')),
      p.matchLine ? h('p', { class: 'match-line' }, String(p.matchLine)) : null,
      endDate ? h('p', { class: 'match-countdown' }, [h('time', { datetime: endDate, 'data-countdown-label': 'true' }, `Until ${endDate}`)]) : null,
      linkButton(asLink(p.cta), bag),
    ]),
  ])
}

function renderStoryBeforeAfter(p: Record<string, unknown>, site: SiteRenderContext, bag: Collector): VNode {
  return wrapSection([
    p.eyebrow ? h('p', { class: 'eyebrow' }, String(p.eyebrow)) : null,
    p.heading ? h('h2', String(p.heading)) : null,
    h('div', { class: 'prose' }, renderRichText(p.content as RichTextDoc, bag)),
    h('div', { class: 'before-after' }, [
      h('figure', [pictureVNode(p.before as ImageRef | undefined, site, bag, { slot: { width: 960, height: 720 } }), h('figcaption', String(p.beforeCaption ?? 'Before'))]),
      h('figure', [pictureVNode(p.after as ImageRef | undefined, site, bag, { slot: { width: 960, height: 720 } }), h('figcaption', String(p.afterCaption ?? 'After'))]),
    ]),
    p.quote ? h('blockquote', { class: 'quote' }, [h('p', String(p.quote)), p.attribution ? h('footer', String(p.attribution)) : null]) : null,
    linkButton(asLink(p.cta), bag),
  ])
}

interface TrustItem {
  name: string
  logo?: ImageRef
  note?: string
  href?: string
  badgeHtml?: string
  group?: string
}

function renderTrustStrip(p: Record<string, unknown>, site: SiteRenderContext, bag: Collector): VNode {
  const items = (p.items as TrustItem[] | undefined) ?? []
  const groups: { label: string; items: TrustItem[] }[] = []
  for (const item of items) {
    const label = item.group?.trim() ?? ''
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return wrapSection([
    p.eyebrow ? h('p', { class: 'eyebrow' }, String(p.eyebrow)) : null,
    p.heading ? h('h2', String(p.heading)) : null,
    p.intro ? h('p', { class: 'lede' }, String(p.intro)) : null,
    h(
      'div',
      { class: 'trust-groups' },
      groups.map((group) =>
        h('div', { class: 'trust-group' }, [
          group.label ? h('h3', { class: 'trust-group-label' }, group.label) : null,
          h(
            'ul',
            { class: 'trust-strip' },
            group.items.map((item) => {
              const badge = item.badgeHtml ? applyBadgeHtml(item.badgeHtml, bag) : ''
              const logo = pictureVNode(item.logo, site, bag, { class: 'trust-logo' })
              const inner: Array<VNode | string | null> = [
                badge ? h('div', { class: 'trust-badge', innerHTML: badge }) : null,
                logo,
                h('span', { class: 'trust-name' }, item.name),
                item.note ? h('span', { class: 'trust-note' }, item.note) : null,
              ]
              const children = inner.filter(Boolean)
              return h('li', { class: 'trust-item' }, [
                item.href && !badge ? h('a', { href: resolvedHref(item.href, bag), class: 'trust-link' }, children) : children,
              ])
            }),
          ),
        ]),
      ),
    ),
  ])
}

function renderEmbed(type: string, p: Record<string, unknown>, site: SiteRenderContext, bag: Collector): VNode {
  const id = String(p.embed ?? '')
  const embed = site.embeds[id]
  const heading = p.heading ? h('h2', String(p.heading)) : p.title ? h('h2', String(p.title)) : null
  const anchor = typeof p.anchor === 'string' ? p.anchor : undefined
  if (!embed) {
    return h('section', { class: type === 'DonationEmbed' ? 'donate' : 'embed', id: anchor }, [
      h('div', { class: 'wrap' }, [heading, h('p', { class: 'embed-fallback' }, 'This form is not available.')]),
    ])
  }
  if (embed.provider === 'virtuous') {
    bag.needsEmbedJs = true
    bag.scriptSrcs.add(VIRTUOUS_SCRIPT)
    const formId = String(embed.config.formId ?? '')
    return h('section', { class: 'donate', id: anchor }, [
      h('div', { class: 'wrap' }, [
        heading,
        h('div', { class: 'donate-box', 'data-embed': 'virtuous', 'data-src': VIRTUOUS_SCRIPT, 'data-vform': formId }, [
          h('p', { class: 'donate-prefill-hint', hidden: true, 'data-donate-hint': 'true' }),
          h('p', { class: 'embed-fallback' }, 'The donation form loads here when the page is live.'),
        ]),
      ]),
    ])
  }
  const src = embedSrc(embed)
  if (src) {
    const url = new URL(src)
    bag.frameSrcs.add(`${url.protocol}//${url.host}`)
  }
  return h('section', { class: 'embed', id: anchor }, [
    h('div', { class: 'wrap' }, [
      heading,
      src
        ? h('iframe', {
            class: 'embed-frame',
            src,
            title: embed.name || String(p.title ?? 'Embedded content'),
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
          })
        : h('p', { class: 'embed-fallback' }, 'This embed is not available.'),
    ]),
  ])
}

function embedSrc(embed: EmbedCatalogEntry): string | null {
  const id = String(embed.config.formId ?? embed.config.videoId ?? '')
  if (!id) return null
  if (embed.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${id}`
  if (embed.provider === 'tally') return `https://tally.so/r/${id}`
  if (embed.provider === 'google_forms') return `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true`
  return null
}

/** The header owns the menu look (one place to choose it; Spencer, 21 Nov 2026). The brand pack's old menuStyle is
 *  only used when there is no live header. */
function menuStyleOf(site: SiteRenderContext): HeaderDoc['style'] {
  return site.header?.doc.style ?? site.brand?.menuStyle ?? 'simple'
}

function headerClass(style: HeaderDoc['style'] | undefined, appearance?: HeaderDoc['appearance'], overHero = false): string {
  const base =
    style === 'centred'
      ? 'site-header site-header-centred'
      : style === 'mega'
        ? 'site-header site-header-mega'
        : style === 'hamburger'
          ? 'site-header site-header-hamburger'
          : 'site-header'
  const withLook = appearance === 'dark' ? `${base} site-header-dark` : base
  return overHero ? `${withLook} site-header-over` : withLook
}

/** A small heart for Donate buttons. Decorative: the button text carries the meaning. */
function heartIcon(): VNode {
  return h('svg', { class: 'ico-heart', viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' }, [
    h('path', { fill: 'currentColor', d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' }),
  ])
}

function utilityLink(site: SiteRenderContext, bag: Collector, place?: 'bar' | 'drawer'): VNode | null {
  const utility = site.header?.doc.utility
  if (!utility) return null
  const link = resolveLink(utility.target, utility.label, site, bag)
  const className = place === 'bar' ? 'util util-bar' : place === 'drawer' ? 'util util-drawer' : 'util'
  return h('a', { class: className, href: link.href }, utility.label)
}

const TILE_SIZES = '(max-width: 640px) 45vw, 13rem'

/** One small WebP for a mega tile. Missing library photos are left out on a real publish, same as other pictures. */
function tileImage(image: ImageRef, label: string, site: SiteRenderContext, bag: Collector): VNode | null {
  const entry = site.media[image.media]
  if (!entry && site.preview) {
    return h('img', {
      src: previewPlaceholder(image.media),
      alt: image.alt ?? '',
      width: 640,
      height: 420,
      loading: 'lazy',
      decoding: 'async',
      'data-sample-photo': '',
    })
  }
  if (!entry && site.mediaComplete) return null
  if (entry?.kind === 'video') return null
  bag.media.add(image.media)
  const alt = image.decorative || entry?.decorative ? '' : (image.alt?.trim() || entry?.alt?.trim() || label)
  const width = entry?.width ?? 640
  const height = entry?.height ?? 420
  if (entry?.kind === 'svg' || entry?.mime === 'image/svg+xml') {
    return h('img', { src: `/media/${image.media}.svg`, alt, width, height, loading: 'lazy', decoding: 'async' })
  }
  const widths = widthsForMedia(entry)
  const srcW = widths.find((w) => w >= 640) ?? widths[widths.length - 1] ?? 640
  return h('img', {
    src: `/media/${image.media}-${srcW}.webp`,
    srcset: widths.map((w) => `/media/${image.media}-${w}.webp ${w}w`).join(', '),
    sizes: TILE_SIZES,
    alt,
    width,
    height,
    loading: 'lazy',
    decoding: 'async',
  })
}

function renderNav(site: SiteRenderContext, bag: Collector): VNode | null {
  const key = site.header?.doc.menuKey ?? 'main'
  const menu = site.menus[key]
  if (!menu) return null
  bag.siteParts.add(menu.id)
  const style = menuStyleOf(site)
  const items = menu.doc.items.map((item) => {
    const link = resolveLink(item.target, item.label, site, bag)
    if (!item.children.length) return h('a', { href: link.href }, item.label)
    const textLinks = item.children.map((child) => {
      const c = resolveLink(child.target, child.label, site, bag)
      return h('li', [h('a', { href: c.href }, child.label)])
    })
    const tiles = style === 'mega' ? item.children.filter((child) => child.featured).slice(0, 5) : []
    if (!tiles.length) {
      return h('details', [
        h('summary', item.label),
        h('ul', { class: style === 'mega' ? 'nav-mega-panel' : undefined }, textLinks),
      ])
    }
    return h('details', [
      h('summary', item.label),
      h('div', { class: 'nav-mega-panel nav-mega-panel-tiles' }, [
        h('ul', { class: 'nav-mega-links' }, textLinks),
        h(
          'ul',
          { class: 'nav-mega-tiles' },
          tiles.map((child) => {
            const c = resolveLink(child.target, child.label, site, bag)
            const img = child.image ? tileImage(child.image, child.label, site, bag) : null
            return h('li', [
              h('a', { class: img ? 'tile' : 'tile tile-text', href: c.href }, img ? [img, h('span', child.label)] : [h('span', child.label)]),
            ])
          }),
        ),
      ]),
    ])
  })
  if (style === 'hamburger') {
    const inMenu = utilityLink(site, bag, 'drawer')
    return h('details', { class: 'nav nav-hamburger', 'aria-label': 'Site' }, [
      h('summary', 'Menu'),
      h('div', { class: 'nav-panel' }, inMenu ? [...items, inMenu] : items),
    ])
  }
  const utility = utilityLink(site, bag)
  return h('nav', { class: style === 'mega' ? 'nav nav-mega' : 'nav', 'aria-label': 'Site' }, utility ? [...items, utility] : items)
}

function logoOrName(site: SiteRenderContext, bag: Collector, opts: { dark?: boolean } = {}): VNode | string {
  const dark = !!opts.dark
  const darkId = site.brand?.logoDarkMediaId
  const lightId = site.brand?.logoMediaId
  const id = dark && darkId ? darkId : lightId
  if (!id) return site.name
  const entry = site.media[id]
  if (!entry || entry.kind === 'video') return site.name
  bag.media.add(id)
  if (dark && darkId && darkId !== lightId) bag.media.add(darkId)
  if (lightId && lightId !== id) bag.media.add(lightId)
  const alt = entry.alt?.trim() || site.name
  const fallback = dark && !darkId
  const className = fallback ? 'site-logo site-logo-fallback-light' : 'site-logo'
  if (entry.kind === 'svg' || entry.mime === 'image/svg+xml') {
    return h('img', {
      class: className,
      src: `/media/${id}.svg`,
      alt,
      width: entry.width ?? undefined,
      height: entry.height ?? undefined,
      decoding: 'async',
    })
  }
  const widths = widthsForMedia(entry)
  const srcW = widths[widths.length - 1] ?? 320
  return h('img', {
    class: className,
    src: `/media/${id}-${srcW}.webp`,
    srcset: widths.map((w) => `/media/${id}-${w}.webp ${w}w`).join(', '),
    sizes: '(max-width: 640px) 180px, 220px',
    alt,
    width: entry.width ?? undefined,
    height: entry.height ?? undefined,
    decoding: 'async',
  })
}

function faviconTags(site: SiteRenderContext): string {
  const id = site.brand?.logoMediaId
  if (!id || !site.media[id]) return ''
  return `<link rel="icon" href="/favicon.png" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  `
}

function renderShell(doc: PageDoc, site: SiteRenderContext, bag: Collector): VNode {
  const banner = site.banner
  if (banner) {
    bag.siteParts.add(banner.id)
  }
  const showBanner = banner && banner.doc.enabled && banner.doc.message
  const header = site.header
  if (header) bag.siteParts.add(header.id)
  const footer = site.footer
  if (footer) bag.siteParts.add(footer.id)

  const bannerLink = showBanner && banner.doc.link ? resolveLink(banner.doc.link.target, banner.doc.link.label, site, bag) : null
  const headerCta = header?.doc.cta ? resolveLink(header.doc.cta.target, header.doc.cta.label, site, bag) : null
  const overHero = !!header?.doc.overHero
  if (overHero) bag.needsHeaderJs = true
  let firstHero = true
  const menuKey = site.header?.doc.menuKey ?? 'main'
  // Two copies, one hidden by UTILITY_CSS: the drawer on a phone, the bar from 641px up.
  const barUtility = menuStyleOf(site) === 'hamburger' && site.menus[menuKey] ? utilityLink(site, bag, 'bar') : null

  return h('div', [
    h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
    showBanner
      ? h('div', { class: `banner banner-${banner.doc.tone}`, role: banner.doc.tone === 'urgent' ? 'alert' : 'status' }, [
          banner.doc.message,
          bannerLink ? [' ', h('a', { href: bannerLink.href }, bannerLink.label)] : null,
        ])
      : null,
    h('header', { class: headerClass(menuStyleOf(site), site.header?.doc.appearance, overHero) }, [
      h('div', { class: 'site-header-inner' }, [
        h('a', { class: 'site-title', href: '/' }, logoOrName(site, bag, { dark: site.header?.doc.appearance === 'dark' })),
        renderNav(site, bag),
        ...(barUtility ? [barUtility] : []),
        headerCta
          ? h('a', { class: 'cta-btn', href: headerCta.href }, header?.doc.cta?.icon === 'heart' ? [heartIcon(), h('span', headerCta.label)] : headerCta.label)
          : null,
      ]),
    ]),
    h(
      'main',
      { id: 'main' },
      doc.blocks.map((block) => {
        const eager = firstHero && (block.type === 'Hero' || block.type === 'VideoHero')
        if (block.type === 'Hero' || block.type === 'VideoHero') firstHero = false
        const vnode = site.preview ? previewBlock(block as StoredBlock, () => renderBlock(block as StoredBlock, site, bag, eager)) : renderBlock(block as StoredBlock, site, bag, eager)
        return withSectionCss(block as StoredBlock, vnode)
      }),
    ),
    renderFooter(site, bag, footer),
  ])
}

const SOCIAL_LABELS: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', bluesky: 'Bluesky', threads: 'Threads' }

/** Simple line icons drawn for this theme. Decorative: the link carries an aria-label. */
function socialIcon(network: string): VNode {
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  const children: VNode[] =
    network === 'facebook'
      ? [h('path', { ...stroke, d: 'M14 8h2V5h-2.2C11.6 5 10.5 6.3 10.5 8.2V10H8.5v3h2v7h3v-7H16l.5-3h-3V8.6c0-.4.2-.6.5-.6z' })]
      : network === 'instagram'
        ? [h('rect', { ...stroke, x: 4, y: 4, width: 16, height: 16, rx: 4.5 }), h('circle', { ...stroke, cx: 12, cy: 12, r: 3.5 }), h('circle', { cx: 16.8, cy: 7.2, r: 1, fill: 'currentColor' })]
        : network === 'youtube'
          ? [h('rect', { ...stroke, x: 3, y: 6, width: 18, height: 12, rx: 3.5 }), h('path', { d: 'M10.5 9.5v5l4-2.5z', fill: 'currentColor' })]
          : network === 'x'
            ? [h('path', { ...stroke, d: 'M5 5l14 14M19 5L5 19' })]
            : network === 'linkedin'
              ? [h('path', { ...stroke, d: 'M6.5 10v7M6.5 6.5v.01M10.5 17v-7M10.5 13c0-2 1.4-3 3-3s3 1 3 3v4' })]
              : [h('circle', { ...stroke, cx: 12, cy: 12, r: 8 })]
  return h('svg', { class: 'ico-social', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' }, children)
}

function arrowIcon(): VNode {
  return h('svg', { class: 'ico-arrow', viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false' }, [
    h('path', { d: 'M9 5l7 7-7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

/** The richer footer: brand and tagline, a contact column, a links column with social icons, and a base line. */
function renderFooterColumns(site: SiteRenderContext, bag: Collector, doc: FooterDoc): VNode {
  const links = doc.linksMenuKey ? site.menus[doc.linksMenuKey] : null
  if (links) bag.siteParts.add(links.id)
  const legal = doc.legalMenuKey ? site.menus[doc.legalMenuKey] : null
  if (legal) bag.siteParts.add(legal.id)
  const contact = doc.contact
  const hasContact = !!(contact.email || contact.phone)
  return h('footer', { class: doc.appearance === 'dark' ? 'site-footer site-footer-cols site-footer-dark' : 'site-footer site-footer-cols' }, [
    h('div', { class: 'ft-wrap' }, [
      h('div', { class: 'ft-grid' }, [
        h('div', { class: 'ft-brand' }, [
          h('a', { class: 'ft-logo', href: '/' }, logoOrName(site, bag)),
          doc.tagline ? h('p', { class: 'ft-tag' }, [doc.tagline.lead, doc.tagline.accent ? [' ', h('em', doc.tagline.accent)] : null]) : null,
          doc.text ? h('div', { class: 'ft-about prose' }, renderRichText(doc.text, bag)) : null,
        ]),
        hasContact
          ? h('div', { class: 'ft-col' }, [
              h('h3', doc.contactTitle ?? 'Get in touch'),
              h('address', [
                contact.email ? h('div', [h('a', { href: `mailto:${contact.email}` }, contact.email)]) : null,
                contact.phone ? h('div', [h('a', { href: `tel:${contact.phone.replace(/ /g, '')}` }, contact.phone)]) : null,
              ]),
            ])
          : null,
        h('div', { class: 'ft-col' }, [
          links ? h('h3', doc.linksTitle ?? 'Find out more') : null,
          links
            ? h(
                'nav',
                { class: 'ft-links', 'aria-label': doc.linksTitle ?? 'Footer' },
                links.doc.items.map((item) => h('a', { href: resolveLink(item.target, item.label, site, bag).href }, [item.label, arrowIcon()])),
              )
            : null,
          doc.social.length
            ? h(
                'div',
                { class: 'footer-social ft-social' },
                doc.social.map((x) => h('a', { href: resolvedHref(x.url, bag), rel: 'me noopener', 'aria-label': SOCIAL_LABELS[x.network] ?? x.network }, [socialIcon(x.network)])),
              )
            : null,
        ]),
      ]),
      h('div', { class: 'ft-base' }, [
        contact.address ? h('p', contact.address) : h('p'),
        h('p', [
          doc.legalText ?? null,
          doc.charityNumber ? `${doc.legalText ? ' ' : ''}Charity number ${doc.charityNumber}.` : null,
          legal ? legal.doc.items.map((item) => [' ', h('a', { href: resolveLink(item.target, item.label, site, bag).href }, item.label)]) : null,
        ]),
      ]),
    ]),
  ])
}

function renderFooter(site: SiteRenderContext, bag: Collector, footer: SiteRenderContext['footer']): VNode {
  const doc = footer?.doc
  if (doc && doc.layout === 'columns') return renderFooterColumns(site, bag, doc)
  const legal = doc?.legalMenuKey ? site.menus[doc.legalMenuKey] : null
  if (legal) bag.siteParts.add(legal.id)
  return h('footer', { class: site.footer?.doc.appearance === 'dark' ? 'site-footer site-footer-dark' : 'site-footer' }, [
    h('div', { class: 'site-footer-inner' }, [
      doc?.text ? h('div', { class: 'prose' }, renderRichText(doc.text, bag)) : null,
      doc?.contact && (doc.contact.email || doc.contact.phone || doc.contact.address)
        ? h('address', [
            doc.contact.email ? h('div', [h('a', { href: `mailto:${doc.contact.email}` }, doc.contact.email)]) : null,
            doc.contact.phone ? h('div', [h('a', { href: `tel:${doc.contact.phone.replace(/ /g, '')}` }, doc.contact.phone)]) : null,
            doc.contact.address ? h('div', doc.contact.address) : null,
          ])
        : null,
      doc?.social.length
        ? h(
            'div',
            { class: 'footer-social' },
            doc.social.map((s) => {
              return h('a', { href: resolvedHref(s.url, bag), rel: 'me noopener' }, s.network)
            }),
          )
        : null,
      legal
        ? h(
            'nav',
            { 'aria-label': 'Legal' },
            legal.doc.items.map((item) => {
              const link = resolveLink(item.target, item.label, site, bag)
              return h('a', { href: link.href }, item.label)
            }),
          )
        : null,
      doc?.charityNumber ? h('p', `Charity number ${doc.charityNumber}`) : null,
    ]),
  ])
}

export function buildCsp(bag: Collector, tracking: SiteSettings['tracking'], css: string = THEME_CSS): string {
  const scripts = new Set<string>(["'self'"])
  const frames = new Set<string>(bag.frameSrcs)
  const connect = new Set<string>(["'self'", ...bag.connectSrcs])
  const images = new Set<string>(["'self'", 'data:', ...bag.imgSrcs])
  if (bag.needsEmbedJs) scripts.add(VIRTUOUS_SCRIPT.replace(/\/[^/]+$/, ''))
  for (const src of bag.scriptSrcs) {
    try {
      const u = new URL(src)
      const origin = `${u.protocol}//${u.host}`
      scripts.add(origin)
      connect.add(origin)
    } catch {
      /* ignore */
    }
  }
  if (tracking.gtm || tracking.ga4) {
    scripts.add('https://www.googletagmanager.com')
    connect.add('https://www.googletagmanager.com')
    connect.add('https://www.google-analytics.com')
  }
  if (tracking.ga4) scripts.add('https://www.google-analytics.com')
  if (tracking.plausible) {
    scripts.add('https://plausible.io')
    connect.add('https://plausible.io')
  }
  if (tracking.cookiebot) {
    scripts.add('https://consent.cookiebot.com')
    frames.add('https://consent.cookiebot.com')
  }
  const parts = [
    `default-src 'self'`,
    `script-src ${[...scripts].join(' ')}`,
    `style-src 'self' ${styleHash(css)}`,
    `img-src ${[...images].join(' ')}`,
    `font-src 'self'`,
    `connect-src ${[...connect].join(' ')}`,
    `frame-src ${frames.size ? [...frames].join(' ') : "'none'"}`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
  ]
  return parts.join('; ') + ';'
}

function trackingNeedsScript(tracking: SiteSettings['tracking']): boolean {
  return !!(tracking.ga4 || tracking.gtm || tracking.plausible || tracking.cookiebot)
}

export function renderAnalyticsJs(tracking: SiteSettings['tracking']): string | null {
  if (!trackingNeedsScript(tracking)) return null
  const lines: string[] = []
  if (tracking.cookiebot) {
    lines.push(
      `var s=document.createElement("script");s.id="Cookiebot";s.src="https://consent.cookiebot.com/uc.js";s.setAttribute("data-cbid",${JSON.stringify(tracking.cookiebot)});s.async=true;document.head.appendChild(s);`,
    )
  }
  if (tracking.gtm) {
    lines.push(
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":Date.now(),event:"gtm.js"});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!="dataLayer"?"&l="+l:"";j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i+dl;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer",${JSON.stringify(tracking.gtm)});`,
    )
  } else if (tracking.ga4) {
    lines.push(
      `var g=document.createElement("script");g.async=true;g.src="https://www.googletagmanager.com/gtag/js?id="+${JSON.stringify(tracking.ga4)};document.head.appendChild(g);window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${JSON.stringify(tracking.ga4)});`,
    )
  }
  if (tracking.plausible) {
    lines.push(
      `var p=document.createElement("script");p.defer=true;p.setAttribute("data-domain",${JSON.stringify(tracking.plausible)});p.src="https://plausible.io/js/script.js";document.head.appendChild(p);`,
    )
  }
  return lines.join('\n')
}

/** CSS for optional shell parts. Empty when every option is left at its default, so the style tag stays byte-identical. */
export function shellOptionCss(site: SiteRenderContext): string {
  let extra = ''
  const columns = site.footer?.doc.layout === 'columns'
  const overHero = !!site.header?.doc.overHero
  if (site.header?.doc.cta?.icon === 'heart') extra += HEART_CSS
  if (site.header?.doc.utility) extra += UTILITY_CSS
  if (columns) extra += FOOTER_COLUMNS_CSS
  if (overHero) extra += OVER_HERO_CSS
  const banner = site.banner
  if (banner && banner.doc.enabled && banner.doc.message && banner.doc.tone === 'accent') extra += BANNER_ACCENT_CSS
  if (menuHasTiles(site)) extra += TILE_CSS
  extra += brandChromeCss(site.brand?.tokens, { columns, overHero })
  return extra
}

function menuHasTiles(site: SiteRenderContext): boolean {
  if (menuStyleOf(site) !== 'mega') return false
  const menu = site.menus[site.header?.doc.menuKey ?? 'main']
  return !!menu?.doc.items.some((item) => item.children.some((child) => child.featured))
}

export async function renderPageHtml(input: {
  doc: PageDoc
  pageId: string
  versionId: string
  path: string
  site: SiteRenderContext
}): Promise<RenderedPage> {
  const bag = newCollector(input.site)
  const { doc, site } = input
  const css = (site.themeCss ?? THEME_CSS) + shellOptionCss(site) + emitSiteCss(site.brand) + doc.blocks.map((block) => emitSectionCss(block as StoredBlock)).join('')
  if (css.toLowerCase().includes('</')) throw new CssRejected(1, 1, 'The generated CSS was rejected.')
  if (Buffer.byteLength(css, 'utf8') > STYLE_MAX_BYTES) throw new CssRejected(1, 1, 'This page CSS is over the 65,536 byte limit.')
  const app = createSSRApp(
    defineComponent({
      name: 'PublishedPage',
      setup: () => () => renderShell(doc, site, bag),
    }),
  )
  const body = await renderToString(app)
  const csp = buildCsp(bag, site.tracking, css)
  const pageTitle = doc.seo.title?.trim() || doc.title
  const title = applyTitlePattern(site.titlePattern, pageTitle, site.name)
  const description = doc.seo.description?.trim() || ''
  const noindex = doc.seo.noindex || !site.allowIndexing
  const canonical = doc.seo.canonical || (site.origin ? publicUrl(site.origin, input.path) : '')
  const wantedImage = doc.seo.image || site.defaultSocialImage
  const imageEntry = wantedImage ? site.media[wantedImage] : undefined
  // Leave out a share image that is not in the library, and use a width that exists for narrow photos.
  const imageId = wantedImage && (imageEntry || !site.mediaComplete) ? wantedImage : null
  if (imageId) bag.media.add(imageId)
  const ogWidths = imageEntry ? widthsForMedia(imageEntry) : [1280]
  const ogW = ogWidths.includes(1280) ? 1280 : ogWidths[ogWidths.length - 1]!
  const ogImage = imageId ? publicUrl(site.origin, `/media/${imageId}-${ogW}.webp`) : ''
  const analytics = trackingNeedsScript(site.tracking)
  const preload = doc.blocks[0]?.type === 'Hero' || doc.blocks[0]?.type === 'VideoHero' ? firstHeroPreload(doc.blocks[0] as StoredBlock, site) : ''
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <title>${escapeHtml(title)}</title>
  ${faviconTags(site)}${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
  ${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
  <meta property="og:title" content="${escapeHtml(title)}">
  <style>${css}</style>
  ${preload}
</head>
<body>
  ${body}
  ${bag.needsEmbedJs ? '<script type="module" src="/embed.js"></script>' : ''}
  ${analytics ? '<script src="/analytics.js" defer></script>' : ''}${bag.needsHeaderJs ? '\n  <script src="/header.js" defer></script>' : ''}
</body>
</html>
`
  return {
    html,
    csp,
    cacheTags: [`page-${input.pageId}`, 'shell'],
    deps: {
      pageId: input.pageId,
      versionId: input.versionId,
      path: input.path,
      bundleId: BUNDLE_ID,
      siteParts: [...bag.siteParts],
      media: [...bag.media],
      links: [...bag.links],
      linkedPageIds: [...bag.linkedPageIds],
    },
  }
}

function firstHeroPreload(block: StoredBlock, site: SiteRenderContext): string {
  const image = (block.props as { image?: ImageRef; poster?: ImageRef }).image ?? (block.props as { poster?: ImageRef }).poster
  if (!image) return ''
  const entry = site.media[image.media]
  if (!entry && (site.mediaComplete || site.preview)) return ''
  const ratio = '16:9'
  const useCrop = entry?.cropRatios.includes(ratio)
  const base = useCrop ? `${image.media}-${ratioKey(ratio)}` : image.media
  const widths = widthsForMedia(entry, useCrop ? ratio : null)
  const w = widths.includes(1280) ? 1280 : widths[widths.length - 1] ?? 1280
  const small = widths.includes(640) ? 640 : widths[0] ?? w
  return `<link rel="preload" as="image" href="/media/${base}-${small}.avif" type="image/avif" media="(max-width: 640px)">
  <link rel="preload" as="image" href="/media/${base}-${w}.webp" type="image/webp" media="(min-width: 641px)">`
}

/** Public origin for sitemaps, robots and canonical URLs. Falls back to PUBLIC_HOST when the site has no primary domain yet. */
export function siteOrigin(primaryDomain: string | null | undefined, publicHost = process.env.PUBLIC_HOST): string | null {
  const domain = primaryDomain?.trim()
  if (domain) return `https://${domain}`
  const host = publicHost?.trim()
  if (host && host !== '_') return `https://${host}`
  return null
}

/** Load the site shell, live pages, media and embeds needed to render a release. */
export function loadSiteRenderContext(ctx: ServiceCtx, manifest: ReleaseManifest, previous?: ReleaseManifest | null): SiteRenderContext {
  const siteRow = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(siteRow.settings)
  const origin = siteOrigin(siteRow.primaryDomain)
  const pagesById: SiteRenderContext['pagesById'] = {}
  for (const [id, entry] of Object.entries(manifest.pages)) {
    const row = ctx.db.select({ title: pages.title, path: pages.path }).from(pages).where(eq(pages.id, id)).get()
    pagesById[id] = { path: entry.path, title: row?.title ?? entry.path }
  }
  const pathAliases = pathAliasesFor(ctx, manifest, previous)

  const header = loadPart<HeaderDoc>(ctx, manifest, 'header')
  const footer = loadPart<FooterDoc>(ctx, manifest, 'footer')
  const banner = loadPart<BannerDoc>(ctx, manifest, 'banner')
  const menus: SiteRenderContext['menus'] = {}
  for (const [id, versionId] of Object.entries(manifest.siteParts)) {
    const part = ctx.db.select().from(siteParts).where(eq(siteParts.id, id)).get()
    if (!part || part.kind !== 'menu') continue
    const raw = ctx.db.select({ doc: versions.doc }).from(versions).where(eq(versions.id, versionId)).get()?.doc
    const parsed = migrateSitePartDoc('menu', raw) as MenuDoc
    menus[part.key] = { id, doc: parsed }
  }

  const mediaRows = ctx.db.select().from(media).where(eq(media.siteId, ctx.siteId)).all()
  const cropRows = ctx.db.select().from(mediaCrops).where(eq(mediaCrops.siteId, ctx.siteId)).all()
  const cropsByMedia = new Map<string, string[]>()
  const cropWidthsByMedia = new Map<string, Record<string, number>>()
  // Renditions are named by ratio only, so the newest approved crop for a ratio is the one on disk ('all' first).
  const ordered = [...cropRows].sort((a, b) => (a.breakpoint === 'all' ? 1 : 0) - (b.breakpoint === 'all' ? 1 : 0) || String(a.approvedAt).localeCompare(String(b.approvedAt)))
  for (const crop of ordered) {
    const list = cropsByMedia.get(crop.mediaId) ?? []
    list.push(crop.ratio)
    cropsByMedia.set(crop.mediaId, list)
    cropWidthsByMedia.set(crop.mediaId, { ...cropWidthsByMedia.get(crop.mediaId), [crop.ratio]: crop.width })
  }
  const mediaCatalog: Record<string, MediaCatalogEntry> = {}
  for (const row of mediaRows) {
    mediaCatalog[row.id] = {
      id: row.id,
      width: row.width,
      height: row.height,
      alt: row.alt,
      decorative: row.decorative,
      status: row.status,
      kind: row.kind,
      mime: row.mime,
      cropRatios: [...new Set(cropsByMedia.get(row.id) ?? [])],
      cropWidths: cropWidthsByMedia.get(row.id) ?? {},
    }
  }

  const embedCatalog: Record<string, EmbedCatalogEntry> = {}
  for (const row of ctx.db.select().from(embeds).where(eq(embeds.siteId, ctx.siteId)).all()) {
    embedCatalog[row.id] = { id: row.id, provider: row.provider, name: row.name, config: row.config }
  }

  let brand: BrandDoc | null = null
  if (manifest.brandVersionId) {
    const raw = ctx.db.select({ doc: versions.doc }).from(versions).where(eq(versions.id, manifest.brandVersionId)).get()?.doc
    const parsed = validateBrandDoc(migrateBrandDoc(raw))
    if (parsed.ok) brand = parsed.doc
  }
  const themeCss = brand ? themeCssFromTokens(brand.tokens, brand.fonts) : undefined

  return {
    name: siteRow.name,
    origin,
    titlePattern: settings.titlePattern,
    allowIndexing: settings.seo.allowIndexing,
    robotsTxt: settings.seo.robotsTxt,
    defaultSocialImage: settings.seo.defaultSocialImage,
    tracking: settings.tracking,
    header,
    footer,
    banner,
    brand,
    themeCss,
    menus,
    pagesById,
    pathAliases,
    media: mediaCatalog,
    mediaComplete: true,
    embeds: embedCatalog,
  }
}

function loadPart<T>(ctx: ServiceCtx, manifest: ReleaseManifest, kind: SitePartKind): { id: string; doc: T } | null {
  const part = ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all().find((p) => p.kind === kind)
  if (!part) return null
  const versionId = manifest.siteParts[part.id]
  if (!versionId) return null
  const raw = ctx.db.select({ doc: versions.doc }).from(versions).where(eq(versions.id, versionId)).get()?.doc
  return { id: part.id, doc: migrateSitePartDoc(kind, raw) as T }
}

export function loadPageDoc(ctx: ServiceCtx, versionId: string): PageDoc {
  const row = ctx.db.select().from(versions).where(eq(versions.id, versionId)).get()
  if (!row) throw new Error(`Version ${versionId} is missing; cannot render the release.`)
  return migratePageDoc(row.doc, ctx.registry)
}

export async function renderManifestPage(ctx: ServiceCtx, manifest: ReleaseManifest, pageId: string, site?: SiteRenderContext): Promise<RenderedPage> {
  const entry = manifest.pages[pageId]
  if (!entry) throw new Error(`Page ${pageId} is not in this release.`)
  const doc = loadPageDoc(ctx, entry.versionId)
  const renderSite = site ?? loadSiteRenderContext(ctx, manifest)
  return renderPageHtml({ doc, pageId, versionId: entry.versionId, path: entry.path, site: renderSite })
}

export function sitemapXml(site: SiteRenderContext, manifest: ReleaseManifest, docs: Record<string, PageDoc>): string {
  if (!site.allowIndexing) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`
  }
  const urls: string[] = []
  for (const [id, entry] of Object.entries(manifest.pages)) {
    const doc = docs[id]
    if (doc?.seo.noindex) continue
    const loc = escapeHtml(publicUrl(site.origin, entry.path))
    urls.push(`  <url><loc>${loc}</loc></url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export function robotsTxt(site: SiteRenderContext): string {
  return renderRobotsTxt({ allowIndexing: site.allowIndexing, origin: site.origin, custom: site.robotsTxt })
}

/**
 * One nginx map include. `urlValues` (redirect targets) percent-encodes `$` to `%24`.
 * Other values (CSP, cache tags, status codes) are dropped when they contain `$`.
 * A newline or control character in a key or value drops that entry. Never throws:
 * an old bad row must not stop a publish.
 */
export function nginxMapLines(entries: { uri: string; value: string }[], options?: { urlValues?: boolean }): string {
  const urlValues = options?.urlValues === true
  const lines: string[] = []
  for (const entry of entries) {
    if (hasLineBreakOrControl(entry.uri)) {
      logDroppedMapEntry(entry.uri, 'unsafe_key')
      continue
    }
    const uri = entry.uri.replaceAll('$', '%24')
    let value = entry.value
    if (urlValues) {
      if (hasLineBreakOrControl(value)) {
        logDroppedMapEntry(entry.uri, 'unsafe_value')
        continue
      }
      value = value.replaceAll('$', '%24')
    } else if (value.includes('$') || hasLineBreakOrControl(value)) {
      logDroppedMapEntry(entry.uri, 'unsafe_value')
      continue
    }
    for (const u of uniqueUris(uri)) lines.push(`${nginxQuote(u)} ${nginxQuote(value)};`)
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

function hasLineBreakOrControl(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0)!
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

function logDroppedMapEntry(uri: string, reason: 'unsafe_key' | 'unsafe_value'): void {
  console.error(JSON.stringify({ level: 'error', msg: 'nginx_map_dropped', reason, uri }))
}

function uniqueUris(path: string): string[] {
  if (path === '/') return ['/', '/index.html']
  const clean = path.replace(/\/+$/, '')
  return [clean, `${clean}/`, `${clean}/index.html`]
}

function nginxQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function redirectsMap(rows: { fromPath: string; toPath: string; statusCode: number }[]): { uri: string; status: string } {
  const dest = rows.map((r) => ({ uri: r.fromPath, value: r.toPath }))
  const status = rows.map((r) => ({ uri: r.fromPath, value: String(r.statusCode) }))
  return { uri: nginxMapLines(dest, { urlValues: true }), status: nginxMapLines(status) }
}


function pathAliasesFor(ctx: ServiceCtx, manifest: ReleaseManifest, previous?: ReleaseManifest | null): Map<string, string> {
  const aliases = new Map<string, string>()
  const liveByPath = new Map(Object.entries(manifest.pages).map(([id, entry]) => [entry.path, id]))
  if (previous) {
    for (const [id, prev] of Object.entries(previous.pages)) {
      if (manifest.pages[id] && prev.path !== manifest.pages[id]!.path) aliases.set(prev.path, id)
    }
  }
  for (const [from, id] of aliasesFromRedirects(
    ctx.db.select({ fromPath: redirects.fromPath, toPath: redirects.toPath }).from(redirects).where(eq(redirects.siteId, ctx.siteId)).all(),
    liveByPath,
  )) {
    if (!aliases.has(from)) aliases.set(from, id)
  }
  return aliases
}

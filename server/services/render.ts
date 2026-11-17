// Public-site renderer: Vue's server renderer turns a page document and the site shell
// into static HTML. Theme CSS is inlined (spike 001). Each page records a dependency map
// and a Content-Security-Policy. This is the hand-written v1 render bundle; a Vite compile
// step can replace the block components later (ADR 0004).
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createSSRApp, defineComponent, h, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
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
import { BUNDLE_ID, EMBED_JS, THEME_CSS } from '../theme/default'
import { migrateBrandDoc, validateBrandDoc, type BrandDoc } from '../../shared/brand'
import { themeCssFromTokens } from '../../shared/theme-css'
import { embeds, media, mediaCrops, pages, redirects, siteParts, sites, versions, type ReleaseManifest } from '../db/schema'
import type { ServiceCtx } from './context'
import { widthsFor } from './media'
import { readSettings, type SiteSettings } from '../../shared/settings'
import { aliasesFromRedirects, pageIdByPath, pageIdForHref, pathForPageId } from '../../shared/internal-links'

export { BUNDLE_ID, EMBED_JS, THEME_CSS }

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
  embeds: Record<string, EmbedCatalogEntry>
}

interface Collector {
  media: Set<string>
  links: Set<string>
  linkedPageIds: Set<string>
  siteParts: Set<string>
  scriptSrcs: Set<string>
  frameSrcs: Set<string>
  needsEmbedJs: boolean
  pageIdByPath: Map<string, string>
  origin: string | null
  aliases: Map<string, string>
}

function newCollector(site: SiteRenderContext): Collector {
  return { media: new Set(), links: new Set(), linkedPageIds: new Set(), siteParts: new Set(), scriptSrcs: new Set(), frameSrcs: new Set(), needsEmbedJs: false, pageIdByPath: pageIdByPath(site.pagesById), origin: site.origin, aliases: site.pathAliases ?? new Map() }
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

function widthsForMedia(entry: MediaCatalogEntry | undefined): number[] {
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
  bag.media.add(image.media)
  const entry = site.media[image.media]
  const ratio = opts.slot && opts.slot.height ? ratioFor(opts.slot.width, opts.slot.height) : null
  const useCrop = ratio && entry?.cropRatios.includes(ratio)
  const base = useCrop ? `${image.media}-${ratioKey(ratio!)}` : image.media
  const widths = widthsForMedia(entry)
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
      if (videoId) bag.media.add(videoId)
      const clip = videoId ? site.media[videoId] : undefined
      const ext = clip?.mime === 'video/webm' ? 'webm' : 'mp4'
      const mime = clip?.mime === 'video/webm' ? 'video/webm' : 'video/mp4'
      return h('section', { class: 'hero', 'aria-label': String(p.heading ?? '') }, [
        pictureVNode(p.poster as ImageRef | undefined, site, bag, { slot: { width: 1280, height: 720 }, eager: firstHero, class: 'hero-media' }),
        videoId
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
    default:
      throw new Error(`Unknown section type "${block.type}" cannot be published.`)
  }
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

function menuStyleOf(site: SiteRenderContext): HeaderDoc['style'] {
  return site.brand?.menuStyle ?? site.header?.doc.style ?? 'simple'
}

function headerClass(style: HeaderDoc['style'] | undefined): string {
  if (style === 'centred') return 'site-header site-header-centred'
  if (style === 'mega') return 'site-header site-header-mega'
  if (style === 'hamburger') return 'site-header site-header-hamburger'
  return 'site-header'
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
    return h('details', [
      h('summary', item.label),
      h(
        'ul',
        { class: style === 'mega' ? 'nav-mega-panel' : undefined },
        item.children.map((child) => {
          const c = resolveLink(child.target, child.label, site, bag)
          return h('li', [h('a', { href: c.href }, child.label)])
        }),
      ),
    ])
  })
  if (style === 'hamburger') {
    return h('details', { class: 'nav nav-hamburger', 'aria-label': 'Site' }, [h('summary', 'Menu'), h('div', { class: 'nav-panel' }, items)])
  }
  return h('nav', { class: style === 'mega' ? 'nav nav-mega' : 'nav', 'aria-label': 'Site' }, items)
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
  let firstHero = true

  return h('div', [
    h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
    showBanner
      ? h('div', { class: `banner banner-${banner.doc.tone}`, role: banner.doc.tone === 'urgent' ? 'alert' : 'status' }, [
          banner.doc.message,
          bannerLink ? [' ', h('a', { href: bannerLink.href }, bannerLink.label)] : null,
        ])
      : null,
    h('header', { class: headerClass(menuStyleOf(site)) }, [
      h('div', { class: 'site-header-inner' }, [
        h('a', { class: 'site-title', href: '/' }, site.name),
        renderNav(site, bag),
        headerCta ? h('a', { class: 'cta-btn', href: headerCta.href }, headerCta.label) : null,
      ]),
    ]),
    h(
      'main',
      { id: 'main' },
      doc.blocks.map((block) => {
        const eager = firstHero && (block.type === 'Hero' || block.type === 'VideoHero')
        if (block.type === 'Hero' || block.type === 'VideoHero') firstHero = false
        return renderBlock(block as StoredBlock, site, bag, eager)
      }),
    ),
    renderFooter(site, bag, footer),
  ])
}

function renderFooter(site: SiteRenderContext, bag: Collector, footer: SiteRenderContext['footer']): VNode {
  const doc = footer?.doc
  const legal = doc?.legalMenuKey ? site.menus[doc.legalMenuKey] : null
  if (legal) bag.siteParts.add(legal.id)
  return h('footer', { class: 'site-footer' }, [
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
  const connect = new Set<string>(["'self'"])
  if (bag.needsEmbedJs) scripts.add(VIRTUOUS_SCRIPT.replace(/\/[^/]+$/, ''))
  for (const src of bag.scriptSrcs) {
    try {
      const u = new URL(src)
      scripts.add(`${u.protocol}//${u.host}`)
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
    `img-src 'self' data:`,
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

export async function renderPageHtml(input: {
  doc: PageDoc
  pageId: string
  versionId: string
  path: string
  site: SiteRenderContext
}): Promise<RenderedPage> {
  const bag = newCollector(input.site)
  const { doc, site } = input
  const css = site.themeCss ?? THEME_CSS
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
  const imageId = doc.seo.image || site.defaultSocialImage
  if (imageId) bag.media.add(imageId)
  const ogImage = imageId ? publicUrl(site.origin, `/media/${imageId}-1280.webp`) : ''
  const analytics = trackingNeedsScript(site.tracking)
  const preload = doc.blocks[0]?.type === 'Hero' || doc.blocks[0]?.type === 'VideoHero' ? firstHeroPreload(doc.blocks[0] as StoredBlock, site) : ''
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <title>${escapeHtml(title)}</title>
  ${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
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
  ${analytics ? '<script src="/analytics.js" defer></script>' : ''}
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
  const ratio = '16:9'
  const useCrop = entry?.cropRatios.includes(ratio)
  const base = useCrop ? `${image.media}-${ratioKey(ratio)}` : image.media
  const widths = widthsForMedia(entry)
  const w = widths.includes(1280) ? 1280 : widths[widths.length - 1] ?? 1280
  const small = widths.includes(640) ? 640 : widths[0] ?? w
  return `<link rel="preload" as="image" href="/media/${base}-${small}.avif" type="image/avif" media="(max-width: 640px)">
  <link rel="preload" as="image" href="/media/${base}-${w}.webp" type="image/webp" media="(min-width: 641px)">`
}

/** Load the site shell, live pages, media and embeds needed to render a release. */
export function loadSiteRenderContext(ctx: ServiceCtx, manifest: ReleaseManifest, previous?: ReleaseManifest | null): SiteRenderContext {
  const siteRow = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(siteRow.settings)
  const origin = siteRow.primaryDomain ? `https://${siteRow.primaryDomain}` : null
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
  for (const crop of cropRows) {
    const list = cropsByMedia.get(crop.mediaId) ?? []
    list.push(crop.ratio)
    cropsByMedia.set(crop.mediaId, list)
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
  if (!site.allowIndexing) return 'User-agent: *\nDisallow: /\n'
  const sitemap = site.origin ? `Sitemap: ${publicUrl(site.origin, '/sitemap.xml')}\n` : 'Sitemap: /sitemap.xml\n'
  return `User-agent: *\nAllow: /\n${sitemap}`
}

export function nginxMapLines(entries: { uri: string; value: string }[]): string {
  return entries
    .map((e) => {
      const uris = uniqueUris(e.uri)
      return uris.map((u) => `${nginxQuote(u)} ${nginxQuote(e.value)};`).join('\n')
    })
    .join('\n') + (entries.length ? '\n' : '')
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
  return { uri: nginxMapLines(dest), status: nginxMapLines(status) }
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

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, lstatSync, statSync, existsSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { auditEvents, jobs, redirects, releases, sites, versions } from '../server/db/schema'
import { createPurgeCacheHandler, setPurgeHttp } from '../server/services/cloudflare'

import { createMediaRenditionsHandler, updateMedia, uploadMedia } from '../server/services/media'
import { applyPageOps, createPage, getPage } from '../server/services/pages'
import { createPublishHandler, currentRelease, unpublishPage } from '../server/services/publish'
import { createFileReleaseWriter, readCurrentReleaseId } from '../server/services/release'
import { approveReview, submitPage } from '../server/services/reviews'
import {
  EMBED_JS,
  HERO_JS,
  THERMOMETER_JS,
  STYLE_HASH,
  THEME_CSS,
  escapeHtml,
  htmlPathFor,
  nginxMapLines,
  publicUrl,
  redirectsMap,
  renderAnalyticsJs,
  renderPageHtml,
  robotsTxt,
  siteOrigin,
  sitemapXml,
  styleHash,
  type SiteRenderContext,
} from '../server/services/render'
import { CssRejected } from '../shared/css/sanitize'
import { Hero, MatchThermometer, TrustStrip } from '../shared/blocks/library'
import { emptyPageDoc } from '../shared/page'
import { defaultBrandDoc, validateBrandDoc } from '../shared/brand'
import { editBrand, getBrand, submitBrand } from '../server/services/brand'
import { defaultSitePartDoc, type HeaderDoc } from '../shared/site-parts'
import { richTextFromParagraphs } from '../shared/richtext'
import { runJobsOnce } from '../server/services/jobs'
import { updateSettings } from '../server/services/settings'
import { IMG, setup } from './helpers'

/** Structural newlines between records are fine. A value must not contain `$`, a raw newline, or an unescaped quote. */
function assertNginxMapSafe(text: string) {
  expect(text).not.toContain('$')
  const lines = text.split('\n')
  expect(lines.at(-1)).toBe('')
  for (const line of lines.slice(0, -1)) {
    const unescaped = line.replace(/\\"/g, '').replace(/\\\\/g, '')
    expect(unescaped).toMatch(/^"[^"]*" "[^"]*";$/)
  }
}

function site(overrides: Partial<SiteRenderContext> = {}): SiteRenderContext {
  return {
    name: 'Test charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
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

describe('public-site renderer', () => {
  it('maps site paths to release file paths', () => {
    expect(htmlPathFor('/')).toBe('index.html')
    expect(htmlPathFor('/about')).toBe('about/index.html')
    expect(htmlPathFor('/news/winter')).toBe('news/winter/index.html')
  })

  it('inlines the theme CSS, sets a CSP hash, and renders a hero and text', async () => {
    const doc = emptyPageDoc('Winter appeal')
    doc.seo.description = 'Help us this winter.'
    doc.blocks = [
      { id: 'b_hero1', type: 'Hero', v: 1, props: { heading: 'Keep them warm', subheading: 'Blankets and food.', image: IMG, tone: 'primary' } },
      { id: 'b_text1', type: 'RichText', v: 1, props: { content: richTextFromParagraphs(['Every night this winter.']) } },
      { id: 'b_quote1', type: 'Quote', v: 1, props: { text: 'They gave him a second chance.', attribution: 'A volunteer' } },
    ]
    const rendered = await renderPageHtml({ doc, pageId: 'pg_winter', versionId: 'ver_1', path: '/winter-appeal', site: site() })
    expect(rendered.html).toContain('<style>' + THEME_CSS + '</style>')
    expect(rendered.html).toContain(STYLE_HASH)
    expect(rendered.csp).toContain(`style-src 'self' ${STYLE_HASH}`)
    expect(rendered.html).toContain('<h1>Keep them warm</h1>')
    expect(rendered.html).toContain('Every night this winter.')
    expect(rendered.html).toContain('They gave him a second chance.')
    expect(rendered.html).toContain('Winter appeal | Test charity')
    expect(rendered.html).toContain('Help us this winter.')
    expect(rendered.html).toContain('rel="canonical" href="https://example.org/winter-appeal"')
    expect(rendered.html).toContain(`/media/${IMG.media}-1280.webp`)
    expect(rendered.html).toContain('Skip to content')
    expect(rendered.cacheTags).toEqual(['page-pg_winter', 'shell'])
    expect(rendered.deps.media).toContain(IMG.media)
    expect(rendered.deps.bundleId).toBeTruthy()
  })

  it('renders a video hero with a poster and a muted looping video for larger screens', async () => {
    const doc = emptyPageDoc('Home')
    doc.blocks = [
      {
        id: 'b_vhero',
        type: 'VideoHero',
        v: 1,
        props: {
          heading: 'Claire',
          poster: IMG,
          video: 'med_00000000000000000000000002',
          tone: 'primary',
        },
      },
    ]
    const rendered = await renderPageHtml({ doc, pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site() })
    expect(rendered.html).toContain('<h1>Claire</h1>')
    expect(rendered.html).toContain('class="hero-video"')
    expect(rendered.html).toContain('autoplay')
    expect(rendered.html).toContain('muted')
    expect(rendered.html).toContain('/media/med_00000000000000000000000002.mp4')
    expect(rendered.html).toContain('media="(min-width: 641px)"')
    expect(rendered.html).toContain(`/media/${IMG.media}-1280.webp`)
    expect(rendered.deps.media).toEqual(expect.arrayContaining([IMG.media, 'med_00000000000000000000000002']))
  })

  it('marks a page noindex when asked, and omits it from the sitemap', async () => {
    const doc = emptyPageDoc('Hidden')
    doc.seo.noindex = true
    const rendered = await renderPageHtml({ doc, pageId: 'pg_hide', versionId: 'ver_1', path: '/hidden', site: site() })
    expect(rendered.html).toContain('noindex, nofollow')
    const map = sitemapXml(site(), { pages: { pg_hide: { versionId: 'ver_1', path: '/hidden' }, pg_home: { versionId: 'ver_2', path: '/' } }, siteParts: {}, brandVersionId: null, theme: 'default', bundleId: 'dev' }, {
      pg_hide: doc,
      pg_home: emptyPageDoc('Home'),
    })
    expect(map).toContain('https://example.org/')
    expect(map).not.toContain('/hidden')
    expect(robotsTxt(site({ allowIndexing: false }))).toContain('Disallow: /')
    expect(robotsTxt(site({ allowIndexing: false, robotsTxt: 'User-agent: *\nAllow: /\n' }))).toBe('User-agent: *\nDisallow: /\n')
    expect(robotsTxt(site({ robotsTxt: 'User-agent: *\nDisallow: /drafts\n' }))).toContain('Disallow: /drafts')
    expect(robotsTxt(site({ robotsTxt: 'User-agent: *\nDisallow: /drafts\n' }))).toContain('Sitemap: https://example.org/sitemap.xml')
  })

  it('lists both pretty and file URIs in an nginx map', () => {
    const map = nginxMapLines([{ uri: '/about', value: 'page-pg_about shell' }])
    expect(map).toBe('"/about" "page-pg_about shell";\n"/about/" "page-pg_about shell";\n"/about/index.html" "page-pg_about shell";\n')
    expect(publicUrl('https://example.org', '/about')).toBe('https://example.org/about')
  })

  it('never writes a raw dollar, newline or unescaped quote into an nginx map', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const tags = nginxMapLines([
        { uri: '/about', value: 'page-pg_about shell' },
        { uri: '/evil$', value: 'page-x shell' },
        { uri: '/bad', value: 'script-src $evil' },
        { uri: '/nl\n', value: 'page-x shell' },
        { uri: '/ctl', value: 'page\u0001ok' },
        { uri: '/quote"', value: 'has "quote"' },
      ])
      assertNginxMapSafe(tags)
      expect(tags).toContain('"/about" "page-pg_about shell";')
      expect(tags).toContain('"/evil%24" "page-x shell";')
      expect(tags).not.toContain('/bad')
      expect(tags).not.toContain('/nl')
      expect(tags).not.toContain('/ctl')
      expect(tags).toContain('"/quote\\"" "has \\"quote\\"";')

      const csp = nginxMapLines([{ uri: '/talk', value: "default-src 'self'; frame-ancestors 'none'" }])
      expect(csp).toContain(`"/talk" "default-src 'self'; frame-ancestors 'none'";`)

      const maps = redirectsMap([
        { fromPath: '/ok', toPath: '/next', statusCode: 301 },
        { fromPath: '/dollar$', toPath: 'https://x.org/?q=$foo', statusCode: 302 },
        { fromPath: '/inner', toPath: '/new$place', statusCode: 301 },
        { fromPath: '/quote"', toPath: '/next"page', statusCode: 301 },
        { fromPath: '/brace', toPath: 'https://x.org/{id};x', statusCode: 301 },
        { fromPath: '/nl\n', toPath: '/x', statusCode: 301 },
        { fromPath: '/badval', toPath: 'https://x.org/\n', statusCode: 301 },
        { fromPath: '/badstatus', toPath: '/ok', statusCode: '301$oops' as unknown as number },
      ])
      assertNginxMapSafe(maps.uri)
      assertNginxMapSafe(maps.status)
      expect(maps.uri).toContain('"/dollar%24" "https://x.org/?q=%24foo";')
      expect(maps.uri).toContain('"/inner" "/new%24place";')
      expect(maps.uri).toContain('"https://x.org/{id};x"')
      expect(maps.uri).not.toContain('/nl')
      expect(maps.uri).not.toContain('/badval')
      expect(maps.status).toContain('"/ok" "301";')
      expect(maps.status).toContain('"/dollar%24" "302";')
      expect(maps.status).not.toContain('/badstatus')
      expect(maps.status).toContain('"/badval" "301";')

      expect(spy.mock.calls.length).toBeGreaterThan(0)
      for (const call of spy.mock.calls) {
        const line = String(call[0])
        expect(line).not.toContain('\n')
        expect(JSON.parse(line)).toMatchObject({ level: 'error', msg: 'nginx_map_dropped' })
      }
    } finally {
      spy.mockRestore()
    }
  })

  it.skipIf(!existsSync('/usr/sbin/nginx'))('nginx -t accepts a redirects map built from hostile rows', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const maps = redirectsMap([
      { fromPath: '/ok', toPath: '/next', statusCode: 301 },
      { fromPath: '/dollar$', toPath: 'https://x.org/?q=$foo', statusCode: 302 },
      { fromPath: '/quote"', toPath: '/next"page', statusCode: 301 },
      { fromPath: '/brace', toPath: 'https://x.org/{id};x', statusCode: 301 },
      { fromPath: '/nl\n', toPath: '/x', statusCode: 301 },
      { fromPath: '/badval', toPath: 'https://x.org/\n', statusCode: 301 },
    ])
    assertNginxMapSafe(maps.uri)
    const dir = mkdtempSync(join(tmpdir(), 'sb-nginx-h1-'))
    const mapPath = join(dir, 'redirects.map')
    const confPath = join(dir, 'nginx.conf')
    const logPath = join(dir, 'error.log')
    for (const name of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(join(dir, name))
    writeFileSync(mapPath, maps.uri)
    writeFileSync(
      confPath,
      `pid ${join(dir, 'nginx.pid')};
error_log ${logPath};
events {}
http {
  access_log off;
  client_body_temp_path ${join(dir, 'body')};
  proxy_temp_path ${join(dir, 'proxy')};
  fastcgi_temp_path ${join(dir, 'fastcgi')};
  uwsgi_temp_path ${join(dir, 'uwsgi')};
  scgi_temp_path ${join(dir, 'scgi')};
  map $uri $redirect_to {
    include ${mapPath};
  }
  server {
    listen 127.0.0.1:18080;
    return 204;
  }
}
`,
    )
    try {
      execFileSync('/usr/sbin/nginx', ['-t', '-c', confPath, '-e', logPath], { stdio: 'pipe' })
    } finally {
      spy.mockRestore()
    }
  })

  it('opens frame-src for a YouTube embed and keeps style-src hashed', async () => {
    const doc = emptyPageDoc('Talk')
    doc.blocks = [{ id: 'b_emb1', type: 'Embed', v: 1, props: { embed: 'emb_00000000000000000000000001', title: 'A talk' } }]
    const rendered = await renderPageHtml({
      doc,
      pageId: 'pg_talk',
      versionId: 'ver_1',
      path: '/talk',
      site: site({
        embeds: {
          emb_00000000000000000000000001: { id: 'emb_00000000000000000000000001', provider: 'youtube', name: 'A talk', config: { videoId: 'dQw4w9wgGcQ' } },
        },
      }),
    })
    expect(rendered.csp).toContain('frame-src https://www.youtube-nocookie.com')
    expect(rendered.csp).toContain(STYLE_HASH)
    expect(rendered.csp).not.toContain('unsafe-inline')
    expect(rendered.html).toContain('youtube-nocookie.com/embed/dQw4w9wgGcQ')
  })

  it('records ids of internal pages a CTA or path link points to', async () => {
    const doc = emptyPageDoc('Home')
    doc.blocks = [{ id: 'b_cta1', type: 'CallToAction', v: 1, props: { heading: 'Read more', button: { label: 'About us', href: '/about-us' }, tone: 'accent' } }]
    const rendered = await renderPageHtml({
      doc,
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({ pagesById: { pg_about: { path: '/about-us', title: 'About us' }, pg_home: { path: '/', title: 'Home' } } }),
    })
    expect(rendered.deps.linkedPageIds).toContain('pg_about')
    expect(rendered.html).toContain('href="/about-us"')
  })

  it('renders the brand logo in the header with the site name as alt text, and favicon links', async () => {
    const logoId = 'med_00000000000000000000000009'
    const rendered = await renderPageHtml({
      doc: emptyPageDoc('Home'),
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({
        name: 'Hope for Street Animals',
        brand: { ...defaultBrandDoc(), logoMediaId: logoId },
        media: {
          [logoId]: {
            id: logoId,
            width: 600,
            height: 188,
            alt: 'Hope for Street Animals',
            decorative: false,
            status: 'ready',
            kind: 'image',
            mime: 'image/png',
            cropRatios: [],
          },
        },
      }),
    })
    expect(rendered.html).toContain('class="site-logo"')
    expect(rendered.html).toContain('alt="Hope for Street Animals"')
    expect(rendered.html).toContain('width="128"')
    expect(rendered.html).toContain('height="40"')
    expect(rendered.html).toContain('sizes="(max-width: 1023px) 134px, 224px"')
    expect(rendered.html).toContain(`/media/${logoId}-600.webp`)
    expect(rendered.html).toContain('rel="icon" href="/favicon.png"')
    expect(rendered.html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
    expect(rendered.html).not.toMatch(/>Hope for Street Animals<\/a>/)
    expect(rendered.deps.media).toContain(logoId)
  })

  it('uses the dark-background logo on a dark header, or a CSS filter when one is not set', async () => {
    const logoId = 'med_00000000000000000000000009'
    const darkId = 'med_0000000000000000000000000A'
    const entry = (id: string) => ({
      id,
      width: 600,
      height: 188,
      alt: 'Hope for Street Animals',
      decorative: false,
      status: 'ready' as const,
      kind: 'image',
      mime: 'image/png',
      cropRatios: [],
    })
    const header = { id: 'sp_header', doc: { ...(defaultSitePartDoc('header') as HeaderDoc), appearance: 'dark' as const } }
    const withDark = await renderPageHtml({
      doc: emptyPageDoc('Home'),
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({
        brand: { ...defaultBrandDoc(), logoMediaId: logoId, logoDarkMediaId: darkId },
        header,
        media: { [logoId]: entry(logoId), [darkId]: entry(darkId) },
      }),
    })
    expect(withDark.html).toContain('site-header-dark')
    expect(withDark.html).toContain(`/media/${darkId}-600.webp`)
    expect(withDark.html).not.toContain(`/media/${logoId}-600.webp`)
    expect(withDark.deps.media).toContain(darkId)

    const filtered = await renderPageHtml({
      doc: emptyPageDoc('Home'),
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({
        brand: { ...defaultBrandDoc(), logoMediaId: logoId },
        header,
        media: { [logoId]: entry(logoId) },
      }),
    })
    expect(filtered.html).toContain('site-logo-fallback-light')
    expect(filtered.html).toContain(`/media/${logoId}-600.webp`)
  })

  it('renders an SVG logo and an SVG image from the sanitised file', async () => {
    const logoId = 'med_0000000000000000000000000B'
    const imageId = 'med_0000000000000000000000000C'
    const svgEntry = (id: string) => ({
      id,
      width: 120,
      height: 40,
      alt: 'Candid',
      decorative: false,
      status: 'ready' as const,
      kind: 'svg',
      mime: 'image/svg+xml',
      cropRatios: [],
    })
    const doc = emptyPageDoc('Trust')
    doc.blocks = [
      {
        id: 'b_img',
        type: 'Image',
        v: 1,
        props: { image: { media: imageId, alt: 'Candid seal' }, caption: 'Candid' },
      },
    ]
    const rendered = await renderPageHtml({
      doc,
      pageId: 'pg_trust',
      versionId: 'ver_1',
      path: '/trust',
      site: site({
        brand: { ...defaultBrandDoc(), logoMediaId: logoId },
        media: { [logoId]: svgEntry(logoId), [imageId]: { ...svgEntry(imageId), alt: 'Candid seal' } },
      }),
    })
    expect(rendered.html).toContain(`/media/${logoId}.svg`)
    expect(rendered.html).toContain(`/media/${imageId}.svg`)
    expect(rendered.html).not.toContain(`/media/${logoId}-120.webp`)
  })

  it('falls back to the site name in the header when no logo is set', async () => {
    const rendered = await renderPageHtml({ doc: emptyPageDoc('Home'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site() })
    expect(rendered.html).toContain('>Test charity</a>')
    expect(rendered.html).not.toContain('class="site-logo"')
    expect(rendered.html).not.toContain('rel="icon" href="/favicon.png"')
  })

  it('renders impact tiers, a manual progress bar, and a match banner with a countdown hook', async () => {
    const doc = emptyPageDoc('Campaign')
    doc.blocks = [
      {
        id: 'b_tiers',
        type: 'ImpactTiers',
        v: 1,
        props: {
          heading: 'What your gift can do',
          intro: 'These are example amounts for this demo, not a live appeal.',
          items: [
            { amount: '₹500', title: 'A warm meal', explanation: 'Helps feed an animal in our care for a day.', frequency: 'once' },
            { amount: '₹2,000', title: 'Urgent treatment', explanation: 'Goes towards pain relief.', frequency: 'monthly' },
          ],
          cta: { label: 'Donate now', href: '#donate' },
        },
      },
      {
        id: 'b_prog',
        type: 'DonationProgress',
        v: 1,
        props: { heading: 'Sample progress', raised: '87,400', goal: '2,50,000', currency: '₹', label: 'raised so far (sample figures for this demo)' },
      },
      {
        id: 'b_match',
        type: 'MatchBanner',
        v: 1,
        props: { message: 'Sample match until the date below.', endDate: '2099-12-01', matchLine: 'Demonstration copy only.', tone: 'neutral', hideWhenPassed: true, cta: { label: 'Give now', href: '#donate' } },
      },
    ]
    const rendered = await renderPageHtml({ doc, pageId: 'pg_camp', versionId: 'ver_1', path: '/sample-blocks', site: site() })
    expect(rendered.html).toContain('class="tiers"')
    expect(rendered.html).toContain('₹500')
    expect(rendered.html).toContain('example amounts for this demo')
    expect(rendered.html).toContain('<progress')
    expect(rendered.html).toContain('value="35"')
    expect(rendered.html).toContain('₹87,400')
    expect(rendered.html).toContain('sample figures for this demo')
    expect(rendered.html).toContain('data-countdown="2099-12-01T23:59:59.000Z"')
    expect(rendered.html).toContain('src="/embed.js"')
    expect(rendered.html).toContain('href="#donate"')
    expect(rendered.html).toContain('class="tier-give"')
    expect(rendered.html).toContain('data-donate-amount="500"')
    expect(rendered.html).toContain('data-donate-frequency="once"')
    expect(rendered.html).toContain('data-donate-amount="2000"')
    expect(rendered.html).toContain('data-donate-frequency="monthly"')
    expect(rendered.html).toContain('One-time')
  })

  it('renders a Virtuous donation box with a pre-fill hint, and keeps the CSP to self plus the Virtuous origin', async () => {
    const doc = emptyPageDoc('Give')
    doc.blocks = [
      {
        id: 'b_tiers',
        type: 'ImpactTiers',
        v: 1,
        props: {
          heading: 'Give',
          items: [{ amount: '₹500', title: 'A meal' }],
        },
      },
      { id: 'b_form', type: 'DonationEmbed', v: 1, props: { embed: 'emb_00000000000000000000000009', heading: 'Give now', anchor: 'donate' } },
    ]
    const rendered = await renderPageHtml({
      doc,
      pageId: 'pg_give',
      versionId: 'ver_1',
      path: '/give',
      site: site({
        embeds: {
          emb_00000000000000000000000009: {
            id: 'emb_00000000000000000000000009',
            provider: 'virtuous',
            name: 'Demo form',
            config: { formId: 'example-form' },
          },
        },
      }),
    })
    expect(rendered.html).toContain('id="donate"')
    expect(rendered.html).toContain('data-embed="virtuous"')
    expect(rendered.html).toContain('data-vform="example-form"')
    expect(rendered.html).toContain('data-donate-hint')
    expect(rendered.html).not.toContain('loads here')
    expect(rendered.html).toContain('Give once')
    expect(rendered.html).toContain('>Monthly<')
    expect(rendered.html).toContain('$50')
    expect(rendered.html).toContain('Other amount')
    expect(rendered.html).toContain('Total')
    expect(rendered.html).toContain('Continue')
    expect(rendered.html).toContain('type="button"')
    expect(rendered.html).toContain('disabled')
    expect(rendered.html).not.toContain('<form')
    expect(rendered.html).not.toContain('action=')
    expect(rendered.html).toContain('class="donate"')
    expect(rendered.html).not.toContain('bg-warm')
    expect(rendered.html).toContain('src="/embed.js"')
    expect(rendered.csp).toContain("script-src 'self' https://cdn.virtuoussoftware.com")
    expect(rendered.csp).not.toContain('unsafe-inline')
    expect(rendered.csp).not.toContain('unsafe-eval')
    expect(EMBED_JS).toContain('searchParams.set("amount"')
    expect(EMBED_JS).toContain('RaiseDonorsForms')
    expect(EMBED_JS).toContain('data-donate-hint')
    expect(EMBED_JS).toContain('is-provider')
    expect(EMBED_JS).toContain('donate-preview')
    expect(EMBED_JS).not.toContain('fallback.hidden = false')

    const rupees = await renderPageHtml({
      doc,
      pageId: 'pg_give',
      versionId: 'ver_1',
      path: '/give',
      site: site({
        embeds: {
          emb_00000000000000000000000009: {
            id: 'emb_00000000000000000000000009',
            provider: 'virtuous',
            name: 'Demo form',
            config: { formId: 'example-form', currency: '₹' },
          },
        },
      }),
    })
    expect(rupees.html).toContain('₹50')
    expect(rupees.html).toContain('₹500')
    const messy = await renderPageHtml({
      doc,
      pageId: 'pg_give',
      versionId: 'ver_1',
      path: '/give',
      site: site({
        embeds: {
          emb_00000000000000000000000009: {
            id: 'emb_00000000000000000000000009',
            provider: 'virtuous',
            name: 'Demo form',
            config: { formId: 'example-form', currency: 'US $' },
          },
        },
      }),
    })
    expect(messy.html).toContain('$50')
    expect(messy.html).not.toContain('US $')
  })

  it('paints a section background only when the block asks for one, and Hero rejects the prop', async () => {
    const doc = emptyPageDoc('Rhythm')
    doc.blocks = [{ id: 'b_text0001', type: 'RichText', v: 1, props: { content: richTextFromParagraphs(['Hello']) } }]
    const plain = await renderPageHtml({ doc, pageId: 'pg_rhythm', versionId: 'ver_1', path: '/rhythm', site: site() })
    expect(plain.html).toContain('class="section"')
    expect(plain.html).not.toContain('bg-card')
    expect(plain.html).not.toContain('bg-warm')
    doc.blocks[0]!.props = { content: richTextFromParagraphs(['Hello']), background: 'card' }
    const card = await renderPageHtml({ doc, pageId: 'pg_rhythm', versionId: 'ver_1', path: '/rhythm', site: site() })
    expect(card.html).toContain('class="section bg-card"')
    expect(card.html).toContain('.bg-card{background:#fff}')
    expect(card.html).toContain('.bg-warm{background:')
    doc.blocks[0]!.props = { content: richTextFromParagraphs(['Hello']), background: 'warm' }
    const warm = await renderPageHtml({ doc, pageId: 'pg_rhythm', versionId: 'ver_1', path: '/rhythm', site: site() })
    expect(warm.html).toContain('class="section bg-warm"')
    expect(Hero.props.safeParse(Hero.sample).success).toBe(true)
    expect(Hero.props.safeParse({ ...Hero.sample, background: 'card' }).success).toBe(false)
  })

  it('renders the trust sample as names and logos, and still shows a note the editor sets', async () => {
    const sampleDoc = emptyPageDoc('Trust sample')
    sampleDoc.blocks = [{ id: 'b_trusts', type: 'TrustStrip', v: 1, props: TrustStrip.sample }]
    const sample = await renderPageHtml({ doc: sampleDoc, pageId: 'pg_tsamp', versionId: 'ver_1', path: '/tsamp', site: site() })
    expect(sample.html).toContain('Trusted by donors')
    expect(sample.html).not.toContain('Sample layout')
    expect(sample.html).not.toContain('class="trust-note"')
    expect(sample.html).not.toContain('Rated by')

    const noted = emptyPageDoc('Trust note')
    noted.blocks = [{ id: 'b_trustn', type: 'TrustStrip', v: 1, props: { heading: 'Marks', items: [{ name: 'Candid', logo: IMG, note: 'Editor note' }] } }]
    const withNote = await renderPageHtml({ doc: noted, pageId: 'pg_tnote', versionId: 'ver_1', path: '/tnote', site: site() })
    expect(withNote.html).toContain('class="trust-note"')
    expect(withNote.html).toContain('Editor note')
  })

  it('hides a match banner after its end date and renders a before-and-after story', async () => {
    const doc = emptyPageDoc('Story')
    doc.blocks = [
      { id: 'b_ended', type: 'MatchBanner', v: 1, props: { message: 'This should not be visible.', endDate: '2020-01-01', tone: 'neutral', hideWhenPassed: true } },
      {
        id: 'b_story',
        type: 'StoryBeforeAfter',
        v: 1,
        props: {
          eyebrow: 'A rescue story',
          heading: 'From the roadside to recovery',
          content: richTextFromParagraphs(['Sample story for the demo.']),
          quote: 'We did not know if she would make it.',
          attribution: 'A volunteer (sample quote)',
          before: IMG,
          beforeCaption: 'Before: arriving (sample photo)',
          after: IMG,
          afterCaption: 'After: recovering (sample photo)',
        },
      },
    ]
    const rendered = await renderPageHtml({ doc, pageId: 'pg_story', versionId: 'ver_1', path: '/sample-story', site: site() })
    expect(rendered.html).toContain('class="match-banner is-ended"')
    expect(rendered.html).not.toContain('This should not be visible.')
    expect(rendered.html).toContain('class="before-after"')
    expect(rendered.html).toContain('From the roadside to recovery')
    expect(rendered.html).toContain('Before: arriving (sample photo)')
    expect(rendered.deps.media).toContain(IMG.media)
  })

  it('renders grouped trust marks, opens CSP for a TripAdvisor badge script, and keeps logos quiet', async () => {
    const badge = '<div id="TA_rated696" class="TA_rated"><ul class="TA_links"><li><a href="https://www.tripadvisor.in/Attraction_Review-g297672-d12501287-Reviews-Animal_Aid_Unlimited-Udaipur_Udaipur_District_Rajasthan.html"><img src="https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_registered.png" alt="TripAdvisor"></a></li></ul></div><script async src="https://www.jscache.com/wejs?wtype=rated&uniq=696&locationId=12501287"></script>'
    const doc = emptyPageDoc('Trust')
    doc.blocks = [
      {
        id: 'b_trust',
        type: 'TrustStrip',
        v: 1,
        props: {
          eyebrow: 'Trusted',
          heading: 'Give with confidence',
          intro: 'Regulator ratings and travel recommendations are grouped separately.',
          items: [
            { name: 'Candid', logo: IMG, href: 'https://app.candid.org/profile/8069592/animal-aid-unlimited-71-0884843', group: 'Rated by' },
            { name: 'TripAdvisor', badgeHtml: badge, group: 'Recommended on' },
          ],
        },
      },
    ]
    const rendered = await renderPageHtml({ doc, pageId: 'pg_trust', versionId: 'ver_1', path: '/trust', site: site() })
    expect(rendered.html).toContain('<p class="eyebrow">Trusted</p>')
    expect(rendered.html).toContain('Rated by')
    expect(rendered.html).toContain('Recommended on')
    expect(rendered.html).toContain('class="trust-strip"')
    expect(rendered.html).toContain('id="TA_rated696"')
    expect(rendered.html).toContain('www.jscache.com/wejs')
    expect(rendered.csp).toContain('script-src')
    expect(rendered.csp).toContain('https://www.jscache.com')
    expect(rendered.csp).toContain('https://static.tacdn.com')
    expect(rendered.csp).toContain("img-src 'self' data: https://static.tacdn.com")
    expect(rendered.csp).not.toContain('unsafe-inline')
    expect(rendered.deps.media).toContain(IMG.media)
  })

})

function styleText(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/)
  if (!match?.[1]) throw new Error('missing style element')
  return match[1]
}

function treeContains(dir: string, needle: string): boolean {
  if (!existsSync(dir)) return false
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = lstatSync(path)
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) {
      if (treeContains(path, needle)) return true
      continue
    }
    if (readFileSync(path).includes(Buffer.from(needle))) return true
  }
  return false
}

describe('custom CSS in rendered HTML', () => {
  it('keeps a page with no CSS byte-identical to the theme style', async () => {
    const doc = emptyPageDoc('Plain')
    doc.blocks = [{ id: 'b_hero1', type: 'Hero', v: 1, props: { heading: 'Plain', image: IMG } }]
    const rendered = await renderPageHtml({ doc, pageId: 'pg_plain', versionId: 'ver_1', path: '/plain', site: site() })
    expect(rendered.html).toContain('<style>' + THEME_CSS + '</style>')
    expect(rendered.html).not.toContain('data-sb-css')
    expect(rendered.csp).toContain(STYLE_HASH)
    expect(rendered.html).toContain(escapeHtml(rendered.csp))
  })

  it('scopes one section, then matches the previous bytes when that CSS is removed', async () => {
    const doc = emptyPageDoc('Scoped')
    doc.blocks = [
      { id: 'b_hero1', type: 'Hero', v: 1, props: { heading: 'Scoped', image: IMG } },
      { id: 'b_text1', type: 'RichText', v: 1, props: { content: richTextFromParagraphs(['Hello']) } },
    ]
    const plain = await renderPageHtml({ doc, pageId: 'pg_scoped', versionId: 'ver_1', path: '/scoped', site: site() })
    doc.blocks[0]!.css = '.wrap { color: #123456 }'
    const styled = await renderPageHtml({ doc, pageId: 'pg_scoped', versionId: 'ver_1', path: '/scoped', site: site() })
    const css = styleText(styled.html)
    expect(css.startsWith(THEME_CSS)).toBe(true)
    expect(css.indexOf('[data-sb-css="b_hero1"]')).toBeGreaterThanOrEqual(THEME_CSS.length)
    expect(styled.html.match(/data-sb-css="b_hero1"/g)).toHaveLength(2)
    expect(styled.html).toContain('data-sb-css="b_hero1"')
    expect(styled.html).not.toContain('data-sb-css="b_text1"')
    expect(styled.csp).toContain(styleHash(css))
    expect(styled.html).toContain(escapeHtml(styled.csp))
    delete doc.blocks[0]!.css
    const again = await renderPageHtml({ doc, pageId: 'pg_scoped', versionId: 'ver_1', path: '/scoped', site: site() })
    expect(again.html).toBe(plain.html)
  })

  it('places site CSS after the theme and before section CSS, without a section prefix', async () => {
    const doc = emptyPageDoc('Brand')
    doc.blocks = [
      { id: 'b_hero1', type: 'Hero', v: 1, props: { heading: 'Brand', image: IMG }, css: '.wrap { color: #123456 }' },
      { id: 'b_text1', type: 'RichText', v: 1, props: { content: richTextFromParagraphs(['Hello']) } },
    ]
    const input = { doc, pageId: 'pg_brand', versionId: 'ver_1', path: '/brand' }
    const bare = await renderPageHtml({ ...input, site: site() })
    const plainBrand = validateBrandDoc(defaultBrandDoc())
    expect(plainBrand.ok).toBe(true)
    if (!plainBrand.ok) return
    expect(plainBrand.doc).not.toHaveProperty('customCss')
    const plain = await renderPageHtml({ ...input, site: site({ brand: plainBrand.doc }) })
    expect(styleText(plain.html)).toBe(styleText(bare.html))

    const validated = validateBrandDoc({ ...defaultBrandDoc(), customCss: 'a.sitewide { color: #abcdef }' })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const rendered = await renderPageHtml({ ...input, site: site({ brand: validated.doc }) })
    const css = styleText(rendered.html)
    const siteAt = css.indexOf('a.sitewide')
    const sectionAt = css.indexOf('[data-sb-css="b_hero1"]')
    expect(css.startsWith(THEME_CSS)).toBe(true)
    expect(siteAt).toBeGreaterThanOrEqual(THEME_CSS.length)
    expect(sectionAt).toBeGreaterThan(siteAt)
    expect(css.slice(0, sectionAt)).not.toContain('data-sb-css')
    expect(rendered.csp).toContain(styleHash(css))

    const cleared = validateBrandDoc({ ...validated.doc, customCss: ' \n ' })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.doc).not.toHaveProperty('customCss')
    const again = await renderPageHtml({ ...input, site: site({ brand: cleared.doc }) })
    expect(styleText(again.html)).toBe(styleText(bare.html))
  })

  it('refuses a style sheet over the page style cap', async () => {
    const doc = emptyPageDoc('Big')
    const rule = `.a{${'color:#112233;'.repeat(500)}}`
    expect(Buffer.byteLength(rule, 'utf8')).toBeLessThanOrEqual(8192)
    doc.blocks = Array.from({ length: 12 }, (_, i) => ({
      id: `b_big${String(i).padStart(2, '0')}`,
      type: 'Hero' as const,
      v: 1,
      props: { heading: 'Big', image: IMG },
      css: rule,
    }))
    await expect(renderPageHtml({ doc, pageId: 'pg_big', versionId: 'ver_1', path: '/big', site: site() })).rejects.toThrow('This page CSS is over the 89,143 byte limit.')
  })

  it('throws on hostile stored CSS and does not return HTML', async () => {
    const doc = emptyPageDoc('Hostile')
    doc.blocks = [{ id: 'b_hero1', type: 'Hero', v: 1, props: { heading: 'Hostile', image: IMG }, css: 'a { background: url(javascript:MARKER9f3c) }' }]
    await expect(renderPageHtml({ doc, pageId: 'pg_bad', versionId: 'ver_1', path: '/bad', site: site() })).rejects.toBeInstanceOf(CssRejected)
    try {
      await renderPageHtml({ doc, pageId: 'pg_bad', versionId: 'ver_1', path: '/bad', site: site() })
    } catch (error) {
      expect((error as Error).message).not.toContain('MARKER9f3c')
    }
  })
})

async function publishStandard(s: ReturnType<typeof setup>, title: string, heading: string) {
  const { page } = createPage(s.ctx, s.editor, { title, template: 'standard' })
  applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Hero', props: { heading, image: IMG } } }])
  const sub = submitPage(s.ctx, s.editor, page.id)
  const { jobId } = approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
  return { page, jobId, versionId: sub.versionId }
}

describe('published brand CSS', () => {
  it('writes the unprefixed rule after the theme, restores the previous style when it is cleared, and purges the shell', async () => {
    const s = setup({ selfApproval: true })
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sb-brand-css-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }
    const { page } = createPage(s.ctx, s.editor, { title: 'Home', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { id: 'b_css01', type: 'Hero', props: { heading: 'Hello', image: IMG } } }])
    applyPageOps(s.ctx, s.admin, page.id, getPage(s.ctx, page.id).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: '.wrap { color: #123456 }' }])
    const pageReview = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.admin, pageReview.reviewId, { versionId: pageReview.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const before = styleText(readFileSync(join(root, 'releases', readCurrentReleaseId(root)!, 'home', 'index.html'), 'utf8'))
    expect(before.startsWith(THEME_CSS)).toBe(true)
    expect(before).toContain('[data-sb-css="b_css01"]')
    expect(before).not.toContain('a.sitewide')

    const sheet = 'a.sitewide { color: #abcdef }'
    const saved = editBrand(s.ctx, s.admin, getBrand(s.ctx).revision, { ...defaultBrandDoc(), customCss: sheet })
    const brandReview = submitBrand(s.ctx, s.admin)
    approveReview(s.ctx, s.admin, brandReview.reviewId, { versionId: brandReview.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    expect(lastPurgeTags(s.ctx)).toEqual(['shell'])

    const styled = styleText(readFileSync(join(root, 'releases', readCurrentReleaseId(root)!, 'home', 'index.html'), 'utf8'))
    const siteAt = styled.indexOf('a.sitewide')
    const sectionAt = styled.indexOf('[data-sb-css="b_css01"]')
    expect(styled.startsWith(THEME_CSS)).toBe(true)
    expect(siteAt).toBeGreaterThanOrEqual(THEME_CSS.length)
    expect(sectionAt).toBeGreaterThan(siteAt)
    expect(styled.slice(0, sectionAt)).not.toContain('data-sb-css')

    const current = getBrand(s.ctx)
    editBrand(s.ctx, s.admin, current.revision, { ...current.doc, customCss: '  ' })
    const clearedReview = submitBrand(s.ctx, s.admin)
    approveReview(s.ctx, s.admin, clearedReview.reviewId, { versionId: clearedReview.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    expect(lastPurgeTags(s.ctx)).toEqual(['shell'])
    const cleared = styleText(readFileSync(join(root, 'releases', readCurrentReleaseId(root)!, 'home', 'index.html'), 'utf8'))
    expect(cleared).toBe(before)
    expect(saved.doc.customCss).toBe(sheet)
  })
})

describe('filesystem releases and Cloudflare purge', () => {
  it('publishes only changed pages, hard-links the rest, and writes sitemap, robots and cache-tag maps', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sitebuilder-release-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }

    const first = await publishStandard(s, 'Winter appeal', 'Keep them warm')
    while (await runJobsOnce(s.ctx, handlers)) {}
    expect(s.ctx.db.select().from(jobs).where(eq(jobs.id, first.jobId)).get()?.state).toBe('done')

    const release1 = currentRelease(s.ctx)!.id
    expect(readCurrentReleaseId(root)).toBe(release1)
    const pageFile = join(root, 'releases', release1, 'winter-appeal', 'index.html')
    expect(readFileSync(pageFile, 'utf8')).toContain('Keep them warm')
    expect(readFileSync(pageFile, 'utf8')).toContain('<style>')
    expect(readFileSync(join(root, 'releases', release1, 'sitemap.xml'), 'utf8')).toContain('https://example.org/winter-appeal')
    expect(readFileSync(join(root, 'releases', release1, 'robots.txt'), 'utf8')).toContain('Sitemap: https://example.org/sitemap.xml')
    const tags = readFileSync(join(root, 'releases', release1, 'cache-tags.map'), 'utf8')
    expect(tags).toContain(`page-${first.page.id} shell`)
    expect(tags).toContain('"/winter-appeal"')
    expect(readFileSync(join(root, 'releases', release1, 'csp.map'), 'utf8')).toContain('style-src')
    expect(existsSync(join(root, 'releases', release1, 'header.js'))).toBe(false)
    const inode1 = statSync(pageFile).ino

    const second = await publishStandard(s, 'About us', 'Who we are')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release2 = currentRelease(s.ctx)!.id
    expect(release2).not.toBe(release1)
    const kept = join(root, 'releases', release2, 'winter-appeal', 'index.html')
    expect(statSync(kept).ino).toBe(inode1)
    expect(readFileSync(join(root, 'releases', release2, 'about-us', 'index.html'), 'utf8')).toContain('Who we are')
    expect(readFileSync(join(root, 'releases', release2, 'sitemap.xml'), 'utf8')).toContain('/about-us')
    expect(readFileSync(join(root, 'releases', release2, 'sitemap.xml'), 'utf8')).toContain('/winter-appeal')

    unpublishPage(s.ctx, s.admin, second.page.id, '/')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release3 = currentRelease(s.ctx)!.id
    expect(existsSync(join(root, 'releases', release3, 'about-us', 'index.html'))).toBe(false)
    expect(readFileSync(join(root, 'releases', release3, 'sitemap.xml'), 'utf8')).not.toContain('/about-us')
    expect(s.ctx.db.select().from(redirects).all().some((r) => r.fromPath === '/about-us' && r.toPath === '/')).toBe(true)
    expect(readFileSync(join(root, 'releases', release3, 'redirects.map'), 'utf8')).toContain('"/about-us"')
  })

  it('writes hero.js for a carousel and keeps the hard-linked file when a later release drops it', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sb-hero-js-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }

    await publishStandard(s, 'Home', 'Keep them warm')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release1 = currentRelease(s.ctx)!.id
    expect(existsSync(join(root, 'releases', release1, 'hero.js'))).toBe(false)

    const { page } = createPage(s.ctx, s.editor, { title: 'Stories', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [
      {
        op: 'add_block',
        block: {
          id: 'b_herocar1',
          type: 'Hero',
          props: {
            heading: 'A warm bed tonight',
            mode: 'image-carousel',
            image: IMG,
            slides: [
              { image: IMG, heading: 'A warm bed tonight', subheading: 'Blankets for every kennel.' },
              { image: IMG, heading: 'Food and treatment' },
            ],
          },
        },
      },
    ])
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release2 = currentRelease(s.ctx)!.id
    const storyPath = getPage(s.ctx, page.id).page.path
    const storyHtml = readFileSync(join(root, 'releases', release2, htmlPathFor(storyPath)), 'utf8')
    expect(storyHtml).toContain('src="/hero.js"')
    const heroFile = join(root, 'releases', release2, 'hero.js')
    expect(readFileSync(heroFile, 'utf8')).toBe(HERO_JS)

    applyPageOps(s.ctx, s.editor, page.id, getPage(s.ctx, page.id).revision, [
      { op: 'update_props', blockId: 'b_herocar1', props: { mode: 'image' } },
    ])
    const dropped = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, dropped.reviewId, { versionId: dropped.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release3 = currentRelease(s.ctx)!.id
    const droppedHtml = readFileSync(join(root, 'releases', release3, htmlPathFor(storyPath)), 'utf8')
    expect(droppedHtml).not.toContain('src="/hero.js"')
    // hardLinkCopy keeps the previous release's hero.js. This writer does not unlink it when the new HTML has no carousel.
    const kept = join(root, 'releases', release3, 'hero.js')
    expect(existsSync(kept)).toBe(true)
    expect(statSync(kept).ino).toBe(statSync(heroFile).ino)
  })

  it('writes thermometer.js when a page has the block and keeps the file when a later release drops it', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sb-thermo-js-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }

    await publishStandard(s, 'Home', 'Keep them warm')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release1 = currentRelease(s.ctx)!.id
    expect(existsSync(join(root, 'releases', release1, 'thermometer.js'))).toBe(false)

    const { page } = createPage(s.ctx, s.editor, { title: 'Match', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [
      { op: 'add_block', block: { id: 'b_thermo01', type: 'MatchThermometer', props: MatchThermometer.sample as Record<string, unknown> } },
    ])
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release2 = currentRelease(s.ctx)!.id
    const storyPath = getPage(s.ctx, page.id).page.path
    const storyHtml = readFileSync(join(root, 'releases', release2, htmlPathFor(storyPath)), 'utf8')
    expect(storyHtml).toContain('src="/thermometer.js"')
    const thermoFile = join(root, 'releases', release2, 'thermometer.js')
    expect(readFileSync(thermoFile, 'utf8')).toBe(THERMOMETER_JS)

    applyPageOps(s.ctx, s.editor, page.id, getPage(s.ctx, page.id).revision, [
      { op: 'remove_block', blockId: 'b_thermo01' },
      { op: 'add_block', block: { id: 'b_rich0001', type: 'RichText', props: { content: richTextFromParagraphs(['Still here']) } } },
    ])
    const dropped = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, dropped.reviewId, { versionId: dropped.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release3 = currentRelease(s.ctx)!.id
    const droppedHtml = readFileSync(join(root, 'releases', release3, htmlPathFor(storyPath)), 'utf8')
    expect(droppedHtml).not.toContain('src="/thermometer.js"')
    const kept = join(root, 'releases', release3, 'thermometer.js')
    expect(existsSync(kept)).toBe(true)
    expect(statSync(kept).ino).toBe(statSync(thermoFile).ino)
  })

  it('re-renders live pages that link to a page when its address, title or live state changes', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sitebuilder-links-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }

    const about = await publishStandard(s, 'About us', 'Who we are')
    while (await runJobsOnce(s.ctx, handlers)) {}

    const { page: home } = createPage(s.ctx, s.editor, { title: 'Home', template: 'standard', slug: 'home' })
    applyPageOps(s.ctx, s.editor, home.id, 0, [
      { op: 'add_block', block: { type: 'CallToAction', props: { heading: 'Learn more', button: { label: 'About us', href: '/about-us' }, tone: 'accent' } } },
      { op: 'set_seo', description: 'Welcome' },
    ])
    const homeSub = submitPage(s.ctx, s.editor, home.id)
    approveReview(s.ctx, s.approver, homeSub.reviewId, { versionId: homeSub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const afterHome = currentRelease(s.ctx)!
    expect(afterHome.manifest.pages[home.id]?.linkedPageIds).toContain(about.page.id)
    const homeFile = join(root, 'releases', afterHome.id, 'home', 'index.html')
    expect(readFileSync(homeFile, 'utf8')).toContain('href="/about-us"')
    const homeInode = statSync(homeFile).ino

    applyPageOps(s.ctx, s.editor, about.page.id, getPage(s.ctx, about.page.id).revision, [{ op: 'set_meta', slug: 'who-we-are' }])
    const moved = submitPage(s.ctx, s.editor, about.page.id)
    approveReview(s.ctx, s.approver, moved.reviewId, { versionId: moved.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const afterMove = currentRelease(s.ctx)!
    const movedHome = join(root, 'releases', afterMove.id, 'home', 'index.html')
    expect(readFileSync(movedHome, 'utf8')).toContain('href="/who-we-are"')
    expect(readFileSync(movedHome, 'utf8')).not.toContain('href="/about-us"')
    expect(statSync(movedHome).ino).not.toBe(homeInode)
    expect(lastPurgeTags(s.ctx)).toEqual(expect.arrayContaining([`page-${about.page.id}`, `page-${home.id}`]))
    expect(lastPurgeTags(s.ctx)).not.toContain('shell')

    const inodeAfterMove = statSync(movedHome).ino
    applyPageOps(s.ctx, s.editor, about.page.id, getPage(s.ctx, about.page.id).revision, [{ op: 'set_seo', description: 'A longer about page' }])
    const bodyOnly = submitPage(s.ctx, s.editor, about.page.id)
    approveReview(s.ctx, s.approver, bodyOnly.reviewId, { versionId: bodyOnly.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const afterBody = currentRelease(s.ctx)!
    expect(statSync(join(root, 'releases', afterBody.id, 'home', 'index.html')).ino).toBe(inodeAfterMove)
    expect(lastPurgeTags(s.ctx)).toEqual([`page-${about.page.id}`])

    applyPageOps(s.ctx, s.editor, about.page.id, getPage(s.ctx, about.page.id).revision, [{ op: 'set_meta', title: 'Our story' }])
    const renamed = submitPage(s.ctx, s.editor, about.page.id)
    approveReview(s.ctx, s.approver, renamed.reviewId, { versionId: renamed.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const afterTitle = currentRelease(s.ctx)!
    expect(statSync(join(root, 'releases', afterTitle.id, 'home', 'index.html')).ino).not.toBe(inodeAfterMove)
    expect(lastPurgeTags(s.ctx)).toEqual(expect.arrayContaining([`page-${about.page.id}`, `page-${home.id}`]))

    const inodeBeforeOff = statSync(join(root, 'releases', afterTitle.id, 'home', 'index.html')).ino
    unpublishPage(s.ctx, s.admin, about.page.id, '/')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const afterOff = currentRelease(s.ctx)!
    // The stored link is still the old path (a redirect now covers it), but the page is rewritten and purged.
    expect(statSync(join(root, 'releases', afterOff.id, 'home', 'index.html')).ino).not.toBe(inodeBeforeOff)
    expect(lastPurgeTags(s.ctx)).toEqual(expect.arrayContaining([`page-${about.page.id}`, `page-${home.id}`]))
  })

  it('skips a Cloudflare purge when the zone is not set, and purges tags when it is', async () => {
    const s = setup()
    const prevZone = process.env.SITEBUILDER_CLOUDFLARE_ZONE_ID
    const prevToken = process.env.SITEBUILDER_CLOUDFLARE_TOKEN
    delete process.env.SITEBUILDER_CLOUDFLARE_ZONE_ID
    delete process.env.SITEBUILDER_CLOUDFLARE_TOKEN
    const handler = createPurgeCacheHandler()
    const skipped = await handler.run(s.ctx, { id: 'job_1', kind: 'purge_cache', payload: { tags: ['page-pg_x'] } } as never)
    expect(skipped).toEqual({ skipped: 'Cloudflare zone or token is not configured.' })

    process.env.SITEBUILDER_CLOUDFLARE_ZONE_ID = 'zone-test'
    process.env.SITEBUILDER_CLOUDFLARE_TOKEN = 'token-test'
    const calls: { url: string; body: unknown }[] = []
    let attempts = 0
    setPurgeHttp(async (url, init) => {
      attempts++
      if (attempts === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })
    try {
      const result = await handler.run(s.ctx, { id: 'job_2', kind: 'purge_cache', payload: { tags: ['page-pg_x', 'shell'] } } as never)
      expect(result).toEqual({ purged: ['page-pg_x', 'shell'] })
      expect(calls[0]?.url).toContain('/zones/zone-test/purge_cache')
      expect(calls[0]?.body).toEqual({ tags: ['page-pg_x', 'shell'] })
    } finally {
      setPurgeHttp(null)
      if (prevZone) process.env.SITEBUILDER_CLOUDFLARE_ZONE_ID = prevZone
      else delete process.env.SITEBUILDER_CLOUDFLARE_ZONE_ID
      if (prevToken) process.env.SITEBUILDER_CLOUDFLARE_TOKEN = prevToken
      else delete process.env.SITEBUILDER_CLOUDFLARE_TOKEN
    }
  })

  it('re-renders live pages and analytics.js when a settings rebuild runs', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sitebuilder-settings-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }
    await publishStandard(s, 'Winter appeal', 'Keep them warm')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const release1 = currentRelease(s.ctx)!.id
    const before = readFileSync(join(root, 'releases', release1, 'winter-appeal', 'index.html'), 'utf8')
    expect(before).not.toContain('/analytics.js')

    const tracking = { ga4: 'G-ABC123XYZ', gtm: null, plausible: null, cookiebot: null }
    const saved = updateSettings(s.ctx, s.admin, { tracking: { ga4: tracking.ga4 } })
    expect(saved.rebuilding).toBe(true)
    while (await runJobsOnce(s.ctx, handlers)) {}

    const release2 = currentRelease(s.ctx)!
    expect(release2.id).not.toBe(release1)
    expect(release2.kind).toBe('full_render')
    const html = readFileSync(join(root, 'releases', release2.id, 'winter-appeal', 'index.html'), 'utf8')
    expect(html).toContain('<script src="/analytics.js" defer></script>')
    expect(html).toContain('https://www.googletagmanager.com')
    expect(html).toContain('https://www.google-analytics.com')
    expect(readFileSync(join(root, 'releases', release1, 'winter-appeal', 'index.html'), 'utf8')).toBe(before)
    const csp = readFileSync(join(root, 'releases', release2.id, 'csp.map'), 'utf8')
    expect(csp).toContain('https://www.googletagmanager.com')
    expect(csp).toContain('https://www.google-analytics.com')
    expect(readFileSync(join(root, 'releases', release2.id, 'analytics.js'), 'utf8')).toBe(renderAnalyticsJs(tracking))
    expect(lastPurgeTags(s.ctx)).toEqual(['shell'])
    const rebuilt = s.ctx.db.select().from(auditEvents).all().find((event) => event.action === 'site.rebuilt')
    expect(rebuilt?.details).toEqual({ reason: 'settings' })
    expect(rebuilt?.actorType).toBe('system')
    expect(s.ctx.db.select().from(releases).where(eq(releases.id, release2.id)).get()?.createdBy).toBe('system')
    s.sqlite.close()
  })
})

function lastPurgeTags(ctx: { db: ReturnType<typeof setup>['ctx']['db'] }): string[] {
  const rows = ctx.db.select().from(jobs).where(eq(jobs.kind, 'purge_cache')).all()
  const row = rows.at(-1)
  return ((row?.payload as { tags?: string[] } | undefined)?.tags) ?? []
}

describe('site origin', () => {
  it('prefers the primary domain, then PUBLIC_HOST, and ignores the compose placeholder', () => {
    expect(siteOrigin('sb-demo.moejo.co', '_')).toBe('https://sb-demo.moejo.co')
    expect(siteOrigin(null, 'sb-demo.moejo.co')).toBe('https://sb-demo.moejo.co')
    expect(siteOrigin('', '_')).toBe(null)
    expect(siteOrigin(null, '_')).toBe(null)
    expect(siteOrigin(null, undefined)).toBe(null)
  })

  it('emits an absolute Sitemap URL once an origin is known', () => {
    expect(robotsTxt(site({ origin: 'https://sb-demo.moejo.co' }))).toContain('Sitemap: https://sb-demo.moejo.co/sitemap.xml')
    expect(robotsTxt(site({ origin: null }))).toContain('Sitemap: /sitemap.xml')
  })
})

async function testWordmarkPng() {
  const mark = await sharp({ create: { width: 90, height: 90, channels: 4, background: { r: 230, g: 120, b: 40, alpha: 1 } } }).png().toBuffer()
  const word = await sharp({ create: { width: 160, height: 40, channels: 4, background: { r: 5, g: 83, b: 103, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: mark, left: 10, top: 15 },
      { input: word, left: 130, top: 40 },
    ])
    .png()
    .toBuffer()
}

describe('published brand logo', () => {
  it('puts the logo in the live header and writes favicon files from the mark', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ name: 'Hope for Street Animals', primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const mediaDir = mkdtempSync(join(tmpdir(), 'sb-logo-media-'))
    const root = mkdtempSync(join(tmpdir(), 'sb-logo-release-'))
    const { media } = await uploadMedia(s.ctx, s.admin, { filename: 'logo.png', data: await testWordmarkPng(), mediaDir })
    updateMedia(s.ctx, s.admin, media.id, { alt: 'Hope for Street Animals' })
    const writer = createFileReleaseWriter(root, { keep: 10, mediaDir })
    const handlers = {
      media_renditions: createMediaRenditionsHandler(mediaDir),
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }
    await runJobsOnce(s.ctx, handlers)

    await publishStandard(s, 'Home', 'Welcome')
    while (await runJobsOnce(s.ctx, handlers)) {}

    editBrand(s.ctx, s.admin, 0, { ...defaultBrandDoc(), logoMediaId: media.id, menuStyle: 'centred' })
    const sub = submitBrand(s.ctx, s.admin)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const releaseId = readCurrentReleaseId(root)!
    const html = readFileSync(join(root, 'releases', releaseId, 'home', 'index.html'), 'utf8')
    expect(html).toContain('class="site-logo"')
    expect(html).toContain('alt="Hope for Street Animals"')
    expect(html).toContain(`/media/${media.id}-`)
    expect(html).toContain('rel="icon" href="/favicon.png"')
    expect(html).toContain('site-header-centred')
    expect(html).not.toMatch(/>Hope for Street Animals<\/a>/)

    const favicon = join(root, 'releases', releaseId, 'favicon.png')
    const apple = join(root, 'releases', releaseId, 'apple-touch-icon.png')
    expect(existsSync(favicon)).toBe(true)
    expect(existsSync(apple)).toBe(true)
    expect((await sharp(favicon).metadata()).width).toBe(32)
    expect((await sharp(apple).metadata()).width).toBe(180)
    // The favicon should be the left-hand orange mark, not a tiny squeezed wordmark.
    const { dominant } = await sharp(favicon).stats()
    expect(dominant.r).toBeGreaterThan(dominant.b)
    expect(dominant.r).toBeGreaterThan(100)
  })
})

describe('published photos', () => {
  it('every image URL on a published page with a cropped photo narrower than the standard widths exists', async () => {
    const s = setup()
    const { approveCrop } = await import('../server/services/media')
    const { readdirSync } = await import('node:fs')
    const mediaDir = mkdtempSync(join(tmpdir(), 'sb-crop-media-'))
    const root = mkdtempSync(join(tmpdir(), 'sb-crop-release-'))
    const photo = await sharp({ create: { width: 1024, height: 700, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg().toBuffer()
    const { media } = await uploadMedia(s.ctx, s.admin, { filename: 'dog.jpg', data: photo, mediaDir })
    updateMedia(s.ctx, s.admin, media.id, { alt: 'A dog after treatment' })
    const writer = createFileReleaseWriter(root, { keep: 10, mediaDir })
    const handlers = {
      media_renditions: createMediaRenditionsHandler(mediaDir),
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }
    await runJobsOnce(s.ctx, handlers)
    // A 4:3 crop of a 1024x700 photo is 933 wide: there is no 960 or 1024 version of the crop.
    approveCrop(s.ctx, s.admin, media.id, { ratio: '4:3', rect: { x: 45, y: 0, width: 933, height: 700 } })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const { page } = createPage(s.ctx, s.editor, { title: 'Rescue', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [
      { op: 'add_block', block: { type: 'Hero', props: { heading: 'Rescue', image: { media: media.id, alt: 'A dog' } } } },
      { op: 'add_block', block: { type: 'TextAndImage', props: { heading: 'Healed', content: richTextFromParagraphs(['Better now.']), image: { media: media.id, alt: 'A dog' } } } },
    ])
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const html = readFileSync(join(root, 'releases', readCurrentReleaseId(root)!, 'rescue', 'index.html'), 'utf8')
    expect(html).toContain(`/media/${media.id}-4x3-933.webp`)
    const onDisk = new Set(readdirSync(join(mediaDir, 'renditions')))
    const urls = [...html.matchAll(/\/media\/([A-Za-z0-9_.-]+\.(?:webp|avif))/g)].map((m) => m[1]!)
    expect(urls.length).toBeGreaterThan(4)
    expect(urls.filter((u) => !onDisk.has(u))).toEqual([])
  })

  it('leaves out a photo or video that is not in the library instead of publishing a broken image', async () => {
    const doc = emptyPageDoc('Gift')
    doc.blocks = [
      { id: 'b_ti1', type: 'TextAndImage', v: 1, props: { heading: 'How your gift helps', content: richTextFromParagraphs(['Food and care.']), image: { media: 'med_00000000000000000000000001', alt: 'Sample' } } },
      { id: 'b_vh1', type: 'VideoHero', v: 1, props: { heading: 'Winter', poster: { media: 'med_00000000000000000000000001', alt: 'Sample' }, video: 'med_00000000000000000000000002' } },
    ]
    doc.blocks.reverse() // a video hero first also gets a preload link
    doc.seo.image = 'med_00000000000000000000000001'
    const rendered = await renderPageHtml({ doc, pageId: 'pg_gift', versionId: 'ver_1', path: '/gift', site: site({ mediaComplete: true }) })
    expect(rendered.html).toContain('How your gift helps')
    expect(rendered.html).not.toContain('med_00000000000000000000000001')
    expect(rendered.html).not.toContain('med_00000000000000000000000002')
    expect(rendered.html).not.toContain('<video')
  })

  it('will not submit a page whose photo is not in the media library', async () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'Broken', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Hero', props: { heading: 'Broken', image: { media: 'med_000000000000000000000000ZZ', alt: 'A dog' } } } }])
    let err: any
    try {
      submitPage(s.ctx, s.editor, page.id)
    } catch (e) {
      err = e
    }
    expect(err?.code).toBe('validation_failed')
    expect(err.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'blocks.0.props.image', message: expect.stringMatching(/not in the media library/) })]))
  })
})

describe('published custom CSS', () => {
  it('writes the style hash into the page and into csp.map', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ primaryDomain: 'example.org' }).where(eq(sites.id, s.ctx.siteId)).run()
    const root = mkdtempSync(join(tmpdir(), 'sb-css-release-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }
    const { page } = createPage(s.ctx, s.editor, { title: 'Styled page', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { id: 'b_css01', type: 'Hero', props: { heading: 'Styled', image: IMG } } }])
    const draft = getPage(s.ctx, page.id)
    const doc = structuredClone(draft.doc)
    const block = doc.blocks.find((item) => item.id === 'b_css01')
    if (!block) throw new Error('missing section')
    block.css = '.wrap { color: #123456 }'
    s.ctx.db.update(versions).set({ doc }).where(eq(versions.id, draft.page.draftVersionId!)).run()
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}

    const releaseId = readCurrentReleaseId(root)!
    const html = readFileSync(join(root, 'releases', releaseId, 'styled-page', 'index.html'), 'utf8')
    const css = styleText(html)
    const hash = styleHash(css)
    expect(html).toContain('data-sb-css="b_css01"')
    const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ''
    expect(meta).toContain(escapeHtml(hash))
    expect(readFileSync(join(root, 'releases', releaseId, 'csp.map'), 'utf8')).toContain(hash)
  })

  it('does not write rejected CSS into a release', async () => {
    const s = setup()
    const root = mkdtempSync(join(tmpdir(), 'sb-css-reject-'))
    const writer = createFileReleaseWriter(root, { keep: 10 })
    const handlers = {
      publish: createPublishHandler(writer),
      send_email: { run: () => ({ skipped: true }) },
      purge_cache: { run: () => ({ skipped: true }) },
    }
    const { page } = createPage(s.ctx, s.editor, { title: 'Bad css', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { id: 'b_css01', type: 'Hero', props: { heading: 'Bad', image: IMG } } }])
    const draft = getPage(s.ctx, page.id)
    const doc = structuredClone(draft.doc)
    const block = doc.blocks.find((item) => item.id === 'b_css01')
    if (!block) throw new Error('missing section')
    block.css = '.wrap { color: #123456 }'
    s.ctx.db.update(versions).set({ doc }).where(eq(versions.id, draft.page.draftVersionId!)).run()
    const sub = submitPage(s.ctx, s.editor, page.id)
    const { jobId } = approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId })
    const sealed = s.ctx.db.select().from(versions).where(eq(versions.id, sub.versionId)).get()
    const hostile = structuredClone(sealed!.doc) as { blocks: { id?: string; css?: string }[] }
    const target = hostile.blocks.find((item) => item.id === 'b_css01')
    if (!target) throw new Error('missing section')
    target.css = '@import "https://evil.example/MARKER9f3c.css";'
    s.ctx.db.update(versions).set({ doc: hostile }).where(eq(versions.id, sub.versionId)).run()
    await runJobsOnce(s.ctx, handlers)
    const job = s.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get()
    expect(job?.state).not.toBe('done')
    expect(job?.lastError ?? '').not.toContain('MARKER9f3c')
    expect(currentRelease(s.ctx)).toBeUndefined()
    expect(treeContains(root, 'MARKER9f3c')).toBe(false)
    expect(s.ctx.db.select().from(releases).all().every((row) => !(row.error ?? '').includes('MARKER9f3c'))).toBe(true)
  })
})

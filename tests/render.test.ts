import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { jobs, redirects, sites } from '../server/db/schema'
import { createPurgeCacheHandler, setPurgeHttp } from '../server/services/cloudflare'
import { editBrand, submitBrand } from '../server/services/brand'
import { createMediaRenditionsHandler, updateMedia, uploadMedia } from '../server/services/media'
import { applyPageOps, createPage, getPage } from '../server/services/pages'
import { createPublishHandler, currentRelease, unpublishPage } from '../server/services/publish'
import { createFileReleaseWriter, readCurrentReleaseId } from '../server/services/release'
import { approveReview, submitPage } from '../server/services/reviews'
import {
  STYLE_HASH,
  THEME_CSS,
  htmlPathFor,
  nginxMapLines,
  publicUrl,
  renderPageHtml,
  robotsTxt,
  siteOrigin,
  sitemapXml,
  type SiteRenderContext,
} from '../server/services/render'
import { emptyPageDoc } from '../shared/page'
import { defaultBrandDoc } from '../shared/brand'
import { richTextFromParagraphs } from '../shared/richtext'
import { runJobsOnce } from '../server/services/jobs'
import { IMG, setup } from './helpers'

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
  })

  it('lists both pretty and file URIs in an nginx map', () => {
    const map = nginxMapLines([{ uri: '/about', value: 'page-pg_about shell' }])
    expect(map).toContain('"/about" "page-pg_about shell";')
    expect(map).toContain('"/about/" "page-pg_about shell";')
    expect(map).toContain('"/about/index.html" "page-pg_about shell";')
    expect(publicUrl('https://example.org', '/about')).toBe('https://example.org/about')
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
    expect(rendered.html).toContain(`/media/${logoId}-600.webp`)
    expect(rendered.html).toContain('rel="icon" href="/favicon.png"')
    expect(rendered.html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
    expect(rendered.html).not.toMatch(/>Hope for Street Animals<\/a>/)
    expect(rendered.deps.media).toContain(logoId)
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
            { amount: '₹500', title: 'A warm meal', explanation: 'Helps feed an animal in our care for a day.' },
            { amount: '₹2,000', title: 'Urgent treatment', explanation: 'Goes towards pain relief.' },
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

async function publishStandard(s: ReturnType<typeof setup>, title: string, heading: string) {
  const { page } = createPage(s.ctx, s.editor, { title, template: 'standard' })
  applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Hero', props: { heading, image: IMG } } }])
  const sub = submitPage(s.ctx, s.editor, page.id)
  const { jobId } = approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
  return { page, jobId, versionId: sub.versionId }
}

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

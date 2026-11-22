import { describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { runJobsOnce } from '../server/services/jobs'
import { applyPageOps, binPage, createPage } from '../server/services/pages'
import { createPublishHandler, currentRelease, rollbackSite } from '../server/services/publish'
import { approveReview, getReview, sendBackReview, submitPage } from '../server/services/reviews'
import { createSitePart, editSitePart, getSitePart, listSiteParts, listSitePartVersions, submitSitePart } from '../server/services/site-parts'
import { defaultSitePartDoc, sitePartLinks, validateSitePartDoc, type BannerDoc, type FooterDoc, type HeaderDoc } from '../shared/site-parts'
import { richTextFromParagraphs } from '../shared/richtext'
import { setup } from './helpers'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof AppError) return e.code
    throw e
  }
  return 'ok'
}

const handlers = { publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }

async function livePage(s: ReturnType<typeof setup>, title: string) {
  const { page } = createPage(s.ctx, s.editor, { title, template: 'standard' })
  applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'set_seo', description: `${title} page` }])
  const sub = submitPage(s.ctx, s.editor, page.id)
  approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
  await runJobsOnce(s.ctx, handlers)
  return page
}

describe('site part documents', () => {
  it('validates menus, headers, footers and banners', () => {
    expect(validateSitePartDoc('menu', defaultSitePartDoc('menu')).ok).toBe(true)
    expect(validateSitePartDoc('header', { schemaVersion: 1 }).ok).toBe(true)
    expect(validateSitePartDoc('menu', { schemaVersion: 1, items: [{ id: 'b_aaaa1111', label: 'Home', target: { type: 'url', url: 'javascript:alert(1)' } }] }).ok).toBe(false)
    expect(validateSitePartDoc('menu', { schemaVersion: 1, items: [{ id: 'b_aaaa1111', label: 'A', target: { type: 'url', url: '/' } }, { id: 'b_aaaa1111', label: 'B', target: { type: 'url', url: '/b' } }] }).ok).toBe(false)
    // Two levels only: children cannot have children.
    expect(validateSitePartDoc('menu', { schemaVersion: 1, items: [{ id: 'b_aaaa1111', label: 'A', target: { type: 'url', url: '/' }, children: [{ id: 'b_bbbb2222', label: 'B', target: { type: 'url', url: '/b' }, children: [] }] }] }).ok).toBe(false)
    expect(validateSitePartDoc('banner', { schemaVersion: 1, enabled: true, message: '' }).ok).toBe(false)
    expect(validateSitePartDoc('footer', { schemaVersion: 1, social: [{ network: 'instagram', url: 'http://insecure.example' }] }).ok).toBe(false)
  })
})

describe('site parts', () => {
  it('edits, submits, approves and publishes a menu, and rollback resets it', async () => {
    const s = setup()
    const menuId = createSitePart(s.ctx, 'menu', 'main', 'Main menu')
    const about = await livePage(s, 'About us')
    const draftPage = createPage(s.ctx, s.editor, { title: 'Volunteer', template: 'standard' }).page
    const before = currentRelease(s.ctx)!

    expect(code(() => editSitePart(s.ctx, s.editor, menuId, 0, defaultSitePartDoc('menu')))).toBe('forbidden')
    const doc = {
      schemaVersion: 1,
      items: [
        { id: 'b_home0001', label: 'Home', target: { type: 'url', url: '/' } },
        { id: 'b_about001', label: 'About us', target: { type: 'page', pageId: about.id }, children: [{ id: 'b_vol00001', label: 'Volunteer', target: { type: 'page', pageId: draftPage.id } }] },
      ],
    }
    const r = editSitePart(s.ctx, s.approver, menuId, 0, doc)
    expect(r.revision).toBe(1)
    expect(r.warnings.map((w) => w.message)).toEqual(['"Volunteer" links to a page that isn\'t live yet.'])
    expect(code(() => editSitePart(s.ctx, s.admin, menuId, 0, doc))).toBe('conflict')
    expect(code(() => editSitePart(s.ctx, s.approver, menuId, 1, { schemaVersion: 1, items: [{ id: 'b_x0000001', label: 'Gone', target: { type: 'page', pageId: 'pg_nope' } }] }))).toBe('validation_failed')

    // A menu that links to a page stops that page being binned.
    expect(code(() => binPage(s.ctx, s.editor, draftPage.id))).toBe('invalid_state')

    const sub = submitSitePart(s.ctx, s.approver, menuId)
    expect(sub.summary).toBe('New main menu')
    expect(getReview(s.ctx, s.admin, sub.reviewId).target.type).toBe('site_part')
    expect(code(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }))).toBe('forbidden')
    approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId })
    await runJobsOnce(s.ctx, handlers)
    const part = getSitePart(s.ctx, menuId)
    expect(part.part.workflowState).toBe('published')
    expect(part.part.publishedVersionId).toBe(sub.versionId)
    expect(currentRelease(s.ctx)!.manifest.siteParts[menuId]).toBe(sub.versionId)
    expect(currentRelease(s.ctx)!.manifest.pages[about.id]).toBeTruthy()
    expect(listSiteParts(s.ctx).find((p) => p.id === menuId)?.isLive).toBe(true)
    expect(listSitePartVersions(s.ctx, menuId).length).toBeGreaterThanOrEqual(2)

    await rollbackSite(s.ctx, s.admin, before.id, 'Menu broke the layout')
    expect(getSitePart(s.ctx, menuId).part.publishedVersionId).toBeNull()
    expect(getSitePart(s.ctx, menuId).part.workflowState).toBe('draft')
  })

  it('editing withdraws a pending review and send back returns it to rest', () => {
    const s = setup()
    const id = createSitePart(s.ctx, 'banner', 'banner', 'Banner')
    editSitePart(s.ctx, s.approver, id, 0, { schemaVersion: 1, enabled: true, message: 'Winter appeal now on' })
    const sub = submitSitePart(s.ctx, s.approver, id)
    expect(getSitePart(s.ctx, id).part.workflowState).toBe('in_review')
    const r = editSitePart(s.ctx, s.approver, id, 1, { schemaVersion: 1, enabled: true, message: 'Winter appeal: double your gift' })
    expect(r.reviewWithdrawn).toBe(true)
    expect(code(() => approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId }))).toBe('invalid_state')
    const sub2 = submitSitePart(s.ctx, s.approver, id)
    sendBackReview(s.ctx, s.admin, sub2.reviewId, 'Shorter please')
    expect(getSitePart(s.ctx, id).part.workflowState).toBe('draft')
  })

  it('does not withdraw a pending review when the same draft is saved again', () => {
    const s = setup()
    const id = createSitePart(s.ctx, 'banner', 'banner', 'Banner')
    const doc = { schemaVersion: 1 as const, enabled: true, message: 'Winter appeal now on' }
    const saved = editSitePart(s.ctx, s.approver, id, 0, doc)
    submitSitePart(s.ctx, s.approver, id)
    const again = editSitePart(s.ctx, s.approver, id, saved.revision, doc)
    expect(again.reviewWithdrawn).toBe(false)
    expect(again.revision).toBe(saved.revision)
    expect(getSitePart(s.ctx, id).part.workflowState).toBe('in_review')
  })
})

const oldHeader = {
  schemaVersion: 1,
  style: 'mega',
  menuKey: 'main',
  cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' } },
  appearance: 'dark',
}
const oldFooter = {
  schemaVersion: 1,
  text: richTextFromParagraphs(['We help street animals.']),
  contact: { email: 'hello@example.org', phone: '+44 20 7946 0000', address: '1 High Street' },
  social: [{ network: 'facebook', url: 'https://facebook.com/example' }],
  legalMenuKey: 'legal',
  charityNumber: '1234567',
  appearance: 'light',
}
const oldBanner = { schemaVersion: 1, enabled: true, message: 'Winter appeal is open', tone: 'info' }

describe('site parts saved before the optional shell fields', () => {
  it('parses old header, footer and banner documents and fills the new defaults', () => {
    const header = validateSitePartDoc('header', oldHeader)
    const headerBare = validateSitePartDoc('header', { schemaVersion: 1 })
    const footer = validateSitePartDoc('footer', oldFooter)
    const banner = validateSitePartDoc('banner', oldBanner)
    const bannerBare = validateSitePartDoc('banner', { schemaVersion: 1, enabled: false })
    expect(header.ok && headerBare.ok && footer.ok && banner.ok && bannerBare.ok).toBe(true)
    if (!header.ok || !headerBare.ok || !footer.ok || !banner.ok || !bannerBare.ok) return
    expect(header.doc.utility).toBeNull()
    expect(header.doc.cta?.icon).toBeUndefined()
    expect(headerBare.doc.cta).toBeNull()
    expect(headerBare.doc.utility).toBeNull()
    expect(footer.doc.layout).toBe('simple')
    expect(footer.doc.tagline).toBeNull()
    expect(footer.doc.contactTitle).toBeNull()
    expect(footer.doc.linksTitle).toBeNull()
    expect(footer.doc.linksMenuKey).toBeNull()
    expect(footer.doc.legalText).toBeNull()
    expect(banner.doc.tone).toBe('info')
    expect(bannerBare.doc.tone).toBe('info')
    expect(validateSitePartDoc('header', header.doc).ok).toBe(true)
    expect(validateSitePartDoc('footer', footer.doc).ok).toBe(true)
    expect(validateSitePartDoc('banner', banner.doc).ok).toBe(true)
  })

  it('accepts the new options and rejects values outside the enums', () => {
    expect(validateSitePartDoc('banner', { schemaVersion: 1, enabled: true, message: 'Give today', tone: 'accent' }).ok).toBe(true)
    expect(validateSitePartDoc('banner', { schemaVersion: 1, enabled: true, message: 'Give today', tone: 'brand' }).ok).toBe(false)
    expect(validateSitePartDoc('header', { schemaVersion: 1, cta: { label: 'Donate', icon: 'heart', target: { type: 'url', url: 'https://example.org/donate' } } }).ok).toBe(true)
    expect(validateSitePartDoc('header', { schemaVersion: 1, cta: { label: 'Donate', icon: 'star', target: { type: 'url', url: 'https://example.org/donate' } } }).ok).toBe(false)
    const columns = validateSitePartDoc('footer', {
      schemaVersion: 1,
      layout: 'columns',
      tagline: { lead: 'For the animals', accent: 'every day' },
      contactTitle: 'Talk to us',
      linksTitle: 'More',
      linksMenuKey: 'footer-links',
      legalText: 'Registered charity.',
    })
    expect(columns.ok).toBe(true)
    expect(validateSitePartDoc('footer', { schemaVersion: 1, layout: 'grid' }).ok).toBe(false)
    expect(validateSitePartDoc('footer', { schemaVersion: 1, legalText: 'x'.repeat(201) }).ok).toBe(false)
    expect(validateSitePartDoc('footer', { schemaVersion: 1, tagline: { lead: '' } }).ok).toBe(false)
    const withUtility = validateSitePartDoc('header', {
      ...oldHeader,
      utility: { label: 'Report an animal', target: { type: 'url', url: 'https://example.org/report' } },
    })
    expect(withUtility.ok).toBe(true)
    if (!withUtility.ok) return
    expect(sitePartLinks('header', withUtility.doc).map((l) => l.path)).toEqual(['cta.target', 'utility.target'])
    const parsedOld = validateSitePartDoc('header', oldHeader)
    if (!parsedOld.ok) return
    expect(sitePartLinks('header', parsedOld.doc).map((l) => l.path)).toEqual(['cta.target'])
  })

  it('saves an old-shape header, footer and banner through the editor save path', () => {
    const s = setup()
    const headerId = createSitePart(s.ctx, 'header', 'header', 'Header')
    const footerId = createSitePart(s.ctx, 'footer', 'footer', 'Footer')
    const bannerId = createSitePart(s.ctx, 'banner', 'banner', 'Banner')
    const headerSaved = editSitePart(s.ctx, s.approver, headerId, 0, oldHeader)
    const footerSaved = editSitePart(s.ctx, s.approver, footerId, 0, oldFooter)
    const bannerSaved = editSitePart(s.ctx, s.approver, bannerId, 0, oldBanner)
    const headerDoc = headerSaved.doc as HeaderDoc
    const footerDoc = footerSaved.doc as FooterDoc
    const bannerDoc = bannerSaved.doc as BannerDoc
    expect(headerDoc.utility).toBeNull()
    expect(headerDoc.cta?.icon).toBeUndefined()
    expect(headerDoc.style).toBe('mega')
    expect(footerDoc.layout).toBe('simple')
    expect(footerDoc.tagline).toBeNull()
    expect(footerDoc.linksMenuKey).toBeNull()
    expect(footerDoc.legalText).toBeNull()
    expect(footerDoc.contact.email).toBe('hello@example.org')
    expect(bannerDoc.tone).toBe('info')
    expect(getSitePart(s.ctx, headerId).doc).toEqual(headerSaved.doc)
    expect(getSitePart(s.ctx, footerId).doc).toEqual(footerSaved.doc)
    expect(getSitePart(s.ctx, bannerId).doc).toEqual(bannerSaved.doc)
  })
})

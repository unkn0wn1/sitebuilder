import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { runJobsOnce } from '../server/services/jobs'
import { createPage } from '../server/services/pages'
import { currentRelease } from '../server/services/publish'
import { approveReview, submitPage } from '../server/services/reviews'
import { createSitePart, editSitePart, publishUntouchedStarterPart, requireSitePart } from '../server/services/site-parts'
import { siteParts } from '../server/db/schema'
import { createPublishHandler } from '../server/services/publish'
import { setup } from './helpers'

const handlers = { publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }

describe('starter header, menu and footer', () => {
  it('a part made live at setup is in the first release', async () => {
    const s = setup()
    const menu = createSitePart(s.ctx, 'menu', 'main', 'Main menu', s.admin, { live: true })
    const footer = createSitePart(s.ctx, 'footer', 'footer', 'Footer', s.admin, { live: true })
    const header = createSitePart(s.ctx, 'header', 'header', 'Header', s.admin, { live: true })
    const legal = createSitePart(s.ctx, 'menu', 'legal', 'Legal menu', s.admin)
    expect(requireSitePart(s.ctx, menu)).toMatchObject({ workflowState: 'published' })
    expect(requireSitePart(s.ctx, menu).publishedVersionId).toBe(requireSitePart(s.ctx, menu).draftVersionId)
    expect(requireSitePart(s.ctx, legal).publishedVersionId).toBeNull()

    const { page } = createPage(s.ctx, s.editor, { title: 'Home', template: 'standard' })
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    await runJobsOnce(s.ctx, handlers)
    const manifest = currentRelease(s.ctx)!.manifest
    expect(manifest.siteParts[menu]).toBe(requireSitePart(s.ctx, menu).publishedVersionId)
    expect(manifest.siteParts[footer]).toBeTruthy()
    expect(manifest.siteParts[header]).toBeTruthy()
    expect(manifest.siteParts[legal]).toBeUndefined()
  })

  it('running setup again makes an untouched starter live, but never one someone has edited', () => {
    const s = setup()
    const untouched = createSitePart(s.ctx, 'footer', 'footer', 'Footer', s.admin)
    const edited = createSitePart(s.ctx, 'menu', 'main', 'Main menu', s.admin)
    editSitePart(s.ctx, s.admin, edited, 0, { schemaVersion: 1, items: [{ id: 'b_menu0001', label: 'Home', target: { type: 'url', url: '/' }, children: [] }] })
    expect(publishUntouchedStarterPart(s.ctx, untouched)).toBe(true)
    expect(publishUntouchedStarterPart(s.ctx, untouched)).toBe(false)
    expect(publishUntouchedStarterPart(s.ctx, edited)).toBe(false)
    expect(s.ctx.db.select().from(siteParts).where(eq(siteParts.id, edited)).get()!.publishedVersionId).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { createPublishHandler, currentRelease, rollbackSite, unpublishPage } from '../server/services/publish'
import { applyPageOps, createPage, getPage } from '../server/services/pages'
import { approveReview, getReview, sendBackReview, submitPage } from '../server/services/reviews'
import { runJobsOnce } from '../server/services/jobs'
import { setup, IMG, EMB } from './helpers'
import { auditEvents, jobs, notifications } from '../server/db/schema'
import { eq } from 'drizzle-orm'

async function expectErr(fn: () => unknown, code: string) {
  try {
    await fn()
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    expect((e as AppError).code).toBe(code)
    return e as AppError
  }
  throw new Error(`expected ${code}`)
}

const handlers = { publish: createPublishHandler(), send_email: { run: () => ({ skipped: true }) }, purge_cache: { run: () => ({ skipped: true }) } }

function campaign(s: ReturnType<typeof setup>) {
  const { page } = createPage(s.ctx, s.editor, { title: 'Winter appeal', template: 'campaign' })
  const r = applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Hero', props: { heading: 'Keep them warm', image: IMG } } }])
  return { page, revision: r.revision, heroId: r.doc.blocks[0]!.id }
}

describe('submit, approve, publish', () => {
  it('blocks submission until required sections and alt text are there', async () => {
    const s = setup()
    const { page, revision, heroId } = campaign(s)
    const e = await expectErr(() => submitPage(s.ctx, s.editor, page.id), 'validation_failed')
    expect(e.fields?.map((f) => f.message).join(' ')).toMatch(/needs a "DonationEmbed"/)
    applyPageOps(s.ctx, s.editor, page.id, revision, [
      { op: 'add_block', block: { type: 'DonationEmbed', props: { embed: EMB } } },
      { op: 'update_props', blockId: heroId, props: { image: { media: IMG.media } } },
    ])
    const e2 = await expectErr(() => submitPage(s.ctx, s.editor, page.id), 'validation_failed')
    expect(e2.fields?.[0]?.message).toMatch(/alt text/)
  })

  it('pins approval to the submitted version and withdraws on edit', async () => {
    const s = setup()
    const { page, revision, heroId } = campaign(s)
    applyPageOps(s.ctx, s.editor, page.id, revision, [{ op: 'add_block', block: { type: 'DonationEmbed', props: { embed: EMB } } }])
    const sub = submitPage(s.ctx, s.editor, page.id, { note: 'For December' })
    expect(sub.summary).toMatch(/Added hero/)
    expect(getPage(s.ctx, page.id).page.workflowState).toBe('in_review')
    await expectErr(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: 'ver_wrong' }), 'invalid_state')
    // Editing withdraws the review.
    const r = applyPageOps(s.ctx, s.editor, page.id, getPage(s.ctx, page.id).revision, [{ op: 'update_props', blockId: heroId, props: { heading: 'Warmer' } }])
    expect(r.reviewWithdrawn).toBe(true)
    expect(getPage(s.ctx, page.id).page.workflowState).toBe('draft')
    await expectErr(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }), 'invalid_state')
  })

  it('approves, publishes through the job, records a release, and notifies', async () => {
    const s = setup()
    const { page, revision } = campaign(s)
    applyPageOps(s.ctx, s.editor, page.id, revision, [{ op: 'add_block', block: { type: 'DonationEmbed', props: { embed: EMB } } }])
    const sub = submitPage(s.ctx, s.editor, page.id)
    await expectErr(() => approveReview(s.ctx, s.editor, sub.reviewId, { versionId: sub.versionId }), 'forbidden')
    const { jobId } = approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    expect(getPage(s.ctx, page.id).page.workflowState).toBe('approved')
    await expectErr(() => applyPageOps(s.ctx, s.editor, page.id, getPage(s.ctx, page.id).revision, [{ op: 'set_meta', title: 'x' }]), 'invalid_state')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const job = s.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get()!
    expect(job.state).toBe('done')
    const p = getPage(s.ctx, page.id).page
    expect(p.workflowState).toBe('published')
    expect(p.publishedVersionId).toBe(sub.versionId)
    expect(currentRelease(s.ctx)?.manifest.pages[page.id]).toEqual({ versionId: sub.versionId, path: '/winter-appeal' })
    const kinds = s.ctx.db.select().from(notifications).all().map((n) => n.kind)
    expect(kinds).toContain('review_requested')
    expect(kinds).toContain('published')
    // Further edits make a new draft while the live page stays the same.
    applyPageOps(s.ctx, s.editor, page.id, getPage(s.ctx, page.id).revision, [{ op: 'set_meta', title: 'Winter appeal 2026' }])
    const after = getPage(s.ctx, page.id).page
    expect(after.workflowState).toBe('published')
    expect(after.draftVersionId).not.toBe(after.publishedVersionId)
  })

  it('applies self-approval rules', async () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.approver, { title: 'About', template: 'standard' })
    applyPageOps(s.ctx, s.approver, page.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'Hi' } } }])
    const sub = submitPage(s.ctx, s.approver, page.id)
    const e = await expectErr(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }), 'forbidden')
    expect(e.message).toMatch(/self-approval/)
    s.setSelfApproval(true)
    expect(approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }).selfApproved).toBe(true)
  })

  it('send back returns the page to its resting state with the comment', async () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'About', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'Hi' } } }])
    const sub = submitPage(s.ctx, s.editor, page.id)
    await expectErr(() => sendBackReview(s.ctx, s.approver, sub.reviewId, '  '), 'validation_failed')
    sendBackReview(s.ctx, s.approver, sub.reviewId, 'Less sad photo please')
    expect(getPage(s.ctx, page.id).page.workflowState).toBe('draft')
    expect(getReview(s.ctx, s.editor, sub.reviewId).review.decisionComment).toBe('Less sad photo please')
  })

  it('site rollback resets database pointers to the release manifest, admin only, logged', async () => {
    const s = setup()
    const publish = async (pageId: string, by = s.editor) => {
      const sub = submitPage(s.ctx, by, pageId)
      approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
      while (await runJobsOnce(s.ctx, handlers)) {}
      return sub.versionId
    }
    const a = createPage(s.ctx, s.editor, { title: 'A', template: 'standard' }).page
    applyPageOps(s.ctx, s.editor, a.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'v1' } } }])
    const a1 = await publish(a.id)
    const release1 = currentRelease(s.ctx)!
    applyPageOps(s.ctx, s.editor, a.id, getPage(s.ctx, a.id).revision, [{ op: 'set_meta', title: 'A two' }])
    await publish(a.id)
    const b = createPage(s.ctx, s.editor, { title: 'B', template: 'standard' }).page
    applyPageOps(s.ctx, s.editor, b.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'b' } } }])
    await publish(b.id)

    await expectErr(() => rollbackSite(s.ctx, s.approver, release1.id, 'oops'), 'forbidden')
    await expectErr(() => rollbackSite(s.ctx, s.admin, release1.id, ''), 'validation_failed')
    await rollbackSite(s.ctx, s.admin, release1.id, 'Bad change on A')
    expect(getPage(s.ctx, a.id).page.publishedVersionId).toBe(a1)
    expect(getPage(s.ctx, b.id).page.publishedVersionId).toBeNull()
    expect(getPage(s.ctx, b.id).page.workflowState).toBe('unpublished')
    expect(currentRelease(s.ctx)?.kind).toBe('rollback')
    expect(s.ctx.db.select().from(auditEvents).all().some((e) => e.action === 'site.rolled_back')).toBe(true)
  })

  it('unpublish takes a page offline through the publish queue and can leave a redirect', async () => {
    const s = setup()
    const a = createPage(s.ctx, s.editor, { title: 'Old', template: 'standard' }).page
    applyPageOps(s.ctx, s.editor, a.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'x' } } }])
    const sub = submitPage(s.ctx, s.editor, a.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    await expectErr(() => unpublishPage(s.ctx, s.editor, a.id), 'forbidden')
    unpublishPage(s.ctx, s.approver, a.id, '/')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const p = getPage(s.ctx, a.id).page
    expect(p.workflowState).toBe('unpublished')
    expect(currentRelease(s.ctx)?.manifest.pages[a.id]).toBeUndefined()
  })

  it('a failed publish returns the review to pending after the last attempt', async () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'P', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'x' } } }])
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    const broken = { ...handlers, publish: createPublishHandler({ writeRelease: () => { throw new Error('disk full') }, switchCurrent: () => {} }) }
    for (let i = 0; i < 4; i++) {
      await runJobsOnce(s.ctx, broken, ['publish'])
      s.clock.advance(11 * 60_000)
    }
    expect(getPage(s.ctx, page.id).page.workflowState).toBe('in_review')
    expect(getReview(s.ctx, s.approver, sub.reviewId).review.state).toBe('pending')
  })
})

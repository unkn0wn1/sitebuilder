import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { jobs, versions } from '../server/db/schema'
import { editBrand, submitBrand } from '../server/services/brand'
import { AppError } from '../server/services/errors'
import { runJobsOnce } from '../server/services/jobs'
import { applyPageOps, createPage, getPage } from '../server/services/pages'
import { createPublishHandler, currentRelease } from '../server/services/publish'
import { approveReview, approveReviewDirect, submitPage } from '../server/services/reviews'
import { renderDraftPreview, renderSitePartPreview } from '../server/services/draft-preview'
import { defaultBrandDoc } from '../shared/brand'
import { IMG, setup } from './helpers'

const MARKER = 'MARKER9f3c'
const handlers = { publish: createPublishHandler(), send_email: { run: () => ({ skipped: true }) }, purge_cache: { run: () => ({ skipped: true }) } }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof AppError) return error.code
    throw error
  }
  return 'ok'
}

function message(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof AppError) return error.message
    throw error
  }
  return ''
}

function withCss(s: ReturnType<typeof setup>, css: string) {
  const { page } = createPage(s.ctx, s.editor, { title: 'Winter appeal', template: 'standard' })
  applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { id: 'b_css01', type: 'Hero', props: { heading: 'Keep them warm', image: IMG } } }])
  const draft = getPage(s.ctx, page.id)
  const doc = structuredClone(draft.doc)
  const block = doc.blocks.find((item) => item.id === 'b_css01')
  if (!block) throw new Error('missing section')
  block.css = css
  s.ctx.db.update(versions).set({ doc }).where(eq(versions.id, draft.page.draftVersionId!)).run()
  return page.id
}

describe('approving custom CSS', () => {
  it('lets an editor store and submit CSS, and only an admin can approve or publish it', async () => {
    const s = setup()
    const pageId = withCss(s, '.wrap { color: #123456 }')
    const edited = applyPageOps(s.ctx, s.editor, pageId, getPage(s.ctx, pageId).revision, [{ op: 'update_props', blockId: 'b_css01', props: { heading: 'Still warm' } }])
    expect(edited.doc.blocks.find((block) => block.id === 'b_css01')?.css).toBe('.wrap { color: #123456 }')
    const sub = submitPage(s.ctx, s.editor, pageId)
    expect(message(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }))).toBe('Custom CSS changes need an admin to approve them.')
    expect(code(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }))).toBe('forbidden')
    const agent = { ...s.approver, agent: { tokenId: 'tok_css_test', tokenName: 'CSS test' } }
    expect(code(() => approveReviewDirect(s.ctx, agent, sub.reviewId, { versionId: sub.versionId, basis: 'rule', via: 'rule' }))).toBe('forbidden')
    const { jobId } = approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId })
    s.ctx.db.update(jobs).set({ createdBy: s.approver.id }).where(eq(jobs.id, jobId)).run()
    await runJobsOnce(s.ctx, handlers)
    const job = s.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get()
    expect(job?.state).not.toBe('done')
    expect(job?.lastError ?? '').toContain('admin')
    expect(job?.lastError ?? '').not.toContain('#123456')
    expect(currentRelease(s.ctx)).toBeUndefined()
  })

  it('needs an admin to approve removal of a section that has CSS', async () => {
    const s = setup()
    const pageId = withCss(s, '.wrap { color: #123456 }')
    const first = submitPage(s.ctx, s.editor, pageId)
    approveReview(s.ctx, s.admin, first.reviewId, { versionId: first.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    applyPageOps(s.ctx, s.editor, pageId, getPage(s.ctx, pageId).revision, [
      { op: 'add_block', block: { type: 'RichText', props: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Still here.' }] }] } } } },
      { op: 'remove_block', blockId: 'b_css01' },
    ])
    const second = submitPage(s.ctx, s.editor, pageId)
    expect(message(() => approveReview(s.ctx, s.approver, second.reviewId, { versionId: second.versionId }))).toBe('Custom CSS changes need an admin to approve them.')
    expect(code(() => approveReview(s.ctx, s.approver, second.reviewId, { versionId: second.versionId }))).toBe('forbidden')
    expect(code(() => approveReview(s.ctx, s.admin, second.reviewId, { versionId: second.versionId }))).toBe('ok')
  })

  it('lets an approver publish a later edit that does not change the CSS', async () => {
    const s = setup()
    const pageId = withCss(s, '.wrap { color: #123456 }')
    const first = submitPage(s.ctx, s.editor, pageId)
    approveReview(s.ctx, s.admin, first.reviewId, { versionId: first.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    applyPageOps(s.ctx, s.editor, pageId, getPage(s.ctx, pageId).revision, [{ op: 'update_props', blockId: 'b_css01', props: { heading: 'A new headline' } }])
    const second = submitPage(s.ctx, s.editor, pageId)
    expect(code(() => approveReview(s.ctx, s.approver, second.reviewId, { versionId: second.versionId }))).toBe('ok')
  })

  it('requires an admin when brand customCss changes, and not for a colour change', async () => {
    const s = setup({ selfApproval: true })
    const colour = { ...defaultBrandDoc(), tokens: { ...defaultBrandDoc().tokens, accent: '#123456' } }
    const saved = editBrand(s.ctx, s.admin, 0, colour)
    const plain = submitBrand(s.ctx, s.admin)
    expect(code(() => approveReview(s.ctx, s.approver, plain.reviewId, { versionId: plain.versionId }))).toBe('ok')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const colourPurge = s.ctx.db.select().from(jobs).where(eq(jobs.kind, 'purge_cache')).all().at(-1)
    expect((colourPurge?.payload as { tags?: string[] } | undefined)?.tags).toEqual(['shell'])

    editBrand(s.ctx, s.admin, saved.revision, { ...colour, tokens: { ...colour.tokens, ink: '#112233' } })
    const sub = submitBrand(s.ctx, s.admin)
    const row = s.ctx.db.select().from(versions).where(eq(versions.id, sub.versionId)).get()
    s.ctx.db.update(versions).set({ doc: { ...(row!.doc as Record<string, unknown>), customCss: `a { color: red } /* ${MARKER} */` } }).where(eq(versions.id, sub.versionId)).run()
    const refused = message(() => approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId }))
    expect(refused).toBe('Custom CSS changes need an admin to approve them.')
    expect(refused).not.toContain(MARKER)
    expect(code(() => approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId }))).toBe('ok')
    while (await runJobsOnce(s.ctx, handlers)) {}
    const cssPurge = s.ctx.db.select().from(jobs).where(eq(jobs.kind, 'purge_cache')).all().at(-1)
    expect((cssPurge?.payload as { tags?: string[] } | undefined)?.tags).toEqual(['shell'])
  })
})

describe('draft preview of bad CSS', () => {
  it('returns a validation error and does not echo the CSS', async () => {
    const s = setup()
    const doc = {
      schemaVersion: 1,
      title: 'Preview',
      seo: { title: null, description: null, image: null, canonical: null, noindex: false },
      blocks: [{ id: 'b_css01', type: 'Hero', v: 1, props: { heading: 'Hi', image: IMG }, css: `a { background: url(javascript:${MARKER}) }` }],
    }
    await expect(renderDraftPreview(s.ctx, doc)).rejects.toMatchObject({ code: 'validation_failed' })
    try {
      await renderDraftPreview(s.ctx, doc)
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const app = error as AppError
      expect(app.message).toMatch(/^Line \d+, column \d+:/)
      expect(app.message).not.toContain(MARKER)
    }
  })

  it('shows the same error for a site-part preview of a stored page', async () => {
    const s = setup()
    const pageId = withCss(s, '.wrap { color: #123456 }')
    const sub = submitPage(s.ctx, s.editor, pageId)
    approveReview(s.ctx, s.admin, sub.reviewId, { versionId: sub.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    const liveId = getPage(s.ctx, pageId).page.publishedVersionId
    const row = s.ctx.db.select().from(versions).where(eq(versions.id, liveId!)).get()
    const doc = structuredClone(row!.doc) as { blocks: { css?: string }[] }
    doc.blocks[0]!.css = `a { background: url(javascript:${MARKER}) }`
    s.ctx.db.update(versions).set({ doc }).where(eq(versions.id, liveId!)).run()
    await expect(renderSitePartPreview(s.ctx, { parts: [], pageId })).rejects.toMatchObject({ code: 'validation_failed' })
    try {
      await renderSitePartPreview(s.ctx, { parts: [], pageId })
    } catch (error) {
      expect((error as AppError).message).not.toContain(MARKER)
    }
  })
})

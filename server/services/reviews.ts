// Submitting, approving and sending back. Approval is pinned to one version.
// See ADR 0005 and docs/13-data-model.md#reviews-pin-a-version.
import { and, desc, eq } from 'drizzle-orm'
import { runChecks } from '../../shared/checks'
import { diffPages, type PageDiff } from '../../shared/diff'
import { newId } from '../../shared/ids'
import { validatePageDoc, type PageDoc } from '../../shared/page'
import { atLeast, can } from '../../shared/roles'
import { canSubmit, restingState } from '../../shared/workflow'
import { pages, reviewComments, reviews, sites } from '../db/schema'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { enqueueJob } from './jobs'
import { notify, usersWithRoles } from './notify'
import { readDoc, requirePage, sealDraft } from './pages'
import { getTemplateRules } from './templates'

export type ReviewRow = typeof reviews.$inferSelect

export function siteSettings(ctx: ServiceCtx): { workflow?: { selfApproval?: boolean } } {
  return (ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.settings ?? {}) as { workflow?: { selfApproval?: boolean } }
}

export function requireReview(ctx: ServiceCtx, id: string): ReviewRow {
  const r = ctx.db.select().from(reviews).where(and(eq(reviews.id, id), eq(reviews.siteId, ctx.siteId))).get()
  if (!r) throw notFound('That review')
  return r
}

export function summariseDiff(diff: PageDiff, type: (t: string) => string): string {
  const parts: string[] = []
  for (const c of diff.blocks) {
    if (c.kind === 'added') parts.push(`added ${type(c.type)}`)
    if (c.kind === 'removed') parts.push(`removed ${type(c.type)}`)
    if (c.kind === 'changed') parts.push(`changed ${type(c.type)}`)
    if (c.kind === 'moved') parts.push(`moved ${type(c.type)}`)
  }
  if (diff.meta.includes('title')) parts.push('changed the title')
  if (diff.meta.some((m) => m.startsWith('seo.'))) parts.push('changed search settings')
  if (!parts.length) return 'No changes'
  const s = parts.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function checksFor(ctx: ServiceCtx, template: string, doc: PageDoc) {
  const rules = getTemplateRules(ctx, template)
  const valid = validatePageDoc(doc, ctx.registry, rules, { enforceRequired: false })
  const checks = runChecks(doc, ctx.registry, rules)
  if (!valid.ok) checks.blocking.unshift(...valid.issues)
  return checks
}

export function submitPage(ctx: ServiceCtx, actor: ActingAs, pageId: string, input: { note?: string; overrideReason?: string } = {}) {
  if (!can(actor, 'page.submit')) throw forbidden()
  return inTx(ctx, () => {
    const page = requirePage(ctx, pageId)
    if (!canSubmit(page.workflowState)) {
      throw new AppError('invalid_state', page.workflowState === 'in_review' ? 'This page is already waiting for approval.' : 'This page is being published.')
    }
    if (page.draftVersionId === page.publishedVersionId) throw new AppError('invalid_state', 'There are no changes to submit.')
    const doc = readDoc(ctx, page.draftVersionId!)
    const checks = checksFor(ctx, page.template, doc)
    if (checks.blocking.length) {
      if (!input.overrideReason) throw new AppError('validation_failed', 'Fix these before submitting.', checks.blocking, { warnings: checks.warnings })
      if (!atLeast(actor.role, 'approver')) throw forbidden('Only approvers can submit with problems left in.')
    }
    const live = page.publishedVersionId ? readDoc(ctx, page.publishedVersionId) : null
    const summary = summariseDiff(diffPages(live, doc), (t) => ctx.registry.get(t)?.label.toLowerCase() ?? t)
    const versionId = sealDraft(ctx, pageId, actor, 'submitted', summary)
    const id = newId('review', ctx.now().getTime())
    ctx.db
      .insert(reviews)
      .values({ id, siteId: ctx.siteId, targetType: 'page', targetId: pageId, versionId, state: 'pending', note: input.note ?? null, changeSummary: summary, submittedBy: actor.id, overrideReason: input.overrideReason ?? null, createdAt: iso(ctx) })
      .run()
    ctx.db.update(pages).set({ workflowState: 'in_review', updatedAt: iso(ctx) }).where(eq(pages.id, pageId)).run()
    audit(ctx, actor, 'review.submitted', { type: 'page', id: pageId }, { reviewId: id, versionId, overrideReason: input.overrideReason ?? null })
    notify(ctx, usersWithRoles(ctx, ['approver', 'admin']).filter((u) => u !== actor.id), 'review_requested', `"${page.title}" is waiting for approval.`, { type: 'review', id })
    return { reviewId: id, versionId, summary, warnings: checks.warnings }
  })
}

export function approveReview(ctx: ServiceCtx, actor: ActingAs, reviewId: string, input: { versionId: string; overrideReason?: string }) {
  if (actor.aiSessionId) throw forbidden('The assistant cannot approve.')
  if (!can(actor, 'review.decide')) throw forbidden()
  return inTx(ctx, () => {
    const review = requireReview(ctx, reviewId)
    if (review.state !== 'pending') throw new AppError('invalid_state', review.state === 'withdrawn' ? 'This page changed after it was submitted. It needs submitting again.' : 'This review has already been decided.')
    if (input.versionId !== review.versionId) throw new AppError('invalid_state', "This isn't the version that was submitted. Reload the review.")
    const page = requirePage(ctx, review.targetId)

    const selfApproved = review.submittedBy === actor.id
    if (selfApproved && !siteSettings(ctx).workflow?.selfApproval) {
      throw forbidden("You can't approve your own changes. Ask another approver, or an admin can turn on self-approval in Settings > Workflow.")
    }

    const doc = readDoc(ctx, review.versionId)
    const checks = checksFor(ctx, page.template, doc)
    if (checks.blocking.length && !input.overrideReason) {
      throw new AppError('validation_failed', 'There are problems to fix, or approve with a reason.', checks.blocking)
    }

    const jobId = enqueueJob(ctx, 'publish', { reviewId }, { createdBy: actor.id })
    ctx.db
      .update(reviews)
      .set({ state: 'approved', decidedBy: actor.id, decidedAt: iso(ctx), selfApproved, overrideReason: input.overrideReason ?? review.overrideReason, jobId })
      .where(eq(reviews.id, reviewId))
      .run()
    ctx.db.update(pages).set({ workflowState: 'approved', updatedAt: iso(ctx) }).where(eq(pages.id, page.id)).run()
    audit(ctx, actor, 'review.approved', { type: 'page', id: page.id }, { reviewId, versionId: review.versionId, selfApproved, overrideReason: input.overrideReason ?? null })
    return { jobId, selfApproved }
  })
}

export function sendBackReview(ctx: ServiceCtx, actor: ActingAs, reviewId: string, comment: string) {
  if (!can(actor, 'review.decide')) throw forbidden()
  if (!comment.trim()) throw new AppError('validation_failed', 'Add a comment so they know what to change.', [{ path: 'comment', message: 'Needed.' }])
  return inTx(ctx, () => {
    const review = requireReview(ctx, reviewId)
    if (review.state !== 'pending') throw new AppError('invalid_state', 'This review has already been decided.')
    const page = requirePage(ctx, review.targetId)
    ctx.db.update(reviews).set({ state: 'sent_back', decidedBy: actor.id, decidedAt: iso(ctx), decisionComment: comment }).where(eq(reviews.id, reviewId)).run()
    ctx.db
      .update(pages)
      .set({ workflowState: restingState({ publishedVersionId: page.publishedVersionId, wasUnpublished: page.wasUnpublished }), updatedAt: iso(ctx) })
      .where(eq(pages.id, page.id))
      .run()
    audit(ctx, actor, 'review.sent_back', { type: 'page', id: page.id }, { reviewId, comment })
    notify(ctx, [review.submittedBy], 'sent_back', `"${page.title}" was sent back: ${comment}`, { type: 'page', id: page.id })
  })
}

export function addReviewComment(ctx: ServiceCtx, actor: ActingAs, reviewId: string, body: string, blockId?: string) {
  const review = requireReview(ctx, reviewId)
  if (review.submittedBy !== actor.id && !can(actor, 'review.read')) throw forbidden()
  const id = newId('comment', ctx.now().getTime())
  ctx.db.insert(reviewComments).values({ id, siteId: ctx.siteId, reviewId, blockId: blockId ?? null, authorId: actor.id, body, createdAt: iso(ctx) }).run()
  return { id }
}

export function listReviews(ctx: ServiceCtx, state?: ReviewRow['state']) {
  return ctx.db
    .select()
    .from(reviews)
    .where(and(eq(reviews.siteId, ctx.siteId), state ? eq(reviews.state, state) : undefined))
    .orderBy(desc(reviews.createdAt))
    .limit(100)
    .all()
}

export function getReview(ctx: ServiceCtx, actor: ActingAs, reviewId: string) {
  const review = requireReview(ctx, reviewId)
  if (review.submittedBy !== actor.id && !can(actor, 'review.read')) throw forbidden()
  const page = requirePage(ctx, review.targetId)
  const doc = readDoc(ctx, review.versionId)
  const live = page.publishedVersionId ? readDoc(ctx, page.publishedVersionId) : null
  const comments = ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewId, reviewId)).all()
  return {
    review,
    page: { id: page.id, title: page.title, path: page.path, template: page.template, state: page.workflowState },
    doc,
    diff: diffPages(live, doc),
    checks: checksFor(ctx, page.template, doc),
    draftChangedSinceSubmit: page.draftVersionId !== review.versionId,
    comments,
  }
}

// Submitting, approving and sending back. Approval is pinned to one version.
// See ADR 0005 and docs/13-data-model.md#reviews-pin-a-version.
import { and, desc, eq, inArray } from 'drizzle-orm'
import { runChecks } from '../../shared/checks'
import { diffPages, type PageDiff } from '../../shared/diff'
import { newId } from '../../shared/ids'
import { validatePageDoc, type PageDoc } from '../../shared/page'
import { atLeast, can } from '../../shared/roles'
import { readSettings } from '../../shared/settings'
import { canSubmit, restingState, type WorkflowState } from '../../shared/workflow'
import { brandPacks, pages, reviewComments, reviews, siteParts, sites, templates, users } from '../db/schema'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { enqueueJob } from './jobs'
import { notify, usersWithRoles } from './notify'
import { readDoc, requirePage, sealDraft } from './pages'
import { getOrCreateBrand, readBrandDoc } from './brand'
import { readSitePartDoc, requireSitePart, sitePartChecks } from './site-parts'
import { brandContrastChecks } from '../../shared/brand'
import { getTemplateRules, readTemplateDoc, requireTemplate } from './templates'
import { templateChecks } from '../../shared/templates'

export type ReviewRow = typeof reviews.$inferSelect

export function siteSettings(ctx: ServiceCtx) {
  return readSettings(ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.settings)
}

/** What a review is about: a page or a site part. Both have the same draft and published pointers. */
export interface ReviewTarget {
  type: 'page' | 'site_part' | 'brand' | 'template'
  id: string
  title: string
  workflowState: WorkflowState
  publishedVersionId: string | null
  wasUnpublished: boolean
  draftVersionId: string | null
}

export function loadReviewTarget(ctx: ServiceCtx, type: ReviewRow['targetType'], id: string): ReviewTarget {
  if (type === 'page') {
    const p = requirePage(ctx, id)
    return { type, id, title: p.title, workflowState: p.workflowState, publishedVersionId: p.publishedVersionId, wasUnpublished: p.wasUnpublished, draftVersionId: p.draftVersionId }
  }
  if (type === 'site_part') {
    const p = requireSitePart(ctx, id)
    return { type, id, title: p.label, workflowState: p.workflowState, publishedVersionId: p.publishedVersionId, wasUnpublished: p.wasUnpublished, draftVersionId: p.draftVersionId }
  }
  if (type === 'brand') {
    const pack = getOrCreateBrand(ctx)
    if (pack.id !== id) throw notFound('That brand pack')
    return { type, id, title: 'Brand and Design', workflowState: pack.workflowState, publishedVersionId: pack.publishedVersionId, wasUnpublished: pack.wasUnpublished, draftVersionId: pack.draftVersionId }
  }
  if (type === 'template') {
    const pack = requireTemplate(ctx, id)
    return { type, id, title: pack.label, workflowState: pack.workflowState, publishedVersionId: pack.publishedVersionId, wasUnpublished: pack.wasUnpublished, draftVersionId: pack.draftVersionId }
  }
  throw new AppError('invalid_state', 'Reviews for this kind of change are not built yet.')
}

export function setTargetState(ctx: ServiceCtx, t: Pick<ReviewTarget, 'type' | 'id'>, workflowState: WorkflowState) {
  const table = t.type === 'page' ? pages : t.type === 'brand' ? brandPacks : t.type === 'template' ? templates : siteParts
  ctx.db.update(table).set({ workflowState, updatedAt: iso(ctx) }).where(eq(table.id, t.id)).run()
}

function targetChecks(ctx: ServiceCtx, t: ReviewTarget, versionId: string) {
  if (t.type === 'page') {
    const page = requirePage(ctx, t.id)
    return checksFor(ctx, page.template, readDoc(ctx, versionId))
  }
  if (t.type === 'site_part') {
    const part = requireSitePart(ctx, t.id)
    return sitePartChecks(ctx, part.kind, readSitePartDoc(ctx, part, versionId))
  }
  if (t.type === 'brand') {
    const pack = getOrCreateBrand(ctx)
    return brandContrastChecks(readBrandDoc(ctx, pack, versionId))
  }
  const pack = requireTemplate(ctx, t.id)
  return templateChecks(readTemplateDoc(ctx, pack, versionId))
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
    const changes = summariseDiff(diffPages(live, doc), (t) => ctx.registry.get(t)?.label.toLowerCase() ?? t)
    const summary = live ? changes : `New page. ${changes}`
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
    if (review.state !== 'pending') throw new AppError('invalid_state', review.state === 'withdrawn' ? 'This changed after it was submitted. It needs submitting again.' : 'This review has already been decided.')
    if (input.versionId !== review.versionId) throw new AppError('invalid_state', "This isn't the version that was submitted. Reload the review.")
    const target = loadReviewTarget(ctx, review.targetType, review.targetId)

    const selfApproved = review.submittedBy === actor.id
    if (selfApproved && !siteSettings(ctx).workflow.selfApproval) {
      throw forbidden("You can't approve your own changes. Ask another approver, or an admin can turn on self-approval in Settings > Workflow.")
    }

    const checks = targetChecks(ctx, target, review.versionId)
    if (checks.blocking.length && !input.overrideReason) {
      throw new AppError('validation_failed', 'There are problems to fix, or approve with a reason.', checks.blocking)
    }

    const jobId = enqueueJob(ctx, 'publish', { reviewId }, { createdBy: actor.id })
    ctx.db
      .update(reviews)
      .set({ state: 'approved', decidedBy: actor.id, decidedAt: iso(ctx), selfApproved, overrideReason: input.overrideReason ?? review.overrideReason, jobId })
      .where(eq(reviews.id, reviewId))
      .run()
    setTargetState(ctx, target, 'approved')
    audit(ctx, actor, 'review.approved', { type: target.type, id: target.id }, { reviewId, versionId: review.versionId, selfApproved, overrideReason: input.overrideReason ?? null })
    return { jobId, selfApproved }
  })
}

export function sendBackReview(ctx: ServiceCtx, actor: ActingAs, reviewId: string, comment: string) {
  if (!can(actor, 'review.decide')) throw forbidden()
  if (!comment.trim()) throw new AppError('validation_failed', 'Add a comment so they know what to change.', [{ path: 'comment', message: 'Needed.' }])
  return inTx(ctx, () => {
    const review = requireReview(ctx, reviewId)
    if (review.state !== 'pending') throw new AppError('invalid_state', 'This review has already been decided.')
    const target = loadReviewTarget(ctx, review.targetType, review.targetId)
    ctx.db.update(reviews).set({ state: 'sent_back', decidedBy: actor.id, decidedAt: iso(ctx), decisionComment: comment }).where(eq(reviews.id, reviewId)).run()
    setTargetState(ctx, target, restingState({ publishedVersionId: target.publishedVersionId, wasUnpublished: target.wasUnpublished }))
    audit(ctx, actor, 'review.sent_back', { type: target.type, id: target.id }, { reviewId, comment })
    notify(ctx, [review.submittedBy], 'sent_back', `"${target.title}" was sent back: ${comment}`, { type: target.type, id: target.id })
  })
}

export function addReviewComment(ctx: ServiceCtx, actor: ActingAs, reviewId: string, body: string, blockId?: string) {
  const review = requireReview(ctx, reviewId)
  if (review.submittedBy !== actor.id && !can(actor, 'review.read')) throw forbidden()
  const id = newId('comment', ctx.now().getTime())
  ctx.db.insert(reviewComments).values({ id, siteId: ctx.siteId, reviewId, blockId: blockId ?? null, authorId: actor.id, body, createdAt: iso(ctx) }).run()
  return { id }
}

/** Approvers see every review; editors only see what they submitted ("My submissions"). */

function namesById(ctx: ServiceCtx, ids: string[]): Map<string, string> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  return new Map(ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique)).all().map((u) => [u.id, u.name]))
}

function targetTitle(ctx: ServiceCtx, type: ReviewRow['targetType'], id: string): string {
  try {
    return loadReviewTarget(ctx, type, id).title
  } catch {
    return 'Unknown'
  }
}

export function listReviews(ctx: ServiceCtx, actor: ActingAs, state?: ReviewRow['state']) {
  const own = can(actor, 'review.read') ? undefined : eq(reviews.submittedBy, actor.id)
  const rows = ctx.db
    .select()
    .from(reviews)
    .where(and(eq(reviews.siteId, ctx.siteId), state ? eq(reviews.state, state) : undefined, own))
    .orderBy(desc(reviews.createdAt))
    .limit(100)
    .all()
  const names = namesById(ctx, rows.flatMap((r) => [r.submittedBy, r.decidedBy ?? '']))
  return rows.map((r) => ({
    ...r,
    title: targetTitle(ctx, r.targetType, r.targetId),
    submittedByName: names.get(r.submittedBy) ?? 'Someone',
    decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? 'Someone') : null,
  }))
}

export function getReview(ctx: ServiceCtx, actor: ActingAs, reviewId: string) {
  const review = requireReview(ctx, reviewId)
  if (review.submittedBy !== actor.id && !can(actor, 'review.read')) throw forbidden()
  const comments = ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewId, reviewId)).all()
  const names = namesById(ctx, [review.submittedBy, review.decidedBy ?? '', ...comments.map((c) => c.authorId)])
  const withNames = {
    submittedByName: names.get(review.submittedBy) ?? 'Someone',
    decidedByName: review.decidedBy ? (names.get(review.decidedBy) ?? 'Someone') : null,
    comments: comments.map((c) => ({ ...c, authorName: names.get(c.authorId) ?? 'Someone' })),
  }
  const draftChangedSinceSubmit = (t: { draftVersionId: string | null }) => t.draftVersionId !== review.versionId
  if (review.targetType === 'brand') {
    const pack = getOrCreateBrand(ctx)
    if (pack.id !== review.targetId) throw notFound('That brand pack')
    const doc = readBrandDoc(ctx, pack, review.versionId)
    const liveDoc = pack.publishedVersionId ? readBrandDoc(ctx, pack, pack.publishedVersionId) : null
    return {
      review,
      target: { type: 'brand' as const, id: pack.id, title: 'Brand and Design', state: pack.workflowState },
      doc,
      liveDoc,
      hasLive: !!liveDoc,
      checks: brandContrastChecks(doc),
      draftChangedSinceSubmit: draftChangedSinceSubmit(pack),
      ...withNames,
    }
  }
  if (review.targetType === 'site_part') {
    const part = requireSitePart(ctx, review.targetId)
    const doc = readSitePartDoc(ctx, part, review.versionId)
    const liveDoc = part.publishedVersionId ? readSitePartDoc(ctx, part, part.publishedVersionId) : null
    return {
      review,
      target: { type: 'site_part' as const, id: part.id, title: part.label, kind: part.kind, state: part.workflowState },
      doc,
      liveDoc,
      hasLive: !!liveDoc,
      checks: sitePartChecks(ctx, part.kind, doc),
      draftChangedSinceSubmit: draftChangedSinceSubmit(part),
      ...withNames,
    }
  }
  if (review.targetType === 'template') {
    const pack = requireTemplate(ctx, review.targetId)
    const doc = readTemplateDoc(ctx, pack, review.versionId)
    const liveDoc = pack.publishedVersionId ? readTemplateDoc(ctx, pack, pack.publishedVersionId) : null
    return {
      review,
      target: { type: 'template' as const, id: pack.id, title: pack.label, key: pack.key, state: pack.workflowState },
      doc,
      liveDoc,
      hasLive: !!liveDoc,
      checks: templateChecks(doc),
      draftChangedSinceSubmit: draftChangedSinceSubmit(pack),
      ...withNames,
    }
  }
  const page = requirePage(ctx, review.targetId)
  const doc = readDoc(ctx, review.versionId)
  const live = page.publishedVersionId ? readDoc(ctx, page.publishedVersionId) : null
  return {
    review,
    target: { type: 'page' as const, id: page.id, title: page.title, path: page.path, template: page.template, state: page.workflowState },
    page: { id: page.id, title: page.title, path: page.path, template: page.template, state: page.workflowState },
    doc,
    hasLive: !!live,
    diff: diffPages(live, doc),
    checks: checksFor(ctx, page.template, doc),
    draftChangedSinceSubmit: draftChangedSinceSubmit(page),
    ...withNames,
  }
}

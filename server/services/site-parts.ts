// Site parts (header, footer, menus, banner): drafts edited by hand, versions, submit for approval.
// Approval and publishing go through the same reviews and publish job as pages.
// See docs/04-gui.md#site-parts-menus and docs/14-api.md#site-parts-templates-brand.
import { and, desc, eq, gt, inArray, ne } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import type { FieldIssue } from '../../shared/issues'
import { can } from '../../shared/roles'
import { defaultSitePartDoc, migrateSitePartDoc, sitePartLinks, validateSitePartDoc, type SitePartDoc, type SitePartKind } from '../../shared/site-parts'
import { canSubmit, restingState, type WorkflowState } from '../../shared/workflow'
import { draftOps, pages, reviews, siteParts, versions } from '../db/schema'
import { audit } from './audit'
import { actorKey, inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { notify, usersWithRoles } from './notify'
import { getVersionRow, insertVersion, saveDraftSnapshot } from './versions'

export type SitePartRow = typeof siteParts.$inferSelect

const SYSTEM: ActingAs = { id: 'system', role: 'admin', isOperator: false }

export function requireSitePart(ctx: ServiceCtx, id: string): SitePartRow {
  const part = ctx.db.select().from(siteParts).where(and(eq(siteParts.id, id), eq(siteParts.siteId, ctx.siteId))).get()
  if (!part) throw notFound('That site part')
  return part
}

export function listSiteParts(ctx: ServiceCtx) {
  return ctx.db
    .select({ id: siteParts.id, kind: siteParts.kind, key: siteParts.key, label: siteParts.label, state: siteParts.workflowState, publishedVersionId: siteParts.publishedVersionId, draftVersionId: siteParts.draftVersionId, updatedAt: siteParts.updatedAt })
    .from(siteParts)
    .where(eq(siteParts.siteId, ctx.siteId))
    .all()
    .map(({ publishedVersionId, draftVersionId, ...p }) => ({ ...p, isLive: !!publishedVersionId, hasUnpublishedChanges: !!publishedVersionId && publishedVersionId !== draftVersionId }))
}

/** Create a site part with an empty starting document (setup and seeds). */
export function createSitePart(ctx: ServiceCtx, kind: SitePartKind, key: string, label: string, actor: ActingAs = SYSTEM): string {
  return inTx(ctx, () => {
    const id = newId('sitePart', ctx.now().getTime())
    ctx.db.insert(siteParts).values({ id, siteId: ctx.siteId, kind, key, label, createdAt: iso(ctx), updatedAt: iso(ctx) }).run()
    const versionId = insertVersion(ctx, 'site_part', id, defaultSitePartDoc(kind), actor, 'created', true)
    ctx.db.update(siteParts).set({ draftVersionId: versionId }).where(eq(siteParts.id, id)).run()
    return id
  })
}

export function readSitePartDoc(ctx: ServiceCtx, part: SitePartRow, versionId: string | null = part.draftVersionId): SitePartDoc {
  const raw = versionId ? getVersionRow(ctx, versionId).doc : null
  const valid = validateSitePartDoc(part.kind, migrateSitePartDoc(part.kind, raw))
  return valid.ok ? valid.doc : defaultSitePartDoc(part.kind)
}

/** Links must point at pages that exist. Links to pages that are not live yet are a warning. */
export function sitePartChecks(ctx: ServiceCtx, kind: SitePartKind, doc: SitePartDoc): { blocking: FieldIssue[]; warnings: FieldIssue[] } {
  const links = sitePartLinks(kind, doc)
  const ids = [...new Set(links.flatMap((l) => (l.target.type === 'page' ? [l.target.pageId] : [])))]
  const found = ids.length
    ? new Map(ctx.db.select({ id: pages.id, live: pages.publishedVersionId, deletedAt: pages.deletedAt }).from(pages).where(and(eq(pages.siteId, ctx.siteId), inArray(pages.id, ids))).all().map((p) => [p.id, p]))
    : new Map()
  const blocking: FieldIssue[] = []
  const warnings: FieldIssue[] = []
  for (const l of links) {
    if (l.target.type !== 'page') continue
    const p = found.get(l.target.pageId)
    if (!p || p.deletedAt) blocking.push({ path: l.path, message: `"${l.label}" links to a page that no longer exists.` })
    else if (!p.live) warnings.push({ path: l.path, message: `"${l.label}" links to a page that isn't live yet.` })
  }
  if (kind === 'menu' && (doc as { items: unknown[] }).items.length === 0) warnings.push({ path: 'items', message: 'This menu is empty.' })
  return { blocking, warnings }
}

export function getSitePart(ctx: ServiceCtx, id: string) {
  const part = requireSitePart(ctx, id)
  const doc = readSitePartDoc(ctx, part)
  const review = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'site_part'), eq(reviews.targetId, id), eq(reviews.state, 'pending'))).get()
  return { part, doc, revision: part.draftRevision, review: review ?? null, checks: sitePartChecks(ctx, part.kind, doc) }
}

function withdrawPending(ctx: ServiceCtx, part: SitePartRow, actor: ActingAs): WorkflowState {
  const pending = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'site_part'), eq(reviews.targetId, part.id), eq(reviews.state, 'pending'))).get()
  if (!pending) return part.workflowState
  ctx.db.update(reviews).set({ state: 'withdrawn', decidedAt: iso(ctx) }).where(eq(reviews.id, pending.id)).run()
  audit(ctx, actor, 'review.withdrawn', { type: 'review', id: pending.id }, { reason: 'draft_changed' })
  return restingState({ publishedVersionId: part.publishedVersionId, wasUnpublished: part.wasUnpublished })
}

/**
 * Replace a site part's draft document. Site parts are small, so an edit sends the whole document.
 * Conflict if someone else saved since baseRevision.
 */
export function editSitePart(ctx: ServiceCtx, actor: ActingAs, id: string, baseRevision: number, doc: unknown) {
  if (actor.aiSessionId || !can(actor, 'sitePart.edit')) throw forbidden('Only approvers and admins can change the header, footer and menus.')
  return inTx(ctx, () => {
    const part = requireSitePart(ctx, id)
    if (part.workflowState === 'approved') throw new AppError('invalid_state', 'This is being published. Try again in a moment.')
    const current = readSitePartDoc(ctx, part)
    const key = actorKey(actor)
    if (baseRevision > part.draftRevision) throw new AppError('conflict', 'Your copy is newer than the server. Reload.', undefined, { current: { revision: part.draftRevision, doc: current } })
    if (baseRevision < part.draftRevision) {
      const others = ctx.db
        .select({ id: draftOps.id })
        .from(draftOps)
        .where(and(eq(draftOps.targetType, 'site_part'), eq(draftOps.targetId, id), gt(draftOps.revision, baseRevision), ne(draftOps.actorKey, key)))
        .get()
      if (others) throw new AppError('conflict', 'Someone else changed this since you last saw it.', undefined, { current: { revision: part.draftRevision, doc: current } })
    }
    const valid = validateSitePartDoc(part.kind, doc)
    if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]!.message, valid.issues)
    const checks = sitePartChecks(ctx, part.kind, valid.doc)
    if (checks.blocking.length) throw new AppError('validation_failed', checks.blocking[0]!.message, checks.blocking)

    const headId = saveDraftSnapshot(ctx, 'site_part', id, part.draftVersionId, valid.doc, actor)
    const revision = part.draftRevision + 1
    ctx.db
      .insert(draftOps)
      .values({ id: newId('op', ctx.now().getTime()), siteId: ctx.siteId, targetType: 'site_part', targetId: id, revision, actorKey: key, userId: actor.id, aiSessionId: null, op: { op: 'replace', doc: valid.doc }, inverse: { op: 'replace', doc: current }, touches: ['part'], undoOf: null, createdAt: iso(ctx) })
      .run()
    const state = part.workflowState === 'in_review' ? withdrawPending(ctx, part, actor) : part.workflowState
    ctx.db.update(siteParts).set({ draftVersionId: headId, draftRevision: revision, workflowState: state, updatedAt: iso(ctx) }).where(eq(siteParts.id, id)).run()
    audit(ctx, actor, 'site_part.edited', { type: 'site_part', id }, { revision })
    return { revision, doc: valid.doc, warnings: checks.warnings, reviewWithdrawn: state !== part.workflowState }
  })
}

export function listSitePartVersions(ctx: ServiceCtx, id: string) {
  requireSitePart(ctx, id)
  return ctx.db
    .select({ id: versions.id, number: versions.number, kind: versions.kind, summary: versions.summary, authorId: versions.authorId, sealed: versions.sealed, createdAt: versions.createdAt, updatedAt: versions.updatedAt })
    .from(versions)
    .where(and(eq(versions.targetType, 'site_part'), eq(versions.targetId, id)))
    .orderBy(desc(versions.number))
    .all()
}

/** Submit for approval. Another approver approves, unless self-approval is on (ADR 0005). */
export function submitSitePart(ctx: ServiceCtx, actor: ActingAs, id: string, input: { note?: string } = {}) {
  if (actor.aiSessionId || !can(actor, 'sitePart.edit')) throw forbidden()
  return inTx(ctx, () => {
    const part = requireSitePart(ctx, id)
    if (!canSubmit(part.workflowState)) throw new AppError('invalid_state', part.workflowState === 'in_review' ? 'This is already waiting for approval.' : 'This is being published.')
    if (part.draftVersionId === part.publishedVersionId) throw new AppError('invalid_state', 'There are no changes to submit.')
    const doc = readSitePartDoc(ctx, part)
    const checks = sitePartChecks(ctx, part.kind, doc)
    if (checks.blocking.length) throw new AppError('validation_failed', 'Fix these before submitting.', checks.blocking, { warnings: checks.warnings })
    const head = getVersionRow(ctx, part.draftVersionId!)
    const summary = part.publishedVersionId ? `Changed the ${part.label.toLowerCase()}` : `New ${part.label.toLowerCase()}`
    let versionId = head.id
    if (!head.sealed) ctx.db.update(versions).set({ sealed: true, kind: 'submitted', summary, updatedAt: iso(ctx) }).where(eq(versions.id, head.id)).run()
    else {
      versionId = insertVersion(ctx, 'site_part', id, doc, actor, 'submitted', true, summary)
      ctx.db.update(siteParts).set({ draftVersionId: versionId }).where(eq(siteParts.id, id)).run()
    }
    const reviewId = newId('review', ctx.now().getTime())
    ctx.db
      .insert(reviews)
      .values({ id: reviewId, siteId: ctx.siteId, targetType: 'site_part', targetId: id, versionId, state: 'pending', note: input.note ?? null, changeSummary: summary, submittedBy: actor.id, createdAt: iso(ctx) })
      .run()
    ctx.db.update(siteParts).set({ workflowState: 'in_review', updatedAt: iso(ctx) }).where(eq(siteParts.id, id)).run()
    audit(ctx, actor, 'review.submitted', { type: 'site_part', id }, { reviewId, versionId })
    notify(ctx, usersWithRoles(ctx, ['approver', 'admin']).filter((u) => u !== actor.id), 'review_requested', `The ${part.label.toLowerCase()} is waiting for approval.`, { type: 'review', id: reviewId })
    return { reviewId, versionId, summary, warnings: checks.warnings }
  })
}

/** Labels of site parts (draft or live) that link to a page. Used to stop binning a page a menu still needs. */
export function sitePartsLinkingTo(ctx: ServiceCtx, pageId: string): string[] {
  const out: string[] = []
  for (const part of ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all()) {
    for (const versionId of new Set([part.draftVersionId, part.publishedVersionId])) {
      if (!versionId) continue
      if (sitePartLinks(part.kind, readSitePartDoc(ctx, part, versionId)).some((l) => l.target.type === 'page' && l.target.pageId === pageId)) {
        out.push(part.label)
        break
      }
    }
  }
  return out
}

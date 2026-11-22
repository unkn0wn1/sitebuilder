// Brand pack: one per site, draft and published versions, submitted like pages. Admins only.
import { and, desc, eq, gt, ne } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { can } from '../../shared/roles'
import { brandContrastChecks, defaultBrandDoc, migrateBrandDoc, validateBrandDoc, type BrandDoc } from '../../shared/brand'
import { canSubmit, restingState } from '../../shared/workflow'
import { brandPacks, draftOps, reviews, versions } from '../db/schema'
import { audit } from './audit'
import { sameDraft } from '../../shared/clone'
import { actorKey, inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { notify, usersWithRoles } from './notify'
import { getVersionRow, insertVersion, saveDraftSnapshot } from './versions'

export type BrandRow = typeof brandPacks.$inferSelect

function requireActorCanEdit(actor: ActingAs) {
  if (actor.aiSessionId || !can(actor, 'brand.edit')) throw forbidden('Only admins can change the brand and design.')
}

export function readBrandDoc(ctx: ServiceCtx, pack: BrandRow, versionId: string | null = pack.draftVersionId): BrandDoc {
  const raw = versionId ? getVersionRow(ctx, versionId).doc : null
  const valid = validateBrandDoc(migrateBrandDoc(kindless(raw)))
  return valid.ok ? valid.doc : defaultBrandDoc()
}

function kindless(raw: unknown): unknown {
  return raw
}

/** Get the site's brand pack, creating a default draft if this site has none yet. */
export function getOrCreateBrand(ctx: ServiceCtx): BrandRow {
  const existing = ctx.db.select().from(brandPacks).where(eq(brandPacks.siteId, ctx.siteId)).get()
  if (existing) return existing
  return inTx(ctx, () => {
    const again = ctx.db.select().from(brandPacks).where(eq(brandPacks.siteId, ctx.siteId)).get()
    if (again) return again
    const id = newId('brand', ctx.now().getTime())
    const now = iso(ctx)
    ctx.db.insert(brandPacks).values({ id, siteId: ctx.siteId, createdAt: now, updatedAt: now }).run()
    const versionId = insertVersion(ctx, 'brand', id, defaultBrandDoc(), { id: 'system', role: 'admin', isOperator: false }, 'created', true, 'Starting brand pack')
    ctx.db.update(brandPacks).set({ draftVersionId: versionId }).where(eq(brandPacks.id, id)).run()
    return ctx.db.select().from(brandPacks).where(eq(brandPacks.id, id)).get()!
  })
}

export function getBrand(ctx: ServiceCtx) {
  const pack = getOrCreateBrand(ctx)
  const doc = readBrandDoc(ctx, pack)
  const review = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'brand'), eq(reviews.targetId, pack.id), eq(reviews.state, 'pending'))).get()
  return { pack, doc, revision: pack.draftRevision, review: review ?? null, checks: brandContrastChecks(doc) }
}

export function listBrandVersions(ctx: ServiceCtx) {
  const pack = getOrCreateBrand(ctx)
  return ctx.db
    .select({ id: versions.id, number: versions.number, kind: versions.kind, summary: versions.summary, authorId: versions.authorId, sealed: versions.sealed, createdAt: versions.createdAt, updatedAt: versions.updatedAt })
    .from(versions)
    .where(and(eq(versions.targetType, 'brand'), eq(versions.targetId, pack.id)))
    .orderBy(desc(versions.number))
    .all()
}

function withdrawPending(ctx: ServiceCtx, pack: BrandRow, actor: ActingAs) {
  const pending = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'brand'), eq(reviews.targetId, pack.id), eq(reviews.state, 'pending'))).get()
  if (!pending) return pack.workflowState
  ctx.db.update(reviews).set({ state: 'withdrawn', decidedAt: iso(ctx) }).where(eq(reviews.id, pending.id)).run()
  audit(ctx, actor, 'review.withdrawn', { type: 'brand', id: pending.id }, { reason: 'draft_changed' })
  return restingState({ publishedVersionId: pack.publishedVersionId, wasUnpublished: pack.wasUnpublished })
}

export function editBrand(ctx: ServiceCtx, actor: ActingAs, baseRevision: number, doc: unknown) {
  requireActorCanEdit(actor)
  return inTx(ctx, () => {
    const pack = getOrCreateBrand(ctx)
    if (pack.workflowState === 'approved') throw new AppError('invalid_state', 'This is being published. Try again in a moment.')
    const current = readBrandDoc(ctx, pack)
    const key = actorKey(actor)
    if (baseRevision > pack.draftRevision) throw new AppError('conflict', 'Your copy is newer than the server. Reload.', undefined, { current: { revision: pack.draftRevision, doc: current } })
    if (baseRevision < pack.draftRevision) {
      const others = ctx.db
        .select({ id: draftOps.id })
        .from(draftOps)
        .where(and(eq(draftOps.targetType, 'brand'), eq(draftOps.targetId, pack.id), gt(draftOps.revision, baseRevision), ne(draftOps.actorKey, key)))
        .get()
      if (others) throw new AppError('conflict', 'Someone else changed this since you last saw it.', undefined, { current: { revision: pack.draftRevision, doc: current } })
    }
    const valid = validateBrandDoc(doc)
    if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]!.message, valid.issues)
    const checks = brandContrastChecks(valid.doc)
    if (sameDraft(valid.doc, current)) {
      return { revision: pack.draftRevision, doc: current, warnings: checks.warnings, reviewWithdrawn: false }
    }
    const headId = saveDraftSnapshot(ctx, 'brand', pack.id, pack.draftVersionId, valid.doc, actor)
    const revision = pack.draftRevision + 1
    ctx.db
      .insert(draftOps)
      .values({ id: newId('op', ctx.now().getTime()), siteId: ctx.siteId, targetType: 'brand', targetId: pack.id, revision, actorKey: key, userId: actor.id, aiSessionId: null, op: { op: 'replace', doc: valid.doc }, inverse: { op: 'replace', doc: current }, touches: ['brand'], undoOf: null, createdAt: iso(ctx) })
      .run()
    const state = pack.workflowState === 'in_review' ? withdrawPending(ctx, pack, actor) : pack.workflowState
    ctx.db.update(brandPacks).set({ draftVersionId: headId, draftRevision: revision, workflowState: state, updatedAt: iso(ctx) }).where(eq(brandPacks.id, pack.id)).run()
    const details: Record<string, unknown> = { revision }
    if ((valid.doc.customCss ?? '') !== (current.customCss ?? '')) details.customCss = true
    audit(ctx, actor, 'brand.edited', { type: 'brand', id: pack.id }, details)
    return { revision, doc: valid.doc, warnings: checks.warnings, reviewWithdrawn: state !== pack.workflowState }
  })
}

export function submitBrand(ctx: ServiceCtx, actor: ActingAs, input: { note?: string } = {}) {
  requireActorCanEdit(actor)
  return inTx(ctx, () => {
    const pack = getOrCreateBrand(ctx)
    if (!canSubmit(pack.workflowState)) throw new AppError('invalid_state', pack.workflowState === 'in_review' ? 'This is already waiting for approval.' : 'This is being published.')
    if (pack.draftVersionId === pack.publishedVersionId) throw new AppError('invalid_state', 'There are no changes to submit.')
    const doc = readBrandDoc(ctx, pack)
    const checks = brandContrastChecks(doc)
    const head = getVersionRow(ctx, pack.draftVersionId!)
    const summary = pack.publishedVersionId ? 'Changed the brand and design' : 'New brand and design'
    let versionId = head.id
    if (!head.sealed) ctx.db.update(versions).set({ sealed: true, kind: 'submitted', summary, updatedAt: iso(ctx) }).where(eq(versions.id, head.id)).run()
    else {
      versionId = insertVersion(ctx, 'brand', pack.id, doc, actor, 'submitted', true, summary)
      ctx.db.update(brandPacks).set({ draftVersionId: versionId }).where(eq(brandPacks.id, pack.id)).run()
    }
    const reviewId = newId('review', ctx.now().getTime())
    ctx.db
      .insert(reviews)
      .values({ id: reviewId, siteId: ctx.siteId, targetType: 'brand', targetId: pack.id, versionId, state: 'pending', note: input.note ?? null, changeSummary: summary, submittedBy: actor.id, createdAt: iso(ctx) })
      .run()
    ctx.db.update(brandPacks).set({ workflowState: 'in_review', updatedAt: iso(ctx) }).where(eq(brandPacks.id, pack.id)).run()
    audit(ctx, actor, 'review.submitted', { type: 'brand', id: pack.id }, { reviewId, versionId })
    notify(ctx, usersWithRoles(ctx, ['admin']).filter((u) => u !== actor.id), 'review_requested', 'The brand and design is waiting for approval.', { type: 'review', id: reviewId })
    return { reviewId, versionId, summary, warnings: checks.warnings }
  })
}

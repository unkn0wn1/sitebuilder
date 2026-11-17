// Templates (page types). Rules live in the template's version document. See docs/03-block-model.md#templates-page-types.
import { and, desc, eq, gt, ne } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { templateRulesSchema, withLibraryBlockUpdates, type TemplateRules } from '../../shared/templates'
import { can } from '../../shared/roles'
import { canSubmit, restingState } from '../../shared/workflow'
import { draftOps, reviews, templates, versions } from '../db/schema'
import { audit } from './audit'
import { actorKey, inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { notify, usersWithRoles } from './notify'
import { getVersionRow, insertVersion, saveDraftSnapshot } from './versions'

export function getTemplateRules(ctx: ServiceCtx, key: string): TemplateRules | null {
  const row = ctx.db.select().from(templates).where(and(eq(templates.siteId, ctx.siteId), eq(templates.key, key))).get()
  // Only the published rules apply to pages. Draft changes wait for approval.
  const versionId = row?.publishedVersionId
  if (!versionId) return null
  const version = ctx.db.select().from(versions).where(eq(versions.id, versionId)).get()
  return version ? withLibraryBlockUpdates(templateRulesSchema.parse(version.doc)) : null
}

export function listTemplates(ctx: ServiceCtx) {
  return ctx.db
    .select({
      id: templates.id,
      key: templates.key,
      label: templates.label,
      state: templates.workflowState,
      draftVersionId: templates.draftVersionId,
      publishedVersionId: templates.publishedVersionId,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .where(eq(templates.siteId, ctx.siteId))
    .all()
    .map((row) => ({
      ...row,
      live: !!row.publishedVersionId,
      hasUnpublishedChanges: !!row.draftVersionId && row.draftVersionId !== row.publishedVersionId,
    }))
}

/** Create a template that is live straight away (setup and seeds). Later edits go through drafts and approval. */
export function createTemplate(ctx: ServiceCtx, key: string, rules: TemplateRules, authorId: string): string {
  const parsed = templateRulesSchema.parse(rules)
  for (const type of [...parsed.allowedBlocks, ...parsed.requiredBlocks]) {
    if (!ctx.registry.has(type)) throw new Error(`Template ${key} uses unknown block ${type}`)
  }
  const id = newId('template', ctx.now().getTime())
  const versionId = newId('version', ctx.now().getTime())
  const now = iso(ctx)
  ctx.db
    .insert(templates)
    .values({ id, siteId: ctx.siteId, key, label: parsed.label, draftVersionId: versionId, publishedVersionId: versionId, workflowState: 'published', createdAt: now, updatedAt: now })
    .run()
  ctx.db
    .insert(versions)
    .values({ id: versionId, siteId: ctx.siteId, targetType: 'template', targetId: id, number: 1, doc: parsed, schemaVersion: parsed.schemaVersion, kind: 'created', actorKey: `user:${authorId}`, authorId, sealed: true, createdAt: now, updatedAt: now })
    .run()
  return id
}

export type TemplateRow = typeof templates.$inferSelect

export function requireTemplate(ctx: ServiceCtx, id: string): TemplateRow {
  const row = ctx.db.select().from(templates).where(and(eq(templates.id, id), eq(templates.siteId, ctx.siteId))).get()
  if (!row) throw notFound('That page type')
  return row
}

export function readTemplateDoc(ctx: ServiceCtx, row: TemplateRow, versionId: string | null = row.draftVersionId): TemplateRules {
  const raw = versionId ? getVersionRow(ctx, versionId).doc : null
  return templateRulesSchema.parse(raw ?? { label: row.label, allowedBlocks: ['RichText'] })
}

export function getTemplate(ctx: ServiceCtx, id: string) {
  const pack = requireTemplate(ctx, id)
  const doc = readTemplateDoc(ctx, pack)
  const review = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'template'), eq(reviews.targetId, id), eq(reviews.state, 'pending'))).get()
  return { template: pack, doc, revision: pack.draftRevision, review: review ?? null }
}

export function listTemplateVersions(ctx: ServiceCtx, id: string) {
  requireTemplate(ctx, id)
  return ctx.db
    .select({ id: versions.id, number: versions.number, kind: versions.kind, summary: versions.summary, authorId: versions.authorId, sealed: versions.sealed, createdAt: versions.createdAt, updatedAt: versions.updatedAt })
    .from(versions)
    .where(and(eq(versions.targetType, 'template'), eq(versions.targetId, id)))
    .orderBy(desc(versions.number))
    .all()
}

function withdrawPending(ctx: ServiceCtx, pack: TemplateRow, actor: ActingAs) {
  const pending = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'template'), eq(reviews.targetId, pack.id), eq(reviews.state, 'pending'))).get()
  if (!pending) return pack.workflowState
  ctx.db.update(reviews).set({ state: 'withdrawn', decidedAt: iso(ctx) }).where(eq(reviews.id, pending.id)).run()
  audit(ctx, actor, 'review.withdrawn', { type: 'template', id: pending.id }, { reason: 'draft_changed' })
  return restingState({ publishedVersionId: pack.publishedVersionId, wasUnpublished: pack.wasUnpublished })
}

function assertKnownBlocks(ctx: ServiceCtx, doc: TemplateRules) {
  for (const type of [...doc.allowedBlocks, ...doc.requiredBlocks, ...doc.startingBlocks.map((b) => b.type)]) {
    if (!ctx.registry.has(type)) throw new AppError('validation_failed', `A "${type}" section is not in the library.`, [{ path: 'allowedBlocks', message: `Unknown section: ${type}` }])
  }
  for (const required of doc.requiredBlocks) {
    const accepted = required === 'Hero' ? ['Hero', 'VideoHero'] : [required]
    if (!accepted.some((type) => doc.allowedBlocks.includes(type))) {
      throw new AppError('validation_failed', `A required "${required}" section must also be allowed.`, [{ path: 'requiredBlocks', message: `"${required}" is required but not allowed.` }])
    }
  }
}

export function createTemplateDraft(ctx: ServiceCtx, actor: ActingAs, input: { key: string; rules: TemplateRules }) {
  if (actor.aiSessionId || !can(actor, 'template.edit')) throw forbidden('Only admins can change page types.')
  const key = input.key.trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(key)) throw new AppError('validation_failed', 'Use a short key like "campaign", starting with a letter.', [{ path: 'key', message: 'Use letters, numbers and hyphens.' }])
  const parsed = templateRulesSchema.parse(input.rules)
  assertKnownBlocks(ctx, parsed)
  return inTx(ctx, () => {
    if (ctx.db.select({ id: templates.id }).from(templates).where(and(eq(templates.siteId, ctx.siteId), eq(templates.key, key))).get()) {
      throw new AppError('validation_failed', 'A page type with that key already exists.', [{ path: 'key', message: 'Already used.' }])
    }
    const id = newId('template', ctx.now().getTime())
    const now = iso(ctx)
    ctx.db.insert(templates).values({ id, siteId: ctx.siteId, key, label: parsed.label, createdAt: now, updatedAt: now }).run()
    const versionId = insertVersion(ctx, 'template', id, parsed, actor, 'created', true, `New page type: ${parsed.label}`)
    ctx.db.update(templates).set({ draftVersionId: versionId }).where(eq(templates.id, id)).run()
    audit(ctx, actor, 'template.created', { type: 'template', id }, { key })
    return { id, key, label: parsed.label }
  })
}

export function editTemplate(ctx: ServiceCtx, actor: ActingAs, id: string, baseRevision: number, doc: unknown) {
  if (actor.aiSessionId || !can(actor, 'template.edit')) throw forbidden('Only admins can change page types.')
  return inTx(ctx, () => {
    const pack = requireTemplate(ctx, id)
    if (pack.workflowState === 'approved') throw new AppError('invalid_state', 'This is being published. Try again in a moment.')
    const current = readTemplateDoc(ctx, pack)
    const key = actorKey(actor)
    if (baseRevision > pack.draftRevision) throw new AppError('conflict', 'Your copy is newer than the server. Reload.', undefined, { current: { revision: pack.draftRevision, doc: current } })
    if (baseRevision < pack.draftRevision) {
      const others = ctx.db
        .select({ id: draftOps.id })
        .from(draftOps)
        .where(and(eq(draftOps.targetType, 'template'), eq(draftOps.targetId, id), gt(draftOps.revision, baseRevision), ne(draftOps.actorKey, key)))
        .get()
      if (others) throw new AppError('conflict', 'Someone else changed this since you last saw it.', undefined, { current: { revision: pack.draftRevision, doc: current } })
    }
    const parsed = templateRulesSchema.safeParse(doc)
    if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]!.message)
    assertKnownBlocks(ctx, parsed.data)
    const headId = saveDraftSnapshot(ctx, 'template', id, pack.draftVersionId, parsed.data, actor)
    const revision = pack.draftRevision + 1
    ctx.db
      .insert(draftOps)
      .values({ id: newId('op', ctx.now().getTime()), siteId: ctx.siteId, targetType: 'template', targetId: id, revision, actorKey: key, userId: actor.id, aiSessionId: null, op: { op: 'replace', doc: parsed.data }, inverse: { op: 'replace', doc: current }, touches: ['template'], undoOf: null, createdAt: iso(ctx) })
      .run()
    const state = pack.workflowState === 'in_review' ? withdrawPending(ctx, pack, actor) : pack.workflowState
    ctx.db.update(templates).set({ draftVersionId: headId, draftRevision: revision, label: parsed.data.label, workflowState: state, updatedAt: iso(ctx) }).where(eq(templates.id, id)).run()
    audit(ctx, actor, 'template.edited', { type: 'template', id }, { revision })
    return { revision, doc: parsed.data, reviewWithdrawn: state !== pack.workflowState }
  })
}

export function submitTemplate(ctx: ServiceCtx, actor: ActingAs, id: string, input: { note?: string } = {}) {
  if (actor.aiSessionId || !can(actor, 'template.edit')) throw forbidden()
  return inTx(ctx, () => {
    const pack = requireTemplate(ctx, id)
    if (!canSubmit(pack.workflowState)) throw new AppError('invalid_state', pack.workflowState === 'in_review' ? 'This is already waiting for approval.' : 'This is being published.')
    if (pack.draftVersionId === pack.publishedVersionId) throw new AppError('invalid_state', 'There are no changes to submit.')
    const doc = readTemplateDoc(ctx, pack)
    const head = getVersionRow(ctx, pack.draftVersionId!)
    const summary = pack.publishedVersionId ? `Changed the ${doc.label} page type` : `New page type: ${doc.label}`
    let versionId = head.id
    if (!head.sealed) ctx.db.update(versions).set({ sealed: true, kind: 'submitted', summary, updatedAt: iso(ctx) }).where(eq(versions.id, head.id)).run()
    else {
      versionId = insertVersion(ctx, 'template', id, doc, actor, 'submitted', true, summary)
      ctx.db.update(templates).set({ draftVersionId: versionId }).where(eq(templates.id, id)).run()
    }
    const reviewId = newId('review', ctx.now().getTime())
    ctx.db
      .insert(reviews)
      .values({ id: reviewId, siteId: ctx.siteId, targetType: 'template', targetId: id, versionId, state: 'pending', note: input.note ?? null, changeSummary: summary, submittedBy: actor.id, createdAt: iso(ctx) })
      .run()
    ctx.db.update(templates).set({ workflowState: 'in_review', updatedAt: iso(ctx) }).where(eq(templates.id, id)).run()
    audit(ctx, actor, 'review.submitted', { type: 'template', id }, { reviewId, versionId })
    notify(ctx, usersWithRoles(ctx, ['admin']).filter((u) => u !== actor.id), 'review_requested', `The ${doc.label} page type is waiting for approval.`, { type: 'review', id: reviewId })
    return { reviewId, versionId, summary }
  })
}

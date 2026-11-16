// Pages: drafts edited through operations, autosave snapshots, conflicts, undo, history.
// See docs/13-data-model.md (versions, autosave, concurrent edits) and docs/14-api.md#pages.
import { and, asc, desc, eq, gt, isNull, like, ne, or, sql } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { applyOps, OpError, slugSchema, touchesConflict, type InternalOp, type PageMeta } from '../../shared/ops'
import { emptyPageDoc, migratePageDoc, validatePageDoc, type PageDoc } from '../../shared/page'
import { can } from '../../shared/roles'
import { restingState, type WorkflowState } from '../../shared/workflow'
import { draftOps, pages, reviews, versions } from '../db/schema'
import { audit } from './audit'
import { actorKey, inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { getTemplateRules } from './templates'

export type PageRow = typeof pages.$inferSelect
export type VersionRow = typeof versions.$inferSelect

/** Autosave coalescing windows. See docs/13-data-model.md#versions-drafts-and-autosave. */
export const AUTOSAVE_MAX_SPAN_MS = 5 * 60_000
export const AUTOSAVE_MAX_GAP_MS = 2 * 60_000

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'page'
  )
}

export function requirePage(ctx: ServiceCtx, id: string): PageRow {
  const page = ctx.db.select().from(pages).where(and(eq(pages.id, id), eq(pages.siteId, ctx.siteId))).get()
  if (!page || page.deletedAt) throw notFound('That page')
  return page
}

export function getVersionRow(ctx: ServiceCtx, id: string): VersionRow {
  const v = ctx.db.select().from(versions).where(and(eq(versions.id, id), eq(versions.siteId, ctx.siteId))).get()
  if (!v) throw notFound('That version')
  return v
}

export function readDoc(ctx: ServiceCtx, versionId: string): PageDoc {
  return migratePageDoc(getVersionRow(ctx, versionId).doc, ctx.registry)
}

function computePath(ctx: ServiceCtx, slug: string, parentId: string | null, selfId?: string): string {
  if (!parentId) return slug === '' ? '/' : `/${slug}`
  let parent = requirePage(ctx, parentId)
  const seen = new Set<string>()
  for (let p: PageRow | undefined = parent; p; p = p.parentId ? requirePage(ctx, p.parentId) : undefined) {
    if (p.id === selfId) throw new AppError('validation_failed', "A page can't be inside itself.", [{ path: 'parentId', message: "Can't be inside itself." }])
    if (seen.has(p.id)) break
    seen.add(p.id)
  }
  parent = requirePage(ctx, parentId)
  const base = parent.path === '/' ? '' : parent.path
  return `${base}/${slug}`
}

function assertPathFree(ctx: ServiceCtx, path: string, locale: string, selfId?: string) {
  const clash = ctx.db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.siteId, ctx.siteId), eq(pages.locale, locale), eq(pages.path, path), isNull(pages.deletedAt), selfId ? ne(pages.id, selfId) : undefined))
    .get()
  if (clash) throw new AppError('validation_failed', `Another page already uses the address ${path}.`, [{ path: 'slug', message: 'Address already in use.' }])
}

function updateDescendantPaths(ctx: ServiceCtx, parentId: string, parentPath: string) {
  const children = ctx.db.select().from(pages).where(and(eq(pages.siteId, ctx.siteId), eq(pages.parentId, parentId), isNull(pages.deletedAt))).all()
  for (const child of children) {
    const path = `${parentPath === '/' ? '' : parentPath}/${child.slug}`
    assertPathFree(ctx, path, child.locale, child.id)
    ctx.db.update(pages).set({ path }).where(eq(pages.id, child.id)).run()
    updateDescendantPaths(ctx, child.id, path)
  }
}

export function listPages(
  ctx: ServiceCtx,
  q: { search?: string; state?: WorkflowState; template?: string; parentId?: string; page: number; pageSize: number },
) {
  const where = and(
    eq(pages.siteId, ctx.siteId),
    isNull(pages.deletedAt),
    q.search ? or(like(pages.title, `%${q.search}%`), like(pages.path, `%${q.search}%`)) : undefined,
    q.state ? eq(pages.workflowState, q.state) : undefined,
    q.template ? eq(pages.template, q.template) : undefined,
    q.parentId ? eq(pages.parentId, q.parentId) : undefined,
  )
  const total = ctx.db.select({ n: sql<number>`count(*)` }).from(pages).where(where).get()?.n ?? 0
  const items = ctx.db
    .select({
      id: pages.id,
      title: pages.title,
      path: pages.path,
      template: pages.template,
      state: pages.workflowState,
      hasUnpublishedChanges: sql<boolean>`${pages.publishedVersionId} is not null and ${pages.draftVersionId} != ${pages.publishedVersionId}`,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(where)
    .orderBy(desc(pages.updatedAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .all()
  return { items: items.map((i) => ({ ...i, hasUnpublishedChanges: Boolean(i.hasUnpublishedChanges) })), page: q.page, pageSize: q.pageSize, total }
}

export function createPage(
  ctx: ServiceCtx,
  actor: ActingAs,
  input: { title: string; template: string; parentId?: string | null; slug?: string },
): { page: PageRow; doc: PageDoc } {
  if (!can(actor, 'page.edit')) throw forbidden()
  const rules = getTemplateRules(ctx, input.template)
  if (!rules) throw new AppError('validation_failed', `There is no "${input.template}" page type.`, [{ path: 'template', message: 'Unknown page type.' }])
  const slug = input.slug ?? slugify(input.title)
  const slugCheck = slugSchema.safeParse(slug)
  if (!slugCheck.success) throw new AppError('validation_failed', slugCheck.error.issues[0]!.message, [{ path: 'slug', message: slugCheck.error.issues[0]!.message }])

  return inTx(ctx, () => {
    const path = computePath(ctx, slug, input.parentId ?? null)
    assertPathFree(ctx, path, 'en')
    let doc = emptyPageDoc(input.title)
    const { state } = applyOps(
      { doc, meta: { slug, parentId: input.parentId ?? null } },
      rules.startingBlocks.map((b) => ({ op: 'add_block' as const, block: { type: b.type, props: structuredClone(b.props) } })),
      { registry: ctx.registry, newBlockId: () => newId('block') },
    )
    const valid = validatePageDoc(state.doc, ctx.registry, rules)
    if (!valid.ok) throw new AppError('validation_failed', 'The page type has invalid starting sections.', valid.issues)
    doc = valid.doc
    const now = iso(ctx)
    const id = newId('page', ctx.now().getTime())
    const versionId = newId('version', ctx.now().getTime())
    ctx.db
      .insert(versions)
      .values({ id: versionId, siteId: ctx.siteId, targetType: 'page', targetId: id, number: 1, doc, schemaVersion: doc.schemaVersion, kind: 'created', actorKey: actorKey(actor), authorId: actor.id, aiSessionId: actor.aiSessionId ?? null, sealed: true, createdAt: now, updatedAt: now })
      .run()
    ctx.db
      .insert(pages)
      .values({ id, siteId: ctx.siteId, parentId: input.parentId ?? null, slug, path, template: input.template, title: doc.title, draftVersionId: versionId, createdBy: actor.id, createdAt: now, updatedAt: now })
      .run()
    audit(ctx, actor, 'page.created', { type: 'page', id }, { title: doc.title, template: input.template })
    return { page: requirePage(ctx, id), doc }
  })
}

export function getPage(ctx: ServiceCtx, id: string) {
  const page = requirePage(ctx, id)
  const doc = readDoc(ctx, page.draftVersionId!)
  const review = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'page'), eq(reviews.targetId, id), eq(reviews.state, 'pending'))).get()
  return { page, doc, revision: page.draftRevision, review: review ?? null }
}

/** Save the draft document as a snapshot, coalescing autosaves. Returns the head version id. */
function saveSnapshot(ctx: ServiceCtx, page: PageRow, doc: PageDoc, actor: ActingAs): string {
  const key = actorKey(actor)
  const now = ctx.now()
  const head = page.draftVersionId ? getVersionRow(ctx, page.draftVersionId) : undefined
  if (head && !head.sealed && head.actorKey === key) {
    const isAi = key.startsWith('ai:')
    const withinSpan = now.getTime() - Date.parse(head.createdAt) <= AUTOSAVE_MAX_SPAN_MS
    const withinGap = now.getTime() - Date.parse(head.updatedAt) <= AUTOSAVE_MAX_GAP_MS
    if (isAi || (withinSpan && withinGap)) {
      ctx.db.update(versions).set({ doc, updatedAt: now.toISOString() }).where(eq(versions.id, head.id)).run()
      return head.id
    }
  }
  if (head && !head.sealed) ctx.db.update(versions).set({ sealed: true }).where(eq(versions.id, head.id)).run()
  return insertVersion(ctx, page.id, doc, actor, key.startsWith('ai:') ? 'ai' : 'autosave', false)
}

function insertVersion(ctx: ServiceCtx, pageId: string, doc: PageDoc, actor: ActingAs, kind: VersionRow['kind'], sealed: boolean, summary?: string): string {
  const max = ctx.db.select({ n: sql<number>`max(${versions.number})` }).from(versions).where(and(eq(versions.targetType, 'page'), eq(versions.targetId, pageId))).get()?.n ?? 0
  const id = newId('version', ctx.now().getTime())
  const now = iso(ctx)
  ctx.db
    .insert(versions)
    .values({ id, siteId: ctx.siteId, targetType: 'page', targetId: pageId, number: max + 1, doc, schemaVersion: doc.schemaVersion, kind, actorKey: actorKey(actor), authorId: actor.id, aiSessionId: actor.aiSessionId ?? null, summary: summary ?? null, sealed, createdAt: now, updatedAt: now })
    .run()
  return id
}

/**
 * Seal the draft head as a named version (checkpoint, submitted, restored...). If the head is already
 * sealed, a sealed copy is made so the kind and summary are recorded. Returns the sealed version id.
 */
export function sealDraft(ctx: ServiceCtx, pageId: string, actor: ActingAs, kind: VersionRow['kind'], summary?: string): string {
  return inTx(ctx, () => {
    const page = requirePage(ctx, pageId)
    const head = getVersionRow(ctx, page.draftVersionId!)
    if (!head.sealed) {
      ctx.db.update(versions).set({ sealed: true, kind, summary: summary ?? head.summary, updatedAt: iso(ctx) }).where(eq(versions.id, head.id)).run()
      return head.id
    }
    if (kind === 'ai' || (head.kind === kind && !summary)) return head.id
    const id = insertVersion(ctx, pageId, migratePageDoc(head.doc, ctx.registry), actor, kind, true, summary)
    ctx.db.update(pages).set({ draftVersionId: id }).where(eq(pages.id, pageId)).run()
    return id
  })
}

/** Withdraw a pending review because the draft changed. */
function withdrawPendingReview(ctx: ServiceCtx, page: PageRow, actor: ActingAs): WorkflowState {
  const pending = ctx.db.select().from(reviews).where(and(eq(reviews.targetType, 'page'), eq(reviews.targetId, page.id), eq(reviews.state, 'pending'))).get()
  if (!pending) return page.workflowState
  ctx.db.update(reviews).set({ state: 'withdrawn', decidedAt: iso(ctx) }).where(eq(reviews.id, pending.id)).run()
  audit(ctx, actor, 'review.withdrawn', { type: 'review', id: pending.id }, { reason: 'draft_changed' })
  return restingState({ publishedVersionId: page.publishedVersionId, wasUnpublished: page.wasUnpublished })
}

export interface OpsResult {
  revision: number
  doc: PageDoc
  meta: PageMeta & { path: string }
  opIds: string[]
  reviewWithdrawn: boolean
}

/**
 * Apply a batch of operations to a page's draft, all or nothing.
 * Conflict only if a different actor touched the same keys since baseRevision.
 */
export function applyPageOps(ctx: ServiceCtx, actor: ActingAs, pageId: string, baseRevision: number, ops: InternalOp[], opts: { undoOf?: string } = {}): OpsResult {
  if (!can(actor, 'page.edit')) throw forbidden()
  return inTx(ctx, () => {
    const page = requirePage(ctx, pageId)
    if (page.workflowState === 'approved') throw new AppError('invalid_state', 'This page is being published. Try again in a moment.')
    if (baseRevision > page.draftRevision) throw new AppError('conflict', 'Your copy of this page is newer than the server. Reload the page.', undefined, { current: { revision: page.draftRevision } })

    const current = readDoc(ctx, page.draftVersionId!)
    const meta: PageMeta = { slug: page.slug, parentId: page.parentId }
    const conflictBody = () => ({ current: { revision: page.draftRevision, doc: current, meta } })

    let result
    try {
      result = applyOps({ doc: current, meta }, ops, { registry: ctx.registry, newBlockId: () => newId('block') })
    } catch (error) {
      if (error instanceof OpError) {
        if (error.kind === 'missing_block' && baseRevision < page.draftRevision) throw new AppError('conflict', error.message, [{ path: error.path, message: error.message }], conflictBody())
        throw new AppError('validation_failed', error.message, [{ path: error.path, message: error.message }])
      }
      throw error
    }

    const key = actorKey(actor)
    if (baseRevision < page.draftRevision) {
      const since = ctx.db
        .select({ touches: draftOps.touches })
        .from(draftOps)
        .where(and(eq(draftOps.targetType, 'page'), eq(draftOps.targetId, pageId), gt(draftOps.revision, baseRevision), ne(draftOps.actorKey, key)))
        .all()
      const conflicts = touchesConflict(result.applied.flatMap((a) => a.touches), since.flatMap((s) => s.touches))
      if (conflicts.length) {
        throw new AppError('conflict', 'Someone else changed this since you last saw it.', undefined, { ...conflictBody(), conflicts })
      }
    }

    const rules = getTemplateRules(ctx, page.template)
    const valid = validatePageDoc(result.state.doc, ctx.registry, rules)
    if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]!.message, valid.issues)

    let path = page.path
    if (result.state.meta.slug !== page.slug || result.state.meta.parentId !== page.parentId) {
      if (page.isSystem) throw new AppError('validation_failed', "System pages can't be moved.", [{ path: 'slug', message: "Can't change." }])
      path = computePath(ctx, result.state.meta.slug, result.state.meta.parentId, page.id)
      assertPathFree(ctx, path, page.locale, page.id)
    }

    const headId = saveSnapshot(ctx, page, valid.doc, actor)
    const now = iso(ctx)
    const opIds: string[] = []
    result.applied.forEach((a, i) => {
      const id = newId('op', ctx.now().getTime())
      opIds.push(id)
      ctx.db
        .insert(draftOps)
        .values({ id, siteId: ctx.siteId, targetType: 'page', targetId: pageId, revision: page.draftRevision + i + 1, actorKey: key, userId: actor.id, aiSessionId: actor.aiSessionId ?? null, op: a.op as Record<string, unknown>, inverse: a.inverse as Record<string, unknown>, touches: a.touches, undoOf: opts.undoOf ?? null, createdAt: now })
        .run()
    })
    const revision = page.draftRevision + result.applied.length
    const state = page.workflowState === 'in_review' ? withdrawPendingReview(ctx, page, actor) : page.workflowState
    ctx.db
      .update(pages)
      .set({ draftRevision: revision, draftVersionId: headId, title: valid.doc.title, slug: result.state.meta.slug, parentId: result.state.meta.parentId, path, workflowState: state, updatedAt: now })
      .where(eq(pages.id, pageId))
      .run()
    if (path !== page.path) updateDescendantPaths(ctx, pageId, path)
    audit(ctx, actor, opts.undoOf ? 'page.undo' : 'page.edited', { type: 'page', id: pageId }, { ops: result.applied.map((a) => a.op.op), revision })
    return { revision, doc: valid.doc, meta: { ...result.state.meta, path }, opIds, reviewWithdrawn: state !== page.workflowState }
  })
}

/** Undo one operation by applying its inverse. Refused if someone else has touched the same thing since. */
export function undoOp(ctx: ServiceCtx, actor: ActingAs, pageId: string, opId: string): OpsResult {
  return inTx(ctx, () => {
    const page = requirePage(ctx, pageId)
    const op = ctx.db.select().from(draftOps).where(and(eq(draftOps.id, opId), eq(draftOps.targetId, pageId), eq(draftOps.siteId, ctx.siteId))).get()
    if (!op) throw notFound('That change')
    if (op.userId !== actor.id) throw forbidden('You can only undo your own changes, or changes the assistant made for you.')
    if (op.undoneAt) throw new AppError('invalid_state', 'That change has already been undone.')
    if (op.undoOf) throw new AppError('invalid_state', "An undo can't be undone. Make the change again instead.")
    if (op.op.op === 'restore_version') throw new AppError('invalid_state', 'To go back, restore the earlier version from History.')
    const later = ctx.db
      .select({ touches: draftOps.touches, actorKey: draftOps.actorKey })
      .from(draftOps)
      .where(and(eq(draftOps.targetType, 'page'), eq(draftOps.targetId, pageId), gt(draftOps.revision, op.revision)))
      .all()
    const others = later.filter((l) => l.actorKey !== op.actorKey && l.actorKey !== actorKey(actor))
    // Undoing an add removes the section, so it clashes with any later change to that section.
    const inverse = op.inverse as InternalOp
    const undoTouches = inverse.op === 'remove_block' ? [...op.touches, `block:${inverse.blockId}.*`] : op.touches
    const conflicts = touchesConflict(undoTouches, others.flatMap((l) => l.touches))
    if (conflicts.length) throw new AppError('conflict', "Someone else has changed this since, so it can't be undone automatically.", undefined, { conflicts })
    const result = applyPageOps(ctx, actor, pageId, page.draftRevision, [op.inverse as InternalOp], { undoOf: op.id })
    ctx.db.update(draftOps).set({ undoneAt: iso(ctx) }).where(eq(draftOps.id, op.id)).run()
    return result
  })
}

export function checkpoint(ctx: ServiceCtx, actor: ActingAs, pageId: string, summary: string) {
  if (!can(actor, 'page.edit')) throw forbidden()
  const versionId = sealDraft(ctx, pageId, actor, 'checkpoint', summary)
  audit(ctx, actor, 'page.checkpoint', { type: 'page', id: pageId }, { versionId, summary })
  return { versionId }
}

export function listVersions(ctx: ServiceCtx, pageId: string) {
  const page = requirePage(ctx, pageId)
  const rows = ctx.db
    .select({ id: versions.id, number: versions.number, kind: versions.kind, authorId: versions.authorId, aiSessionId: versions.aiSessionId, summary: versions.summary, sealed: versions.sealed, createdAt: versions.createdAt, updatedAt: versions.updatedAt })
    .from(versions)
    .where(and(eq(versions.targetType, 'page'), eq(versions.targetId, pageId)))
    .orderBy(desc(versions.number))
    .all()
  return rows
    .filter((v) => v.sealed || v.id === page.draftVersionId)
    .map((v) => ({ ...v, isLive: v.id === page.publishedVersionId, isDraft: v.id === page.draftVersionId }))
}

export function getVersion(ctx: ServiceCtx, pageId: string, versionId: string) {
  const v = getVersionRow(ctx, versionId)
  if (v.targetType !== 'page' || v.targetId !== pageId) throw notFound('That version')
  return { version: { id: v.id, number: v.number, kind: v.kind, summary: v.summary, createdAt: v.createdAt }, doc: migratePageDoc(v.doc, ctx.registry) }
}

/** Copy an old version into a new draft snapshot. Nothing is overwritten. */
export function restoreVersion(ctx: ServiceCtx, actor: ActingAs, pageId: string, versionId: string) {
  if (!can(actor, 'page.edit')) throw forbidden()
  return inTx(ctx, () => {
    const page = requirePage(ctx, pageId)
    if (page.workflowState === 'approved') throw new AppError('invalid_state', 'This page is being published. Try again in a moment.')
    const { doc, version } = getVersion(ctx, pageId, versionId)
    const rules = getTemplateRules(ctx, page.template)
    const valid = validatePageDoc(doc, ctx.registry, rules)
    if (!valid.ok) throw new AppError('validation_failed', "That version doesn't fit the page type's current rules.", valid.issues)
    const head = getVersionRow(ctx, page.draftVersionId!)
    if (!head.sealed) ctx.db.update(versions).set({ sealed: true }).where(eq(versions.id, head.id)).run()
    const id = insertVersion(ctx, pageId, valid.doc, actor, 'restored', true, `Restored version ${version.number}`)
    const state = page.workflowState === 'in_review' ? withdrawPendingReview(ctx, page, actor) : page.workflowState
    // Restoring changes everything, so it gets its own revision with a whole-page touch for conflict checks.
    const revision = page.draftRevision + 1
    ctx.db
      .insert(draftOps)
      .values({ id: newId('op', ctx.now().getTime()), siteId: ctx.siteId, targetType: 'page', targetId: pageId, revision, actorKey: actorKey(actor), userId: actor.id, aiSessionId: actor.aiSessionId ?? null, op: { op: 'restore_version', versionId }, inverse: { op: 'restore_version', versionId: head.id }, touches: ['meta.title', ...valid.doc.blocks.map((b) => `block:${b.id}.*`), ...migratePageDoc(head.doc, ctx.registry).blocks.map((b) => `block:${b.id}.*`)], undoOf: null, createdAt: iso(ctx) })
      .run()
    ctx.db.update(pages).set({ draftVersionId: id, draftRevision: revision, title: valid.doc.title, workflowState: state, updatedAt: iso(ctx) }).where(eq(pages.id, pageId)).run()
    audit(ctx, actor, 'page.restored', { type: 'page', id: pageId }, { fromVersion: versionId, newVersion: id })
    return { versionId: id, revision, doc: valid.doc }
  })
}

/** Move a page to the bin. Live pages must be unpublished first. */
export function binPage(ctx: ServiceCtx, actor: ActingAs, pageId: string) {
  const page = requirePage(ctx, pageId)
  if (page.isSystem) throw new AppError('invalid_state', "System pages can't be deleted.")
  if (page.publishedVersionId) throw new AppError('invalid_state', 'This page is live. Take it offline first.')
  const own = page.createdBy === actor.id && !page.publishedVersionId && !page.wasUnpublished
  if (!own && !can(actor, 'page.restoreFromBin')) throw forbidden('Only approvers can delete pages made by other people.')
  const children = ctx.db.select({ id: pages.id }).from(pages).where(and(eq(pages.parentId, pageId), isNull(pages.deletedAt))).all()
  if (children.length) throw new AppError('invalid_state', 'This page has pages inside it. Move or delete those first.')
  ctx.db.update(pages).set({ deletedAt: iso(ctx), updatedAt: iso(ctx) }).where(eq(pages.id, pageId)).run()
  audit(ctx, actor, 'page.binned', { type: 'page', id: pageId })
}

export function listOps(ctx: ServiceCtx, pageId: string, sinceRevision = 0) {
  return ctx.db
    .select()
    .from(draftOps)
    .where(and(eq(draftOps.targetType, 'page'), eq(draftOps.targetId, pageId), gt(draftOps.revision, sinceRevision)))
    .orderBy(asc(draftOps.revision))
    .all()
}

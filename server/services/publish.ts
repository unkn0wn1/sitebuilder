// Publishing and rollback. The filesystem renderer and symlink switch are behind ReleaseWriter
// (a no-op in tests that only care about the database). See ADR 0004, ADR 0005 and docs/08-hosting.md#publishing.
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { can } from '../../shared/roles'
import { pages, redirects, releases, reviews, siteParts, type ReleaseManifest } from '../db/schema'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { enqueueJob, type Job, type JobHandler } from './jobs'
import { notify, usersWithRoles } from './notify'
import { requirePage } from './pages'
import { requireReview, setTargetState } from './reviews'
import { requireSitePart } from './site-parts'

export interface WriteReleaseInput {
  ctx: ServiceCtx
  releaseId: string
  previousReleaseId: string | null
  manifest: ReleaseManifest
  changedPageIds: string[]
  changedSitePartIds: string[]
  removedPaths: string[]
}

export interface ReleaseWriter {
  /** Render the changed pages into a new release folder (hard-link copy of the previous one). */
  writeRelease(input: WriteReleaseInput): Promise<void> | void
  /** Point `current` at a release folder. */
  switchCurrent(releaseId: string): Promise<void> | void
  /** Rewrite sitemap, robots and redirects after the database pointers are updated. */
  refreshMaps?(ctx: ServiceCtx, releaseId: string): Promise<void> | void
}

export const noopReleaseWriter: ReleaseWriter = {
  writeRelease() {},
  switchCurrent() {},
}

export const EMPTY_MANIFEST: ReleaseManifest = { pages: {}, siteParts: {}, brandVersionId: null, theme: 'default', bundleId: 'dev' }

export function currentRelease(ctx: ServiceCtx) {
  return ctx.db
    .select()
    .from(releases)
    .where(and(eq(releases.siteId, ctx.siteId), eq(releases.state, 'live')))
    .orderBy(desc(releases.createdAt))
    .get()
}

export function listReleases(ctx: ServiceCtx) {
  return ctx.db.select().from(releases).where(eq(releases.siteId, ctx.siteId)).orderBy(desc(releases.createdAt)).limit(50).all()
}

interface PublishPayload {
  reviewId?: string
  unpublishPageId?: string
  redirectTo?: string | null
}

/** The publish job. One at a time (publish lane). */
export function createPublishHandler(writer: ReleaseWriter = noopReleaseWriter): JobHandler {
  return {
    async run(ctx, job) {
      const payload = job.payload as PublishPayload
      const prev = currentRelease(ctx)
      const manifest: ReleaseManifest = structuredClone(prev?.manifest ?? EMPTY_MANIFEST)
      const releaseId = newId('release', ctx.now().getTime())
      let review: ReturnType<typeof requireReview> | null = null
      let changedPageIds: string[] = []
      const changedSitePartIds: string[] = []
      const removedPaths: string[] = []

      if (payload.reviewId) {
        review = requireReview(ctx, payload.reviewId)
        if (review.state !== 'approved') throw new Error(`Review ${review.id} is ${review.state}, not approved.`)
        if (review.targetType === 'page') {
          const page = requirePage(ctx, review.targetId)
          const oldPath = manifest.pages[page.id]?.path
          if (oldPath && oldPath !== page.path) removedPaths.push(oldPath)
          manifest.pages[page.id] = { versionId: review.versionId, path: page.path }
          changedPageIds = [page.id]
        } else if (review.targetType === 'site_part') {
          requireSitePart(ctx, review.targetId)
          manifest.siteParts[review.targetId] = review.versionId
          changedSitePartIds.push(review.targetId)
          // The header, footer, menus and banner are on every page, so every live page is re-rendered.
          changedPageIds = Object.keys(manifest.pages)
        } else {
          throw new Error(`Publishing ${review.targetType} is not built yet.`)
        }
      } else if (payload.unpublishPageId) {
        const entry = manifest.pages[payload.unpublishPageId]
        if (entry) removedPaths.push(entry.path)
        delete manifest.pages[payload.unpublishPageId]
        changedPageIds = [payload.unpublishPageId]
      } else {
        throw new Error('Publish job has nothing to do.')
      }

      ctx.db
        .insert(releases)
        .values({ id: releaseId, siteId: ctx.siteId, kind: 'publish', state: 'building', manifest, createdBy: job.createdBy ?? 'system', reviewId: review?.id ?? null, selfApproved: review?.selfApproved ?? false, createdAt: iso(ctx) })
        .run()
      try {
        await writer.writeRelease({ ctx, releaseId, previousReleaseId: prev?.id ?? null, manifest, changedPageIds, changedSitePartIds, removedPaths })
        await writer.switchCurrent(releaseId)
      } catch (error) {
        ctx.db.update(releases).set({ state: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: iso(ctx) }).where(eq(releases.id, releaseId)).run()
        throw error
      }

      inTx(ctx, () => {
        if (prev) ctx.db.update(releases).set({ state: 'superseded' }).where(eq(releases.id, prev.id)).run()
        ctx.db.update(releases).set({ state: 'live', finishedAt: iso(ctx) }).where(eq(releases.id, releaseId)).run()
        if (review?.targetType === 'site_part') {
          const part = requireSitePart(ctx, review.targetId)
          ctx.db.update(siteParts).set({ publishedVersionId: review.versionId, workflowState: 'published', wasUnpublished: false, updatedAt: iso(ctx) }).where(eq(siteParts.id, part.id)).run()
          ctx.db.update(reviews).set({ state: 'published' }).where(eq(reviews.id, review.id)).run()
          audit(ctx, 'system', 'site_part.published', { type: 'site_part', id: part.id }, { releaseId, versionId: review.versionId, reviewId: review.id, selfApproved: review.selfApproved })
          notify(ctx, [review.submittedBy], 'published', `The ${part.label.toLowerCase()} is live.`, { type: 'site_part', id: part.id })
          enqueueJob(ctx, 'purge_cache', { tags: ['shell'] })
          return
        }
        const pageId = review ? review.targetId : payload.unpublishPageId!
        const page = requirePage(ctx, pageId)
        if (review) {
          ctx.db
            .update(pages)
            .set({ publishedVersionId: review.versionId, publishedPath: page.path, workflowState: 'published', wasUnpublished: false, updatedAt: iso(ctx) })
            .where(eq(pages.id, pageId))
            .run()
          ctx.db.update(reviews).set({ state: 'published' }).where(eq(reviews.id, review.id)).run()
          // A live page wins over any old redirect from its address (for example after moving a page back).
          ctx.db.delete(redirects).where(and(eq(redirects.siteId, ctx.siteId), eq(redirects.fromPath, page.path))).run()
          if (page.publishedPath && page.publishedPath !== page.path) addRedirect(ctx, page.publishedPath, page.path, 'slug_change')
          audit(ctx, 'system', 'page.published', { type: 'page', id: pageId }, { releaseId, versionId: review.versionId, reviewId: review.id, selfApproved: review.selfApproved })
          notify(ctx, [review.submittedBy], 'published', `"${page.title}" is live.`, { type: 'page', id: pageId })
        } else {
          ctx.db
            .update(pages)
            .set({ publishedVersionId: null, publishedPath: null, workflowState: 'unpublished', wasUnpublished: true, updatedAt: iso(ctx) })
            .where(eq(pages.id, pageId))
            .run()
          if (payload.redirectTo && page.publishedPath) addRedirect(ctx, page.publishedPath, payload.redirectTo, 'unpublish')
          audit(ctx, 'system', 'page.unpublished', { type: 'page', id: pageId }, { releaseId })
        }
        enqueueJob(ctx, 'purge_cache', { tags: [`page-${pageId}`] })
      })
      // Maps were written during writeRelease; refresh so slug-change and unpublish redirects are included.
      try {
        await writer.refreshMaps?.(ctx, releaseId)
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', msg: 'release.refreshMaps', releaseId, error: String(error) }))
      }
      return { releaseId }
    },

    onFinalFailure(ctx, job: Job, error) {
      const payload = job.payload as PublishPayload
      const message = error instanceof Error ? error.message : String(error)
      inTx(ctx, () => {
        if (payload.reviewId) {
          const review = requireReview(ctx, payload.reviewId)
          // Back to pending, so an approver can retry by approving again.
          ctx.db.update(reviews).set({ state: 'pending', decisionComment: `Publish failed: ${message}` }).where(eq(reviews.id, review.id)).run()
          if (review.targetType === 'page' || review.targetType === 'site_part') setTargetState(ctx, { type: review.targetType, id: review.targetId }, 'in_review')
          notify(ctx, [review.decidedBy ?? '', ...usersWithRoles(ctx, ['admin'])].filter(Boolean), 'publish_failed', `Publishing failed: ${message}`, { type: 'review', id: review.id })
        } else if (payload.unpublishPageId) {
          ctx.db.update(pages).set({ workflowState: 'published', updatedAt: iso(ctx) }).where(eq(pages.id, payload.unpublishPageId)).run()
        }
        audit(ctx, 'system', 'publish.failed', undefined, { jobId: job.id, error: message })
      })
    },
  }
}

function addRedirect(ctx: ServiceCtx, fromPath: string, toPath: string, source: 'manual' | 'slug_change' | 'unpublish') {
  const existing = ctx.db.select().from(redirects).where(and(eq(redirects.siteId, ctx.siteId), eq(redirects.fromPath, fromPath))).get()
  if (existing) ctx.db.update(redirects).set({ toPath, source }).where(eq(redirects.id, existing.id)).run()
  else ctx.db.insert(redirects).values({ id: newId('redirect', ctx.now().getTime()), siteId: ctx.siteId, fromPath, toPath, statusCode: 301, source, createdAt: iso(ctx) }).run()
}

export function unpublishPage(ctx: ServiceCtx, actor: ActingAs, pageId: string, redirectTo?: string | null) {
  if (actor.aiSessionId || !can(actor, 'page.unpublish')) throw forbidden()
  return inTx(ctx, () => {
    const page = requirePage(ctx, pageId)
    if (!page.publishedVersionId) throw new AppError('invalid_state', "This page isn't live.")
    if (page.workflowState === 'approved') throw new AppError('invalid_state', 'This page is being published. Try again in a moment.')
    if (page.isSystem) throw new AppError('invalid_state', "System pages can't be taken offline.")
    const jobId = enqueueJob(ctx, 'publish', { unpublishPageId: pageId, redirectTo: redirectTo ?? null }, { createdBy: actor.id })
    ctx.db.update(pages).set({ workflowState: 'approved', updatedAt: iso(ctx) }).where(eq(pages.id, pageId)).run()
    audit(ctx, actor, 'page.unpublish_requested', { type: 'page', id: pageId }, { jobId, redirectTo: redirectTo ?? null })
    return { jobId }
  })
}

/**
 * Emergency site rollback: switch to an earlier release AND reset the database "published" pointers
 * to that release's manifest. Admin only, reason required, no second approver. ADR 0005.
 */
export async function rollbackSite(ctx: ServiceCtx, actor: ActingAs, targetReleaseId: string, reason: string, writer: ReleaseWriter = noopReleaseWriter) {
  if (actor.aiSessionId || !can(actor, 'site.rollback')) throw forbidden('Only admins can roll back the whole site.')
  if (!reason.trim()) throw new AppError('validation_failed', 'Say why you are rolling back.', [{ path: 'reason', message: 'Needed.' }])
  const target = ctx.db.select().from(releases).where(and(eq(releases.id, targetReleaseId), eq(releases.siteId, ctx.siteId))).get()
  if (!target) throw notFound('That release')
  if (target.state !== 'superseded' && target.state !== 'live') throw new AppError('invalid_state', "That release can't be rolled back to.")
  const prev = currentRelease(ctx)
  if (prev?.id === target.id) throw new AppError('invalid_state', 'That release is already live.')

  await writer.switchCurrent(target.id)

  return inTx(ctx, () => {
    const id = newId('release', ctx.now().getTime())
    if (prev) ctx.db.update(releases).set({ state: 'superseded' }).where(eq(releases.id, prev.id)).run()
    ctx.db
      .insert(releases)
      .values({ id, siteId: ctx.siteId, kind: 'rollback', state: 'live', manifest: target.manifest, createdBy: actor.id, rolledBackTo: target.id, reason, createdAt: iso(ctx), finishedAt: iso(ctx) })
      .run()

    const all = ctx.db.select().from(pages).where(eq(pages.siteId, ctx.siteId)).all()
    for (const page of all) {
      const entry = target.manifest.pages[page.id]
      const settled = page.workflowState === 'published' || page.workflowState === 'unpublished' || page.workflowState === 'draft'
      if (entry) {
        ctx.db
          .update(pages)
          .set({ publishedVersionId: entry.versionId, publishedPath: entry.path, wasUnpublished: false, workflowState: settled ? 'published' : page.workflowState, updatedAt: iso(ctx) })
          .where(eq(pages.id, page.id))
          .run()
      } else if (page.publishedVersionId) {
        ctx.db
          .update(pages)
          .set({ publishedVersionId: null, publishedPath: null, wasUnpublished: true, workflowState: settled ? 'unpublished' : page.workflowState, updatedAt: iso(ctx) })
          .where(eq(pages.id, page.id))
          .run()
      }
    }
    for (const part of ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all()) {
      const versionId = target.manifest.siteParts[part.id] ?? null
      if (versionId === part.publishedVersionId) continue
      const settled = part.workflowState === 'published' || part.workflowState === 'unpublished' || part.workflowState === 'draft'
      const state = settled ? (versionId ? 'published' : 'draft') : part.workflowState
      ctx.db.update(siteParts).set({ publishedVersionId: versionId, workflowState: state, updatedAt: iso(ctx) }).where(eq(siteParts.id, part.id)).run()
    }
    audit(ctx, actor, 'site.rolled_back', { type: 'release', id: target.id }, { newReleaseId: id, reason })
    enqueueJob(ctx, 'purge_cache', { tags: ['shell'] })
    notify(ctx, usersWithRoles(ctx, ['approver', 'admin']), 'emergency_rollback', `The site was rolled back by an admin: ${reason}`, { type: 'release', id })
    return { releaseId: id }
  })
}

/** Pages that have a live version, for sitemaps and checks. */
export function livePages(ctx: ServiceCtx) {
  return ctx.db
    .select({ id: pages.id, path: pages.publishedPath, versionId: pages.publishedVersionId })
    .from(pages)
    .where(and(eq(pages.siteId, ctx.siteId), isNotNull(pages.publishedVersionId), ne(pages.workflowState, 'unpublished')))
    .all()
}

/** Rebuild every live page into a new release. Used after restore, and later for "re-render the whole site". */
export async function rebuildPublishedSite(ctx: ServiceCtx, writer: ReleaseWriter, actor: ActingAs | 'system' = 'system') {
  const prev = currentRelease(ctx)
  const manifest: ReleaseManifest = structuredClone(prev?.manifest ?? EMPTY_MANIFEST)
  for (const page of ctx.db.select().from(pages).where(eq(pages.siteId, ctx.siteId)).all()) {
    if (page.deletedAt || !page.publishedVersionId || !page.publishedPath || page.workflowState === 'unpublished') {
      delete manifest.pages[page.id]
      continue
    }
    manifest.pages[page.id] = { versionId: page.publishedVersionId, path: page.publishedPath }
  }
  for (const part of ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all()) {
    if (part.publishedVersionId) manifest.siteParts[part.id] = part.publishedVersionId
    else delete manifest.siteParts[part.id]
  }
  const releaseId = newId('release', ctx.now().getTime())
  const changedPageIds = Object.keys(manifest.pages)
  const createdBy = actor === 'system' ? 'system' : actor.id
  ctx.db
    .insert(releases)
    .values({ id: releaseId, siteId: ctx.siteId, kind: 'full_render', state: 'building', manifest, createdBy, reviewId: null, selfApproved: false, createdAt: iso(ctx) })
    .run()
  try {
    await writer.writeRelease({ ctx, releaseId, previousReleaseId: prev?.id ?? null, manifest, changedPageIds, changedSitePartIds: Object.keys(manifest.siteParts), removedPaths: [] })
    await writer.switchCurrent(releaseId)
  } catch (error) {
    ctx.db
      .update(releases)
      .set({ state: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: iso(ctx) })
      .where(eq(releases.id, releaseId))
      .run()
    throw error
  }
  inTx(ctx, () => {
    if (prev) ctx.db.update(releases).set({ state: 'superseded' }).where(eq(releases.id, prev.id)).run()
    ctx.db.update(releases).set({ state: 'live', finishedAt: iso(ctx) }).where(eq(releases.id, releaseId)).run()
    enqueueJob(ctx, 'purge_cache', { tags: ['shell'] })
  })
  try {
    await writer.refreshMaps?.(ctx, releaseId)
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', msg: 'release.refreshMaps', releaseId, error: String(error) }))
  }
  return { releaseId, pages: changedPageIds.length }
}


// Publishing and rollback. The filesystem renderer and symlink switch are behind ReleaseWriter
// (a no-op in tests that only care about the database). See ADR 0004, ADR 0005 and docs/08-hosting.md#publishing.
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { can } from '../../shared/roles'
import { brandPacks, pages, redirects, releases, reviews, siteParts, sites, templates, versions, type ReleaseManifest } from '../db/schema'
import { aliasesFromRedirects, collectLinkedPageIds, pageIdByPath, pathAliases } from '../../shared/internal-links'
import { migratePageDoc } from '../../shared/page'
import { migrateSitePartDoc } from '../../shared/site-parts'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { enqueueJob, type Job, type JobHandler } from './jobs'
import { notify, usersWithRoles } from './notify'
import { requirePage } from './pages'
import { requireReview, setTargetState } from './reviews'
import { getOrCreateBrand, readBrandDoc } from './brand'
import { readTemplateDoc, requireTemplate } from './templates'
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

export const EMPTY_MANIFEST: ReleaseManifest = { pages: {}, siteParts: {}, templates: {}, brandVersionId: null, theme: 'default', bundleId: 'dev' }

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
      let purgeTags: string[] | null = null
      const previousManifest = prev?.manifest ?? EMPTY_MANIFEST

      if (payload.reviewId) {
        review = requireReview(ctx, payload.reviewId)
        if (review.state !== 'approved') throw new Error(`Review ${review.id} is ${review.state}, not approved.`)
        if (review.targetType === 'page') {
          const page = requirePage(ctx, review.targetId)
          const oldPath = manifest.pages[page.id]?.path
          if (oldPath && oldPath !== page.path) removedPaths.push(oldPath)
          const nextTitle = pageTitleOf(ctx, review.versionId) ?? page.title
          const identityChanged = pageIdentityChanged(ctx, previousManifest, page.id, { path: page.path, title: nextTitle })
          manifest.pages[page.id] = { versionId: review.versionId, path: page.path }
          changedPageIds = [page.id]
          if (identityChanged) {
            const inbound = pagesLinkingTo(ctx, previousManifest, page.id)
            changedPageIds = uniqueIds([page.id, ...inbound.pageIds])
            purgeTags = inbound.viaShell ? ['shell'] : changedPageIds.map((id) => `page-${id}`)
          } else {
            purgeTags = [`page-${page.id}`]
          }
        } else if (review.targetType === 'site_part') {
          requireSitePart(ctx, review.targetId)
          manifest.siteParts[review.targetId] = review.versionId
          changedSitePartIds.push(review.targetId)
          // The header, footer, menus and banner are on every page, so every live page is re-rendered.
          changedPageIds = Object.keys(manifest.pages)
        } else if (review.targetType === 'brand') {
          const pack = getOrCreateBrand(ctx)
          if (pack.id !== review.targetId) throw new Error('Unknown brand pack')
          manifest.brandVersionId = review.versionId
          manifest.theme = readBrandDoc(ctx, pack, review.versionId).theme
          // Tokens and menu look are on every page.
          changedPageIds = Object.keys(manifest.pages)
        } else if (review.targetType === 'template') {
          requireTemplate(ctx, review.targetId)
          // Page-type rules apply to later page edits. Live HTML does not change.
          changedPageIds = []
          purgeTags = []
        } else {
          throw new Error(`Publishing ${review.targetType} is not built yet.`)
        }
      } else if (payload.unpublishPageId) {
        const entry = manifest.pages[payload.unpublishPageId]
        if (entry) removedPaths.push(entry.path)
        const inbound = pagesLinkingTo(ctx, previousManifest, payload.unpublishPageId)
        delete manifest.pages[payload.unpublishPageId]
        changedPageIds = uniqueIds([payload.unpublishPageId, ...inbound.pageIds])
        purgeTags = inbound.viaShell ? ['shell'] : uniqueIds([payload.unpublishPageId, ...inbound.pageIds]).map((id) => `page-${id}`)
      } else {
        throw new Error('Publish job has nothing to do.')
      }

      // Parts made live at setup (the starter menu and footer) join the first release, and any later one that lacks them.
      const missingParts = ctx.db
        .select({ id: siteParts.id, versionId: siteParts.publishedVersionId })
        .from(siteParts)
        .where(and(eq(siteParts.siteId, ctx.siteId), isNotNull(siteParts.publishedVersionId)))
        .all()
        .filter((p) => !manifest.siteParts[p.id])
      if (missingParts.length) {
        for (const p of missingParts) manifest.siteParts[p.id] = p.versionId!
        changedSitePartIds.push(...missingParts.map((p) => p.id))
        changedPageIds = uniqueIds([...changedPageIds, ...Object.keys(manifest.pages)])
        purgeTags = ['shell']
      }

      stampTemplates(ctx, manifest, review?.targetType === 'template' ? { id: review.targetId, versionId: review.versionId } : undefined)
      stampLinkedPageIds(ctx, manifest, previousManifest)

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
        if (review?.targetType === 'brand') {
          const pack = getOrCreateBrand(ctx)
          ctx.db.update(brandPacks).set({ publishedVersionId: review.versionId, workflowState: 'published', wasUnpublished: false, updatedAt: iso(ctx) }).where(eq(brandPacks.id, pack.id)).run()
          ctx.db.update(reviews).set({ state: 'published' }).where(eq(reviews.id, review.id)).run()
          audit(ctx, 'system', 'brand.published', { type: 'brand', id: pack.id }, { releaseId, versionId: review.versionId, reviewId: review.id, selfApproved: review.selfApproved })
          notify(ctx, [review.submittedBy], 'published', 'The new look is live. Every page is being updated.', { type: 'brand', id: pack.id })
          enqueueJob(ctx, 'purge_cache', { tags: ['shell'] })
          return
        }
        if (review?.targetType === 'template') {
          const pack = requireTemplate(ctx, review.targetId)
          const doc = readTemplateDoc(ctx, pack, review.versionId)
          ctx.db.update(templates).set({ publishedVersionId: review.versionId, label: doc.label, workflowState: 'published', wasUnpublished: false, updatedAt: iso(ctx) }).where(eq(templates.id, pack.id)).run()
          ctx.db.update(reviews).set({ state: 'published' }).where(eq(reviews.id, review.id)).run()
          audit(ctx, 'system', 'template.published', { type: 'template', id: pack.id }, { releaseId, versionId: review.versionId, reviewId: review.id, selfApproved: review.selfApproved })
          notify(ctx, [review.submittedBy], 'published', `The ${doc.label} page type is live.`, { type: 'template', id: pack.id })
          return
        }
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
        enqueueJob(ctx, 'purge_cache', { tags: purgeTags ?? [`page-${pageId}`] })
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
          if (review.targetType === 'page' || review.targetType === 'site_part' || review.targetType === 'brand' || review.targetType === 'template') setTargetState(ctx, { type: review.targetType, id: review.targetId }, 'in_review')
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
    const pack = ctx.db.select().from(brandPacks).where(eq(brandPacks.siteId, ctx.siteId)).get()
    if (pack) {
      const versionId = target.manifest.brandVersionId ?? null
      if (versionId !== pack.publishedVersionId) {
        const settled = pack.workflowState === 'published' || pack.workflowState === 'unpublished' || pack.workflowState === 'draft'
        const state = settled ? (versionId ? 'published' : 'draft') : pack.workflowState
        ctx.db.update(brandPacks).set({ publishedVersionId: versionId, workflowState: state, updatedAt: iso(ctx) }).where(eq(brandPacks.id, pack.id)).run()
      }
    }
    if (target.manifest.templates) {
      for (const row of ctx.db.select().from(templates).where(eq(templates.siteId, ctx.siteId)).all()) {
        const versionId = target.manifest.templates[row.id] ?? null
        if (versionId === row.publishedVersionId) continue
        const settled = row.workflowState === 'published' || row.workflowState === 'unpublished' || row.workflowState === 'draft'
        const state = settled ? (versionId ? 'published' as const : 'draft' as const) : row.workflowState
        const label = versionId ? (pageTypeLabel(ctx, versionId) ?? row.label) : row.label
        ctx.db.update(templates).set({ publishedVersionId: versionId, label, workflowState: state, updatedAt: iso(ctx) }).where(eq(templates.id, row.id)).run()
      }
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
  const pack = ctx.db.select().from(brandPacks).where(eq(brandPacks.siteId, ctx.siteId)).get()
  manifest.brandVersionId = pack?.publishedVersionId ?? null
  stampTemplates(ctx, manifest)
  stampLinkedPageIds(ctx, manifest, prev?.manifest)
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



function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

function siteOrigin(ctx: ServiceCtx): string | null {
  const domain = ctx.db.select({ primaryDomain: sites.primaryDomain }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.primaryDomain
  return domain ? `https://${domain}` : null
}

function versionDoc(ctx: ServiceCtx, versionId: string): unknown {
  return ctx.db.select({ doc: versions.doc }).from(versions).where(eq(versions.id, versionId)).get()?.doc
}

function pageTitleOf(ctx: ServiceCtx, versionId: string): string | null {
  const raw = versionDoc(ctx, versionId)
  if (!raw) return null
  return migratePageDoc(raw, ctx.registry).title
}

function pageTypeLabel(ctx: ServiceCtx, versionId: string): string | null {
  const raw = versionDoc(ctx, versionId)
  if (!raw || typeof raw !== 'object' || !('label' in raw)) return null
  const label = (raw as { label?: unknown }).label
  return typeof label === 'string' ? label : null
}

function linkAliases(ctx: ServiceCtx, manifest: ReleaseManifest, previous?: ReleaseManifest | null): Map<string, string> {
  const aliases = previous ? pathAliases(previous.pages, manifest.pages) : new Map<string, string>()
  const rows = ctx.db.select({ fromPath: redirects.fromPath, toPath: redirects.toPath }).from(redirects).where(eq(redirects.siteId, ctx.siteId)).all()
  for (const [from, id] of aliasesFromRedirects(rows, pageIdByPath(manifest.pages))) {
    if (!aliases.has(from)) aliases.set(from, id)
  }
  return aliases
}

function stampLinkedPageIds(ctx: ServiceCtx, manifest: ReleaseManifest, previous?: ReleaseManifest | null) {
  const pagesMap = pageIdByPath(manifest.pages)
  const origin = siteOrigin(ctx)
  const aliases = linkAliases(ctx, manifest, previous)
  for (const entry of Object.values(manifest.pages)) {
    const raw = versionDoc(ctx, entry.versionId)
    entry.linkedPageIds = raw ? collectLinkedPageIds(migratePageDoc(raw, ctx.registry), pagesMap, origin, aliases) : []
  }
}

function stampTemplates(ctx: ServiceCtx, manifest: ReleaseManifest, override?: { id: string; versionId: string }) {
  const next: Record<string, string> = {}
  for (const row of ctx.db.select().from(templates).where(eq(templates.siteId, ctx.siteId)).all()) {
    if (row.publishedVersionId) next[row.id] = row.publishedVersionId
  }
  if (override) next[override.id] = override.versionId
  manifest.templates = next
}

function shellLinkedPageIds(ctx: ServiceCtx, manifest: ReleaseManifest): Set<string> {
  const pagesMap = pageIdByPath(manifest.pages)
  const origin = siteOrigin(ctx)
  const ids = new Set<string>()
  const parts = ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all()
  const loaded: { kind: string; key: string; doc: unknown }[] = []
  for (const part of parts) {
    const versionId = manifest.siteParts[part.id]
    if (!versionId) continue
    loaded.push({ kind: part.kind, key: part.key, doc: migrateSitePartDoc(part.kind, versionDoc(ctx, versionId)) })
  }
  const menus = Object.fromEntries(loaded.filter((p) => p.kind === 'menu').map((p) => [p.key, p.doc]))
  const header = loaded.find((p) => p.kind === 'header')
  const footer = loaded.find((p) => p.kind === 'footer')
  const banner = loaded.find((p) => p.kind === 'banner')

  const add = (doc: unknown) => {
    for (const id of collectLinkedPageIds(doc, pagesMap, origin)) ids.add(id)
  }
  // The renderer uses the header's menu, or the "main" menu if there is no header.
  const menuKey = (header?.doc as { menuKey?: string } | undefined)?.menuKey ?? 'main'
  if (menus[menuKey]) add(menus[menuKey])
  if (header) add(header.doc)
  if (footer) {
    add(footer.doc)
    const key = (footer.doc as { legalMenuKey?: string | null } | null)?.legalMenuKey
    if (key && menus[key]) add(menus[key])
    const columns = footer.doc as { layout?: string; linksMenuKey?: string | null } | null
    if (columns?.layout === 'columns' && columns.linksMenuKey && menus[columns.linksMenuKey]) add(menus[columns.linksMenuKey])
  }
  if (banner && (banner.doc as { enabled?: boolean } | null)?.enabled) add(banner.doc)
  return ids
}

/** Pages whose current (previous-release) HTML would change if this page's title, address or live state changed. */
export function pagesLinkingTo(ctx: ServiceCtx, manifest: ReleaseManifest, targetId: string): { viaShell: boolean; pageIds: string[] } {
  if (shellLinkedPageIds(ctx, manifest).has(targetId)) {
    return { viaShell: true, pageIds: Object.keys(manifest.pages).filter((id) => id !== targetId) }
  }
  const pagesMap = pageIdByPath(manifest.pages)
  const origin = siteOrigin(ctx)
  const aliases = linkAliases(ctx, manifest)
  const inbound: string[] = []
  for (const [id, entry] of Object.entries(manifest.pages)) {
    if (id === targetId) continue
    const raw = versionDoc(ctx, entry.versionId)
    const ids = raw ? collectLinkedPageIds(migratePageDoc(raw, ctx.registry), pagesMap, origin, aliases) : (entry.linkedPageIds ?? [])
    if (ids.includes(targetId)) inbound.push(id)
  }
  return { viaShell: false, pageIds: inbound }
}

function pageIdentityChanged(ctx: ServiceCtx, previous: ReleaseManifest, pageId: string, next: { path: string; title: string }): boolean {
  const prevEntry = previous.pages[pageId]
  if (!prevEntry) return true
  if (prevEntry.path !== next.path) return true
  const prevTitle = pageTitleOf(ctx, prevEntry.versionId)
  return prevTitle !== next.title
}

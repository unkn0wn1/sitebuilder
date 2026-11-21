// Media for agents (phase 5): list the library, import a photo from an address, set alt text.
//
// Decided 21 Nov 2026 (Spencer): the media library is open to any token with draft access. No rule or approval is
// needed, because a photo is only on the live site once a published page uses it, and that page goes through the
// normal change rules. Every import and alt-text edit is audited against the token.
//
// Imports are asynchronous: import_media checks the address and queues a job, and returns an import id straight away.
// The agent then calls get_media_import until it says "done" (with the media id) or "failed" (with the reason).
// The job fetches with the same guard as agent alerts (public https only, every redirect hop checked, resolved
// addresses checked before connecting), caps the download at the media size limit, and hands the bytes to the normal
// upload path, which detects the type from the file itself, strips metadata and makes renditions.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { agentTokens, jobs, media, users } from '../../db/schema'
import { audit } from '../audit'
import type { ActingAs, ServiceCtx } from '../context'
import { AppError, notFound } from '../errors'
import { enqueueJob, getJob, type JobHandler } from '../jobs'
import { getMedia, listMedia, MEDIA_MAX_BYTES, updateMedia, uploadMedia } from '../media'
import { BlockedDestination, checkPublicUrl, defaultResolver, followSafely, readCapped, type Resolver } from '../net-guard'
import type { SignedInAgent } from './tokens'

/** Most imports one token may have waiting or running at once. */
export const MAX_PENDING_IMPORTS = 10

const allowHttpEnv = () => process.env.SITEBUILDER_AGENT_MEDIA_ALLOW_HTTP === '1'

interface ImportPayload {
  tokenId: string
  url: string
  alt: string | null
  decorative: boolean
  filename: string | null
}

function mediaView(row: typeof media.$inferSelect) {
  return {
    media_id: row.id,
    filename: row.filename,
    kind: row.kind,
    alt: row.alt,
    decorative: row.decorative,
    width: row.width,
    height: row.height,
    status: row.status,
    created_at: row.createdAt,
    use_in_props: row.kind === 'video' ? { media: row.id } : { media: row.id, alt: row.alt ?? '' },
  }
}

export function listMediaFor(ctx: ServiceCtx, input: { search?: string; kind?: 'image' | 'video'; page: number; page_size: number }) {
  const r = listMedia(ctx, { search: input.search, kind: input.kind, page: input.page, pageSize: input.page_size })
  return {
    media: r.items.map(mediaView),
    page: r.page,
    page_size: r.pageSize,
    total: r.total,
    note: 'To put a photo in a section, use its use_in_props value for the image field (for example Hero.image). A photo without alt text blocks publishing: set it with set_alt_text first.',
  }
}

function pendingImports(ctx: ServiceCtx, tokenId: string): number {
  return (
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'agent_media_import'), inArray(jobs.state, ['queued', 'running']), sql`json_extract(${jobs.payload}, '$.tokenId') = ${tokenId}`))
      .get()?.n ?? 0
  )
}

export function importMediaFor(ctx: ServiceCtx, agent: SignedInAgent, input: { url: string; alt?: string; decorative?: boolean; filename?: string; reason: string }) {
  const url = checkPublicUrl(input.url, { allowHttp: allowHttpEnv(), example: 'https://example.org/photos/dog.jpg' })
  if (!input.decorative && !input.alt) throw new AppError('validation_failed', 'Give alt text (what the photo shows, for people who cannot see it), or set decorative: true if it adds nothing.', [{ path: 'alt', message: 'Required unless decorative.' }])
  if (pendingImports(ctx, agent.token.id) >= MAX_PENDING_IMPORTS) throw new AppError('rate_limited', `This token already has ${MAX_PENDING_IMPORTS} imports waiting. Wait for them with get_media_import, then try again.`)
  const payload: ImportPayload = { tokenId: agent.token.id, url, alt: input.decorative ? null : (input.alt ?? null), decorative: !!input.decorative, filename: input.filename ?? null }
  const jobId = enqueueJob(ctx, 'agent_media_import', payload as unknown as Record<string, unknown>, { maxAttempts: 2, createdBy: agent.actor.id })
  audit(ctx, agent.actor, 'agent.media.import_queued', { type: 'job', id: jobId }, { tokenId: agent.token.id, host: new URL(url).host, reason: input.reason })
  return {
    import_id: jobId,
    status: 'queued',
    next_steps: [`Call get_media_import with import_id "${jobId}" in a few seconds. When it says "done" it gives the media_id to use.`],
  }
}

export function getMediaImportFor(ctx: ServiceCtx, agent: SignedInAgent, input: { import_id: string }) {
  const job = getJob(ctx, input.import_id)
  const payload = job?.payload as unknown as ImportPayload | undefined
  if (!job || job.kind !== 'agent_media_import' || payload?.tokenId !== agent.token.id) throw notFound('That import')
  const result = (job.result ?? {}) as { mediaId?: string; duplicate?: boolean; failed?: string; skipped?: string }
  const base = { import_id: job.id, url: payload.url }
  if (job.state === 'queued' || job.state === 'running') return { ...base, status: job.attempts > 0 ? 'retrying' : job.state, last_error: job.lastError, next_steps: ['Wait a few seconds and call get_media_import again.'] }
  if (job.state === 'failed') return { ...base, status: 'failed', error: job.lastError ?? 'The import failed.', next_steps: ['Tell the person the photo could not be fetched and why. They can upload it in the builder instead.'] }
  if (result.failed || result.skipped) return { ...base, status: 'failed', error: result.failed ?? result.skipped, next_steps: ['Tell the person the photo could not be imported and why. Do not retry the same address.'] }
  const row = ctx.db.select().from(media).where(eq(media.id, result.mediaId ?? '')).get()
  if (!row || row.deletedAt) return { ...base, status: 'failed', error: 'The photo was imported but has since been removed from the library.' }
  return { ...base, status: 'done', duplicate: !!result.duplicate, media: mediaView(row), next_steps: ['Use media.use_in_props in a section (add_component or edit_component). The photo is not live until a published page uses it.'] }
}

export function setAltTextFor(ctx: ServiceCtx, agent: SignedInAgent, input: { media_id: string; alt?: string; decorative?: boolean; reason: string }) {
  if (!input.decorative && !input.alt) throw new AppError('validation_failed', 'Give alt text, or set decorative: true.', [{ path: 'alt', message: 'Required unless decorative.' }])
  getMedia(ctx, input.media_id)
  const before = ctx.db.select({ alt: media.alt, decorative: media.decorative }).from(media).where(eq(media.id, input.media_id)).get()
  const row = updateMedia(ctx, agent.actor, input.media_id, input.decorative ? { decorative: true, alt: null } : { decorative: false, alt: input.alt! })
  audit(ctx, agent.actor, 'agent.media.alt_set', { type: 'media', id: row.id }, { tokenId: agent.token.id, before, reason: input.reason })
  return { media: mediaView(row), note: 'Alt text is shared: every page that uses this photo now shows the new text, including live pages after their next publish.' }
}

// ---------------------------------------------------------------------------------------------------------------------
// The job

export interface MediaImportDeps {
  fetch?: typeof fetch
  resolve?: Resolver
  /** Tests only: allow private and http addresses. */
  allowPrivate?: boolean
}

function filenameFrom(url: string, given: string | null): string {
  if (given) return given
  const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '')
  return last.slice(0, 120) || 'imported-photo'
}

export function createMediaImportHandler(mediaDir: string | (() => string), deps: MediaImportDeps = {}): JobHandler {
  return {
    async run(ctx, job) {
      const p = job.payload as unknown as ImportPayload
      const tok = ctx.db.select().from(agentTokens).where(eq(agentTokens.id, p.tokenId)).get()
      if (!tok || tok.status !== 'active' || (tok.expiresAt && Date.parse(tok.expiresAt) <= ctx.now().getTime())) return { skipped: 'The token is no longer active, so the import was cancelled.' }
      const owner = ctx.db.select().from(users).where(eq(users.id, tok.ownerUserId)).get()
      if (!owner || owner.status !== 'active') return { skipped: 'The token owner is no longer active, so the import was cancelled.' }
      const actor: ActingAs = { id: owner.id, role: owner.role, isOperator: owner.isOperator, agent: { tokenId: tok.id, tokenName: tok.name } }
      const allowPrivate = deps.allowPrivate ?? allowHttpEnv()
      let fetched: Awaited<ReturnType<typeof followSafely>>
      try {
        fetched = await followSafely(p.url, { fetch: deps.fetch ?? fetch, resolve: deps.resolve ?? defaultResolver, allowPrivate, headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml;q=0.8', 'user-agent': 'sitebuilder-media-import/1' } })
      } catch (e) {
        // A blocked or invalid destination will not get better by retrying. Network errors are retried by the queue.
        if (e instanceof BlockedDestination || e instanceof AppError) return { failed: e.message }
        throw e
      }
      const { res, finalUrl } = fetched
      if (res.status === 404 || res.status === 403 || res.status === 401 || res.status === 410) return { failed: `The address answered ${res.status}. Check it opens in a browser without signing in.` }
      if (!res.ok) throw new Error(`The address answered ${res.status}.`)
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (type && !type.startsWith('image/') && type !== 'application/octet-stream') return { failed: `That address is not a photo (it is ${type}). Give the address of the image file itself, not the page it is on.` }
      let data: Buffer
      try {
        data = await readCapped(res, MEDIA_MAX_BYTES)
      } catch (e) {
        return { failed: (e as Error).message }
      }
      try {
        const dir = typeof mediaDir === 'function' ? mediaDir() : mediaDir
        const up = await uploadMedia(ctx, actor, { filename: filenameFrom(finalUrl, p.filename), data, mediaDir: dir })
        if (up.media.kind === 'video') return { failed: 'That address is a video. Only photos can be imported by address.' }
        const needsAlt = !up.duplicate || (!up.media.alt && !up.media.decorative)
        if (needsAlt) updateMedia(ctx, actor, up.media.id, p.decorative ? { decorative: true, alt: null } : { alt: p.alt })
        audit(ctx, actor, 'agent.media.imported', { type: 'media', id: up.media.id }, { tokenId: tok.id, host: new URL(finalUrl).host, duplicate: up.duplicate })
        return { mediaId: up.media.id, duplicate: up.duplicate }
      } catch (e) {
        if (e instanceof AppError) return { failed: e.message }
        throw e
      }
    },
  }
}

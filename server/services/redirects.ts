// Redirects: manual ones from Settings > SEO and redirects, plus automatic ones from slug changes
// and unpublishing (added by the publish job). See docs/14-api.md#publishing-redirects-jobs.
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { newId } from '../../shared/ids'
import { zodIssues } from '../../shared/issues'
import { isSafeHref } from '../../shared/richtext'
import { can } from '../../shared/roles'
import { pages, redirects } from '../db/schema'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'

const PATH_RE = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)*$/

/** A site path like /about-us. No query string, no "..", no trailing slash (except "/"). */
export const sitePathSchema = z
  .string()
  .trim()
  .max(300)
  .transform((p) => (p.length > 1 ? p.replace(/\/+$/, '') : p))
  .refine((p) => PATH_RE.test(p) && !p.startsWith('//') && !p.split('/').includes('..'), 'Use a path on this site, starting with /, like /old-page.')

export const redirectInputSchema = z.object({
  fromPath: sitePathSchema,
  toPath: z.string().trim().max(500),
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
})

function normaliseTarget(to: string): string {
  if (to.startsWith('/')) {
    const p = sitePathSchema.safeParse(to)
    if (!p.success) throw new AppError('validation_failed', p.error.issues[0]!.message, [{ path: 'toPath', message: p.error.issues[0]!.message }])
    return p.data
  }
  let ok = false
  try {
    ok = isSafeHref(to) && new URL(to).protocol === 'https:'
  } catch {}
  if (!ok) throw new AppError('validation_failed', 'Redirect to a path on this site, or a full https:// address.', [{ path: 'toPath', message: 'Not a valid target.' }])
  return to
}

export function listRedirects(ctx: ServiceCtx) {
  return ctx.db.select().from(redirects).where(eq(redirects.siteId, ctx.siteId)).orderBy(asc(redirects.fromPath)).all()
}

export function createRedirect(ctx: ServiceCtx, actor: ActingAs, input: z.input<typeof redirectInputSchema>) {
  if (actor.aiSessionId || !can(actor, 'redirect.manage')) throw forbidden()
  const result = redirectInputSchema.safeParse(input)
  if (!result.success) throw new AppError('validation_failed', result.error.issues[0]!.message, zodIssues(result.error))
  const parsed = result.data
  const toPath = normaliseTarget(parsed.toPath)
  const fromPath = parsed.fromPath
  if (fromPath === '/') throw new AppError('validation_failed', "The home page can't be redirected.", [{ path: 'fromPath', message: "Can't redirect /." }])
  if (fromPath === toPath) throw new AppError('validation_failed', "A page can't redirect to itself.", [{ path: 'toPath', message: 'Same as the old address.' }])
  return inTx(ctx, () => {
    const live = ctx.db.select({ id: pages.id }).from(pages).where(and(eq(pages.siteId, ctx.siteId), eq(pages.publishedPath, fromPath), isNotNull(pages.publishedVersionId))).get()
    if (live) throw new AppError('validation_failed', 'A live page uses that address. Take it offline or move it first.', [{ path: 'fromPath', message: 'A live page uses this address.' }])
    if (ctx.db.select({ id: redirects.id }).from(redirects).where(and(eq(redirects.siteId, ctx.siteId), eq(redirects.fromPath, fromPath))).get()) {
      throw new AppError('validation_failed', 'There is already a redirect from that address. Delete it first.', [{ path: 'fromPath', message: 'Already redirected.' }])
    }
    // Refuse loops and long chains: follow the target through existing redirects.
    let next: string | undefined = toPath
    for (let hops = 0; next && next.startsWith('/'); hops++) {
      if (next === fromPath) throw new AppError('validation_failed', 'That would make a redirect loop.', [{ path: 'toPath', message: 'Leads back to the old address.' }])
      if (hops > 5) throw new AppError('validation_failed', 'That would make a long chain of redirects. Point it at the final page instead.', [{ path: 'toPath', message: 'Too many hops.' }])
      next = ctx.db.select({ to: redirects.toPath }).from(redirects).where(and(eq(redirects.siteId, ctx.siteId), eq(redirects.fromPath, next))).get()?.to
    }
    const id = newId('redirect', ctx.now().getTime())
    ctx.db.insert(redirects).values({ id, siteId: ctx.siteId, fromPath, toPath, statusCode: parsed.statusCode, source: 'manual', createdAt: iso(ctx) }).run()
    audit(ctx, actor, 'redirect.created', { type: 'redirect', id }, { fromPath, toPath, statusCode: parsed.statusCode })
    return { id, fromPath, toPath, statusCode: parsed.statusCode }
  })
}

export function deleteRedirect(ctx: ServiceCtx, actor: ActingAs, id: string) {
  if (actor.aiSessionId || !can(actor, 'redirect.manage')) throw forbidden()
  const row = ctx.db.select().from(redirects).where(and(eq(redirects.id, id), eq(redirects.siteId, ctx.siteId))).get()
  if (!row) throw notFound('That redirect')
  ctx.db.delete(redirects).where(eq(redirects.id, id)).run()
  audit(ctx, actor, 'redirect.deleted', { type: 'redirect', id }, { fromPath: row.fromPath, toPath: row.toPath })
}

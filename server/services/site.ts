// Site setup helpers (one site per install, ADR 0007), embeds and site parts.
import { and, eq, isNull } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { can } from '../../shared/roles'
import { embeds, siteParts, sites } from '../db/schema'
import { audit } from './audit'
import { iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden } from './errors'

export function createSite(ctx: Omit<ServiceCtx, 'siteId'>, input: { name: string; primaryDomain?: string; settings?: Record<string, unknown> }): string {
  const existing = ctx.db.select({ id: sites.id }).from(sites).get()
  if (existing) throw new Error('This install already has a site. v1 supports one site per install.')
  const id = newId('site', ctx.now().getTime())
  ctx.db.insert(sites).values({ id, name: input.name, primaryDomain: input.primaryDomain ?? null, settings: input.settings ?? {}, createdAt: ctx.now().toISOString() }).run()
  return id
}

export function getOnlySite(db: ServiceCtx['db']) {
  return db.select().from(sites).get()
}

export const EMBED_PROVIDERS: Record<string, { domains: string[]; configKeys: string[] }> = {
  virtuous: { domains: ['virtuoussoftware.com', 'virtuous.org'], configKeys: ['formId'] },
  youtube: { domains: ['youtube-nocookie.com'], configKeys: ['videoId'] },
  tally: { domains: ['tally.so'], configKeys: ['formId'] },
  google_forms: { domains: ['docs.google.com'], configKeys: ['formId'] },
}

export function listEmbeds(ctx: ServiceCtx) {
  return ctx.db.select().from(embeds).where(and(eq(embeds.siteId, ctx.siteId), isNull(embeds.archivedAt))).all()
}

export function createEmbed(ctx: ServiceCtx, actor: ActingAs, input: { provider: string; name: string; config: Record<string, string> }) {
  if (actor.aiSessionId || !can(actor, 'embed.manage')) throw forbidden()
  const provider = EMBED_PROVIDERS[input.provider]
  if (!provider) throw new AppError('validation_failed', `"${input.provider}" isn't a supported provider.`, [{ path: 'provider', message: 'Not supported.' }])
  const allowed = ((ctx.db.select({ s: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.s ?? {}) as { allowedEmbedProviders?: string[] }).allowedEmbedProviders
  if (allowed && !allowed.includes(input.provider)) throw forbidden('An admin needs to allow this provider in Settings > Security first.')
  for (const key of provider.configKeys) {
    const v = input.config[key]
    if (!v || !/^[A-Za-z0-9_-]{1,100}$/.test(v)) throw new AppError('validation_failed', `Add a valid ${key}.`, [{ path: `config.${key}`, message: 'Letters, numbers, dashes and underscores only.' }])
  }
  const id = newId('embed', ctx.now().getTime())
  const config = Object.fromEntries(provider.configKeys.map((k) => [k, input.config[k]!]))
  ctx.db.insert(embeds).values({ id, siteId: ctx.siteId, provider: input.provider, name: input.name.trim(), config, createdBy: actor.id, createdAt: iso(ctx) }).run()
  audit(ctx, actor, 'embed.created', { type: 'embed', id }, { provider: input.provider })
  return { id }
}

export function listSiteParts(ctx: ServiceCtx) {
  return ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all()
}

export function createSitePart(ctx: ServiceCtx, kind: 'header' | 'footer' | 'menu' | 'banner', key: string, label: string) {
  const id = newId('sitePart', ctx.now().getTime())
  ctx.db.insert(siteParts).values({ id, siteId: ctx.siteId, kind, key, label, createdAt: iso(ctx), updatedAt: iso(ctx) }).run()
  return id
}

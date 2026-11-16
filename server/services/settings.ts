// Site settings: read, change (admins), and which secrets are set (never their values).
import { eq } from 'drizzle-orm'
import { mergeSettings, readSettings, type SettingsPatch, type SiteSettings } from '../../shared/settings'
import { can } from '../../shared/roles'
import { secrets, sites } from '../db/schema'
import { audit } from './audit'
import { inTx, type ActingAs, type ServiceCtx } from './context'
import { forbidden } from './errors'
import { SECRET_NAMES } from './auth'

export function getSettings(ctx: ServiceCtx): { name: string; primaryDomain: string | null; settings: SiteSettings; secretsSet: Record<string, boolean> } {
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const set = new Set(ctx.db.select({ name: secrets.name }).from(secrets).where(eq(secrets.siteId, ctx.siteId)).all().map((s) => s.name))
  return { name: site.name, primaryDomain: site.primaryDomain, settings: readSettings(site.settings), secretsSet: Object.fromEntries(SECRET_NAMES.map((n) => [n, set.has(n)])) }
}

export function updateSettings(ctx: ServiceCtx, actor: ActingAs, patch: SettingsPatch) {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  return inTx(ctx, () => {
    const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
    const { name, primaryDomain, ...rest } = patch
    const before = readSettings(site.settings)
    const settings = mergeSettings(before, rest)
    ctx.db
      .update(sites)
      .set({ settings, ...(name !== undefined ? { name } : {}), ...(primaryDomain !== undefined ? { primaryDomain } : {}) })
      .where(eq(sites.id, ctx.siteId))
      .run()
    // Tag Manager can load any script, so its changes are called out in the audit log (ADR 0011).
    audit(ctx, actor, 'settings.updated', { type: 'site', id: ctx.siteId }, { changed: Object.keys(patch), gtmChanged: patch.tracking?.gtm !== undefined && patch.tracking.gtm !== before.tracking.gtm })
    return getSettings(ctx)
  })
}

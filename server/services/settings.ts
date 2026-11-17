// Site settings: read, change (admins), and which secrets are set (never their values).
import { eq } from 'drizzle-orm'
import { mergeSettings, readSettings, type SettingsPatch, type SiteSettings } from '../../shared/settings'
import { can } from '../../shared/roles'
import { secrets, sites } from '../db/schema'
import { audit } from './audit'
import { inTx, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden } from './errors'
import { sanitizeRobotsTxt } from '../../shared/robots'
import { USER_SECRET_NAMES } from './auth'
import { xaiOauthStatus } from './xai-oauth'

export function getSettings(ctx: ServiceCtx): {
  name: string
  primaryDomain: string | null
  settings: SiteSettings
  secretsSet: Record<string, boolean>
  mail: { transport: 'gmail' | 'outbox' | 'none'; googleConnected: boolean; googleAccount: string | null; from: string | null }
  xaiOauth: { enabled: boolean; connected: boolean; account: string | null }
} {
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const set = new Set(ctx.db.select({ name: secrets.name }).from(secrets).where(eq(secrets.siteId, ctx.siteId)).all().map((s) => s.name))
  const settings = readSettings(site.settings)
  const googleConnected = set.has('gmail_oauth')
  return {
    name: site.name,
    primaryDomain: site.primaryDomain,
    settings,
    secretsSet: Object.fromEntries(USER_SECRET_NAMES.map((n) => [n, set.has(n)])),
    mail: {
      transport: process.env.SITEBUILDER_MAIL_OUTBOX ? 'outbox' : googleConnected ? 'gmail' : process.env.NODE_ENV === 'production' ? 'none' : 'outbox',
      googleConnected,
      googleAccount: settings.mail.googleAccount,
      from: settings.mail.from ?? settings.mail.googleAccount,
    },
    xaiOauth: xaiOauthStatus(ctx),
  }
}

export function updateSettings(ctx: ServiceCtx, actor: ActingAs, patch: SettingsPatch) {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  return inTx(ctx, () => {
    const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
    const { name, primaryDomain, ...rest } = patch
    const before = readSettings(site.settings)
    if (rest.seo && 'robotsTxt' in rest.seo) {
      const raw = rest.seo.robotsTxt
      if (raw == null || !raw.trim()) {
        rest.seo = { ...rest.seo, robotsTxt: null }
      } else {
        const clean = sanitizeRobotsTxt(raw)
        if (!clean.ok) throw new AppError('validation_failed', clean.message, [{ path: 'seo.robotsTxt', message: clean.message }])
        rest.seo = { ...rest.seo, robotsTxt: clean.text }
      }
    }
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

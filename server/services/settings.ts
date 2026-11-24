// Site settings: read, change (admins), and which secrets are set (never their values).
import { and, eq, sql } from 'drizzle-orm'
import { mergeSettings, readSettings, type SettingsPatch, type SiteSettings } from '../../shared/settings'
import { can } from '../../shared/roles'
import { jobs, secrets, sites } from '../db/schema'
import { audit } from './audit'
import { inTx, type ActingAs, type ServiceCtx } from './context'
import { demoMode } from './demo-mode'
import { AppError, forbidden } from './errors'
import { sanitizeRobotsTxt } from '../../shared/robots'
import { USER_SECRET_NAMES } from './auth'
import { enqueueJob } from './jobs'
import { currentRelease } from './publish'
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
  if (demoMode()) {
    if (patch.primaryDomain !== undefined) throw new AppError('forbidden', 'The demo cannot change the public hostname.')
    if (patch.seo && ('allowIndexing' in patch.seo || 'robotsTxt' in patch.seo)) throw new AppError('forbidden', 'The demo cannot change indexing.')
    if (patch.mail) throw new AppError('forbidden', 'The demo cannot change mail settings.')
    if (patch.ai) throw new AppError('forbidden', 'The demo cannot change AI settings.')
  }
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
    const nextName = name !== undefined ? name : site.name
    const nextDomain = primaryDomain !== undefined ? primaryDomain : site.primaryDomain
    ctx.db
      .update(sites)
      .set({ settings, ...(name !== undefined ? { name } : {}), ...(primaryDomain !== undefined ? { primaryDomain } : {}) })
      .where(eq(sites.id, ctx.siteId))
      .run()
    const projectionChanged =
      renderProjection({ name: site.name, primaryDomain: site.primaryDomain, settings: before }) !==
      renderProjection({ name: nextName, primaryDomain: nextDomain, settings })
    // A running rebuild does not count: one more queued job reads the latest settings when it runs.
    const rebuilding = projectionChanged && currentRelease(ctx) ? queueSettingsRebuild(ctx, actor) : false
    // Tag Manager can load any script, so its changes are called out in the audit log (ADR 0011).
    audit(ctx, actor, 'settings.updated', { type: 'site', id: ctx.siteId }, { changed: Object.keys(patch), gtmChanged: patch.tracking?.gtm !== undefined && patch.tracking.gtm !== before.tracking.gtm })
    return { ...getSettings(ctx), rebuilding }
  })
}

/** What a public page, robots.txt, the sitemap, and analytics.js are built from. */
function renderProjection(input: { name: string; primaryDomain: string | null; settings: SiteSettings }): string {
  const { settings } = input
  return JSON.stringify({
    name: input.name,
    primaryDomain: input.primaryDomain,
    titlePattern: settings.titlePattern,
    allowIndexing: settings.seo.allowIndexing,
    robotsTxt: settings.seo.robotsTxt,
    defaultSocialImage: settings.seo.defaultSocialImage,
    tracking: {
      ga4: settings.tracking.ga4,
      gtm: settings.tracking.gtm,
      plausible: settings.tracking.plausible,
      cookiebot: settings.tracking.cookiebot,
    },
  })
}

/** Returns true only when this call inserted the job. An identical queued job is left as it is. */
function queueSettingsRebuild(ctx: ServiceCtx, actor: ActingAs): boolean {
  const queued = ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'publish'), eq(jobs.state, 'queued'), sql`json_extract(${jobs.payload}, '$.rebuild') = ${'settings'}`))
    .get()
  if (queued) return false
  enqueueJob(ctx, 'publish', { rebuild: 'settings' }, { createdBy: actor.id })
  return true
}

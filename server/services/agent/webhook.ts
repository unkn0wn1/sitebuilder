// Optional alert to an address the owner chooses (a chat webhook, an automation, a pager) when an agent publishes,
// asks for review, is blocked or is paused. See ADR 0018.
//
// Safety:
//   - HTTPS only, no credentials in the address, no private, loopback or link-local destinations (checked again at send
//     time against the resolved addresses, so a name that later points inside the network is refused).
//   - No redirects are followed. The reply body is never read or kept.
//   - The body is signed (HMAC-SHA256 over "<timestamp>.<body>") when a secret is set, so the receiver can check it.
//   - The body carries ids, names and short sentences. It never carries a token, a secret or page text beyond the change title.
//   - A failed delivery is retried by the job queue and never affects the change itself.
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { can } from '../../../shared/roles'
import { readSettings } from '../../../shared/settings'
import { sites } from '../../db/schema'
import { audit } from '../audit'
import { deleteSecret, getSecret, hasSecret, secretKeyFromEnv, setSecret } from '../auth'
import type { ActingAs, ServiceCtx } from '../context'
import { AppError, forbidden } from '../errors'
import { enqueueJob, type JobHandler } from '../jobs'
import { assertPublicDestination, checkPublicUrl, defaultResolver, type Resolver } from '../net-guard'

export const WEBHOOK_EVENTS = ['published', 'review_requested', 'blocked', 'token_paused'] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'test'

export const WEBHOOK_EVENT_LABELS: Record<(typeof WEBHOOK_EVENTS)[number], string> = {
  published: 'An agent published a change (by a rule, always-allow, or an admin undo)',
  review_requested: 'An agent sent a change to a person for approval',
  blocked: 'An agent tried something it may not do (a deny rule, the never-list, no permission)',
  token_paused: 'A token was paused automatically after repeated blocked attempts',
}

export interface WebhookPayload {
  event: WebhookEvent
  at: string
  site: string
  /** One plain sentence. Chat tools that read a "text" field show it as the message. */
  text: string
  token?: { id: string; name: string }
  change?: { id: string; title: string; status: string; preview_path: string }
  details?: Record<string, unknown>
}

// ---------------------------------------------------------------------------------------------------------------------
// Addresses

export { isPrivateAddress } from '../net-guard'

/** Checks the address the owner typed. Returns the cleaned URL. Throws validation_failed with a plain reason. */
export function checkWebhookUrl(raw: string, opts: { allowHttp?: boolean } = {}): string {
  return checkPublicUrl(raw, { allowHttp: opts.allowHttp ?? process.env.SITEBUILDER_AGENT_WEBHOOK_ALLOW_HTTP === '1', example: 'https://hooks.example.org/alerts', credentialsHint: ' Use the signing secret instead.' })
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings

export function webhookView(ctx: ServiceCtx) {
  const row = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  const w = readSettings(row?.settings).agent.webhook
  return { url: w.url, events: w.events, secretSet: hasSecret(ctx, 'agent_webhook'), allEvents: WEBHOOK_EVENTS.map((key) => ({ key, label: WEBHOOK_EVENT_LABELS[key] })) }
}

const configSchema = z.object({ url: z.string().max(500).nullable(), events: z.array(z.enum(WEBHOOK_EVENTS)).max(4), secret: z.string().min(8).max(200).nullable().optional() }).strict()

function requireManager(actor: ActingAs) {
  if (actor.agent) throw forbidden('A token cannot manage alerts.')
  if (!can(actor, 'settings.manage')) throw forbidden('Only admins can manage agent alerts.')
}

/** Save the alert address and events. `secret`: a string sets it, null removes it, leaving it out keeps it. */
export function setWebhook(ctx: ServiceCtx, actor: ActingAs, raw: unknown) {
  requireManager(actor)
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'Invalid alert settings.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const { events, secret } = parsed.data
  const url = parsed.data.url && parsed.data.url.trim() ? checkWebhookUrl(parsed.data.url) : null
  if (secret) {
    let key: Buffer
    try {
      key = secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY)
    } catch {
      throw new AppError('not_set_up', 'SITEBUILDER_SECRET_KEY is not set on the server, so the signing secret cannot be stored yet. Leave it empty to send unsigned alerts.')
    }
    setSecret(ctx, key, 'agent_webhook', secret, actor.id)
  } else if (secret === null || !url) deleteSecret(ctx, 'agent_webhook')
  const row = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  const current = readSettings(row?.settings)
  ctx.db.update(sites).set({ settings: { ...(row?.settings ?? {}), agent: { ...current.agent, webhook: { url, events: [...new Set(events)] } } } }).where(eq(sites.id, ctx.siteId)).run()
  audit(ctx, actor, 'agent.webhook.updated', { type: 'site', id: ctx.siteId }, { configured: !!url, host: url ? new URL(url).host : null, events, secretSet: hasSecret(ctx, 'agent_webhook') })
  return webhookView(ctx)
}

// ---------------------------------------------------------------------------------------------------------------------
// Sending

/** Queue an alert if one is set up for this event. Never throws: an alert must not stop the thing it reports. */
export function queueWebhook(ctx: ServiceCtx, event: Exclude<WebhookEvent, 'test'>, build: () => Omit<WebhookPayload, 'event' | 'at' | 'site'>) {
  try {
    const row = ctx.db.select({ settings: sites.settings, name: sites.name }).from(sites).where(eq(sites.id, ctx.siteId)).get()
    const w = readSettings(row?.settings).agent.webhook
    if (!w.url || !w.events.includes(event)) return
    const payload: WebhookPayload = { event, at: ctx.now().toISOString(), site: row?.name ?? '', ...build() }
    enqueueJob(ctx, 'agent_webhook', { payload: payload as unknown as Record<string, unknown> }, { maxAttempts: 4 })
  } catch {
    /* an alert is never worth failing the real work */
  }
}

/** Queue a test alert so the person can see it arrive. Goes through the same job and checks as a real one. */
export function queueTestWebhook(ctx: ServiceCtx, actor: ActingAs) {
  requireManager(actor)
  const w = webhookView(ctx)
  if (!w.url) throw new AppError('invalid_state', 'Set an alert address first.')
  const row = ctx.db.select({ name: sites.name }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  const payload: WebhookPayload = { event: 'test', at: ctx.now().toISOString(), site: row?.name ?? '', text: `Test alert from the ${row?.name ?? 'site'} builder. If you can read this, agent alerts reach you.` }
  const jobId = enqueueJob(ctx, 'agent_webhook', { payload: payload as unknown as Record<string, unknown> }, { maxAttempts: 1, createdBy: actor.id })
  audit(ctx, actor, 'agent.webhook.test', { type: 'site', id: ctx.siteId }, { host: new URL(w.url).host })
  return { queued: true, jobId }
}

export function signBody(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

export interface WebhookDeps {
  fetch?: typeof fetch
  resolve?: Resolver
  /** Tests only: allow private and http destinations. */
  allowPrivate?: boolean
}

export function createWebhookHandler(deps: WebhookDeps = {}): JobHandler {
  return {
    async run(ctx, job) {
      const w = webhookView(ctx)
      if (!w.url) return { skipped: 'No alert address is set.' }
      const payload = (job.payload as { payload?: WebhookPayload }).payload
      if (!payload) return { skipped: 'Nothing to send.' }
      if (payload.event !== 'test' && !w.events.includes(payload.event)) return { skipped: 'That alert was switched off.' }
      const allowPrivate = deps.allowPrivate ?? process.env.SITEBUILDER_AGENT_WEBHOOK_ALLOW_HTTP === '1'
      const url = checkWebhookUrl(w.url, { allowHttp: allowPrivate })
      await assertPublicDestination(url, deps.resolve ?? defaultResolver, allowPrivate)
      const body = JSON.stringify(payload)
      const timestamp = String(Math.floor(ctx.now().getTime() / 1000))
      const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'sitebuilder-agent-alerts/1', 'x-sitebuilder-event': payload.event, 'x-sitebuilder-delivery': job.id, 'x-sitebuilder-timestamp': timestamp }
      if (w.secretSet) {
        const secret = getSecret(ctx, secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY), 'agent_webhook')
        if (secret) headers['x-sitebuilder-signature'] = signBody(secret, timestamp, body)
      }
      const res = await (deps.fetch ?? fetch)(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(5000) })
      if (res.status >= 300 && res.status < 400) throw new Error(`The alert address answered with a redirect (${res.status}). Redirects are not followed. Use the final address.`)
      if (!res.ok) throw new Error(`The alert address answered ${res.status}.`)
      return { delivered: true, status: res.status }
    },
  }
}

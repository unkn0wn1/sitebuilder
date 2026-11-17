// Email job handler. Builds the message for each kind and hands it to a mail transport.
// Invite and reset links are minted here, at send time, so raw tokens never sit in the job queue.
// v1 transport is Google Workspace via the Gmail API (ADR 0015). The Mailer interface is the seam
// for a later SMTP or Postmark adapter. A file outbox is used for development and tests.
// See docs/16-operations.md#email.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { can } from '../../shared/roles'
import { users } from '../db/schema'
import { createAuthToken } from './auth'
import type { ActingAs, ServiceCtx } from './context'
import { AppError, forbidden } from './errors'
import { gmailMailer } from './gmail'
import type { JobHandler } from './jobs'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  from?: string
}

/** The mail-transport seam. Gmail is the v1 implementation; SMTP or Postmark can be plugged in later. */
export interface Mailer {
  send(message: EmailMessage): Promise<void> | void
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000
export const RESET_TTL_MS = 60 * 60_000

/** Writes each message as a JSON file. For development and tests only. */
export function outboxMailer(dir: string): Mailer {
  mkdirSync(dir, { recursive: true })
  let n = 0
  return {
    send(message) {
      writeFileSync(join(dir, `${Date.now()}-${process.pid}-${n++}.json`), JSON.stringify(message, null, 2))
    },
  }
}

export function defaultOutboxDir(): string {
  return process.env.SITEBUILDER_MAIL_OUTBOX || join('.data', 'outbox')
}

/**
 * Pick the transport for this process and site.
 * SITEBUILDER_MAIL_OUTBOX always wins (tests and local debugging).
 * Otherwise a connected Google Workspace account is used.
 * In development, a file outbox is the fallback when Google is not connected.
 */
export function resolveMailer(ctx: ServiceCtx): Mailer | null {
  if (process.env.SITEBUILDER_MAIL_OUTBOX) return outboxMailer(process.env.SITEBUILDER_MAIL_OUTBOX)
  const gmail = gmailMailer(ctx)
  if (gmail) return gmail
  if (process.env.NODE_ENV !== 'production') return outboxMailer(defaultOutboxDir())
  return null
}

interface EmailPayload {
  kind: string
  userId: string
  message?: string
}

export function buildEmail(ctx: ServiceCtx, payload: EmailPayload, baseUrl: string): EmailMessage | null {
  const user = ctx.db.select().from(users).where(eq(users.id, payload.userId)).get()
  if (!user || user.status === 'deactivated') return null
  switch (payload.kind) {
    case 'invite': {
      if (user.status !== 'invited') return null
      const token = createAuthToken(ctx, user.id, 'invite', INVITE_TTL_MS)
      return {
        to: user.email,
        subject: "You've been invited to edit the website",
        text: `Hello ${user.name},\n\nYou've been invited to help edit the website. Choose a password here (the link works for 7 days):\n\n${baseUrl}/invite#token=${token}\n\nIf you weren't expecting this, you can ignore this email.`,
      }
    }
    case 'reset': {
      if (user.status !== 'active') return null
      const token = createAuthToken(ctx, user.id, 'reset', RESET_TTL_MS)
      return {
        to: user.email,
        subject: 'Reset your password',
        text: `Hello ${user.name},\n\nSomeone asked to reset your password. If it was you, choose a new one here (the link works for 1 hour):\n\n${baseUrl}/reset-password#token=${token}\n\nIf it wasn't you, ignore this email. Your password has not changed.`,
      }
    }
    case 'test':
      return {
        to: payload.message || user.email,
        subject: 'Test email from the website builder',
        text: `Hello,\n\nThis is a test from the website builder. If you received it, sending is working.\n\n${baseUrl}`,
      }
    default:
      if (user.status !== 'active' || !payload.message) return null
      return { to: user.email, subject: payload.message.slice(0, 120), text: `${payload.message}\n\n${baseUrl}` }
  }
}

export function createEmailHandler(opts: { mailer?: Mailer | null; getMailer?: (ctx: ServiceCtx) => Mailer | null; baseUrl: string }): JobHandler {
  return {
    async run(ctx, job) {
      const mailer = opts.getMailer ? opts.getMailer(ctx) : (opts.mailer ?? null)
      if (!mailer) return { skipped: 'Email sending is not set up yet.' }
      const message = buildEmail(ctx, job.payload as unknown as EmailPayload, opts.baseUrl)
      if (!message) return { skipped: 'Nothing to send.' }
      await mailer.send(message)
      return { sent: true }
    },
  }
}

/** Send a test message now, through the same transport the jobs use, so Settings can confirm it works. */
export async function sendTestEmail(ctx: ServiceCtx, actor: ActingAs, to?: string) {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  const mailer = resolveMailer(ctx)
  if (!mailer) throw new AppError('not_set_up', 'Connect Google Workspace in Settings before sending a test email.')
  const address = (to ?? actorEmail(ctx, actor)).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('validation_failed', 'Use a full email address.', [{ path: 'to', message: 'Not a valid email address.' }])
  const message = buildEmail(ctx, { kind: 'test', userId: actor.id, message: address }, process.env.SITEBUILDER_ORIGIN ?? 'http://localhost:3000')
  if (!message) throw new AppError('invalid_state', "We couldn't build a test email for you.")
  await mailer.send(message)
  return { sent: true, to: message.to }
}

function actorEmail(ctx: ServiceCtx, actor: ActingAs): string {
  const user = ctx.db.select({ email: users.email }).from(users).where(eq(users.id, actor.id)).get()
  if (!user) throw new AppError('not_found', "Your user wasn't found.")
  return user.email
}

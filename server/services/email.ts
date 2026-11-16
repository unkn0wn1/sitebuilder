// Email job handler. Builds the message for each kind and hands it to a Mailer.
// Invite and reset links are minted here, at send time, so raw tokens never sit in the job queue.
// SMTP sending is not built yet (docs/09-roadmap.md, M2). Until then, a file outbox is used for
// development and tests, and production skips sending. See docs/16-operations.md#email.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema'
import { createAuthToken } from './auth'
import type { ServiceCtx } from './context'
import type { JobHandler } from './jobs'

export interface EmailMessage {
  to: string
  subject: string
  text: string
}

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
    default:
      if (user.status !== 'active' || !payload.message) return null
      return { to: user.email, subject: payload.message.slice(0, 120), text: `${payload.message}\n\n${baseUrl}` }
  }
}

export function createEmailHandler(opts: { mailer: Mailer | null; baseUrl: string }): JobHandler {
  return {
    async run(ctx, job) {
      if (!opts.mailer) return { skipped: 'Email sending is not set up yet.' }
      const message = buildEmail(ctx, job.payload as unknown as EmailPayload, opts.baseUrl)
      if (!message) return { skipped: 'Nothing to send.' }
      await opts.mailer.send(message)
      return { sent: true }
    },
  }
}

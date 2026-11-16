// Users, passwords and sessions. See docs/15-security.md#the-builder.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { newId } from '../../shared/ids'
import type { Role } from '../../shared/roles'
import { authTokens, secrets, sessions, users } from '../db/schema'
import { AppError } from './errors'
import { inTx, iso, type ServiceCtx } from './context'

// Passwords: scrypt from Node's crypto, no native add-on.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
const COMMON = new Set(['password1234', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'administrator', 'changeme1234', 'letmein12345', 'welcome12345'])

export const passwordSchema = z
  .string()
  .min(12, { message: 'Use at least 12 characters.' })
  .max(200)
  .refine((p) => !COMMON.has(p.toLowerCase()), { message: 'That password is too common. Pick another.' })

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const DUMMY_HASH = hashPassword('not-a-real-password-just-for-timing')

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// Sessions
export const SESSION_IDLE_MS = 12 * 60 * 60_000
export const SESSION_MAX_MS = 14 * 24 * 60 * 60_000

export type User = typeof users.$inferSelect

export function createUser(
  ctx: ServiceCtx,
  input: { email: string; name: string; role: Role; isOperator?: boolean; password?: string },
): { user: User; inviteToken?: string } {
  const email = input.email.trim().toLowerCase()
  const existing = ctx.db.select().from(users).where(and(eq(users.siteId, ctx.siteId), eq(users.email, email))).get()
  if (existing) throw new AppError('validation_failed', 'Someone with that email is already a user.', [{ path: 'email', message: 'Already in use.' }])
  if (input.password !== undefined) {
    const check = passwordSchema.safeParse(input.password)
    if (!check.success) throw new AppError('validation_failed', check.error.issues[0]!.message, [{ path: 'password', message: check.error.issues[0]!.message }])
  }
  const user: User = {
    id: newId('user', ctx.now().getTime()),
    siteId: ctx.siteId,
    email,
    name: input.name.trim(),
    role: input.role,
    isOperator: input.isOperator ?? false,
    status: input.password ? 'active' : 'invited',
    passwordHash: input.password ? hashPassword(input.password) : null,
    createdAt: iso(ctx),
    lastLoginAt: null,
  }
  ctx.db.insert(users).values(user).run()
  const inviteToken = input.password ? undefined : createAuthToken(ctx, user.id, 'invite', 7 * 24 * 60 * 60_000)
  return { user, inviteToken }
}

export function createAuthToken(ctx: ServiceCtx, userId: string, purpose: 'invite' | 'reset', ttlMs: number): string {
  const raw = randomBytes(32).toString('base64url')
  ctx.db
    .insert(authTokens)
    .values({ id: sha256(raw), siteId: ctx.siteId, userId, purpose, createdAt: iso(ctx), expiresAt: new Date(ctx.now().getTime() + ttlMs).toISOString() })
    .run()
  return raw
}

function useAuthToken(ctx: ServiceCtx, raw: string, purpose: 'invite' | 'reset') {
  const token = ctx.db.select().from(authTokens).where(and(eq(authTokens.id, sha256(raw)), eq(authTokens.siteId, ctx.siteId))).get()
  if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt < iso(ctx)) {
    throw new AppError('validation_failed', 'This link has expired or was already used. Ask for a new one.')
  }
  ctx.db.update(authTokens).set({ usedAt: iso(ctx) }).where(eq(authTokens.id, token.id)).run()
  return token
}

export function acceptInvite(ctx: ServiceCtx, raw: string, name: string, password: string): User {
  const check = passwordSchema.safeParse(password)
  if (!check.success) throw new AppError('validation_failed', check.error.issues[0]!.message, [{ path: 'password', message: check.error.issues[0]!.message }])
  return inTx(ctx, () => {
    const token = useAuthToken(ctx, raw, 'invite')
    ctx.db.update(users).set({ name: name.trim(), status: 'active', passwordHash: hashPassword(password) }).where(eq(users.id, token.userId)).run()
    return ctx.db.select().from(users).where(eq(users.id, token.userId)).get()!
  })
}

export function resetPassword(ctx: ServiceCtx, raw: string, password: string): void {
  const check = passwordSchema.safeParse(password)
  if (!check.success) throw new AppError('validation_failed', check.error.issues[0]!.message, [{ path: 'password', message: check.error.issues[0]!.message }])
  inTx(ctx, () => {
    const token = useAuthToken(ctx, raw, 'reset')
    ctx.db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, token.userId)).run()
    revokeAllSessions(ctx, token.userId)
  })
}

/** Returns the user on success. Always does the same amount of hashing work. */
export function checkLogin(ctx: ServiceCtx, email: string, password: string): User | null {
  const user = ctx.db.select().from(users).where(and(eq(users.siteId, ctx.siteId), eq(users.email, email.trim().toLowerCase()))).get()
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok || user.status !== 'active') return null
  ctx.db.update(users).set({ lastLoginAt: iso(ctx) }).where(eq(users.id, user.id)).run()
  return user
}

export function createSession(ctx: ServiceCtx, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(ctx.now().getTime() + SESSION_MAX_MS).toISOString()
  ctx.db.insert(sessions).values({ id: sha256(token), siteId: ctx.siteId, userId, createdAt: iso(ctx), lastSeenAt: iso(ctx), expiresAt }).run()
  return { token, expiresAt }
}

export function getSessionUser(ctx: ServiceCtx, token: string | undefined): User | null {
  if (!token) return null
  const row = ctx.db.select().from(sessions).where(and(eq(sessions.id, sha256(token)), eq(sessions.siteId, ctx.siteId))).get()
  if (!row) return null
  const now = ctx.now().getTime()
  if (Date.parse(row.expiresAt) <= now || now - Date.parse(row.lastSeenAt) > SESSION_IDLE_MS) {
    ctx.db.delete(sessions).where(eq(sessions.id, row.id)).run()
    return null
  }
  const user = ctx.db.select().from(users).where(eq(users.id, row.userId)).get()
  if (!user || user.status !== 'active') return null
  if (now - Date.parse(row.lastSeenAt) > 5 * 60_000) ctx.db.update(sessions).set({ lastSeenAt: iso(ctx) }).where(eq(sessions.id, row.id)).run()
  return user
}

export function revokeSession(ctx: ServiceCtx, token: string) {
  ctx.db.delete(sessions).where(eq(sessions.id, sha256(token))).run()
}

export function revokeAllSessions(ctx: ServiceCtx, userId: string) {
  ctx.db.delete(sessions).where(eq(sessions.userId, userId)).run()
}

// Secrets: AES-256-GCM with SITEBUILDER_SECRET_KEY (32 bytes, base64). See docs/15-security.md#secrets.

export function secretKeyFromEnv(value: string | undefined): Buffer {
  if (!value) throw new AppError('not_set_up', 'SITEBUILDER_SECRET_KEY is not set on the server.')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new AppError('not_set_up', 'SITEBUILDER_SECRET_KEY must be 32 bytes, base64 encoded.')
  return key
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

export function decryptSecret(key: Buffer, stored: string): string {
  const raw = Buffer.from(stored, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

export const SECRET_NAMES = ['ai_api_key', 'cloudflare_token', 'smtp_password'] as const

export function setSecret(ctx: ServiceCtx, key: Buffer, name: (typeof SECRET_NAMES)[number], value: string, userId: string) {
  const ciphertext = encryptSecret(key, value)
  const existing = ctx.db.select().from(secrets).where(and(eq(secrets.siteId, ctx.siteId), eq(secrets.name, name))).get()
  if (existing) ctx.db.update(secrets).set({ ciphertext, updatedBy: userId, updatedAt: iso(ctx) }).where(eq(secrets.id, existing.id)).run()
  else ctx.db.insert(secrets).values({ id: newId('secret', ctx.now().getTime()), siteId: ctx.siteId, name, ciphertext, updatedBy: userId, updatedAt: iso(ctx) }).run()
}

export function getSecret(ctx: ServiceCtx, key: Buffer, name: (typeof SECRET_NAMES)[number]): string | null {
  const row = ctx.db.select().from(secrets).where(and(eq(secrets.siteId, ctx.siteId), eq(secrets.name, name))).get()
  return row ? decryptSecret(key, row.ciphertext) : null
}

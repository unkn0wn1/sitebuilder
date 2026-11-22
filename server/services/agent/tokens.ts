// Agent tokens: create, list, change, revoke, and sign in with one. The secret is shown once and stored only as a hash.
// A token belongs to the admin who made it and can never do more than they can. See ADR 0018.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AGENT_RULES_MAX_CHARS } from '../../../shared/agent/context-budget'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ALWAYS_ALLOW_MAX_DAYS, normaliseRules, type AgentRule } from '../../../shared/agent/rules'
import { newId } from '../../../shared/ids'
import { can } from '../../../shared/roles'
import { agentTokens, sites, users } from '../../db/schema'
import { audit } from '../audit'
import { sha256, verifyPassword } from '../auth'
import { iso, type ActingAs, type ServiceCtx } from '../context'
import { AppError, forbidden, notFound } from '../errors'
import { readSettings } from '../../../shared/settings'

export type AgentTokenRow = typeof agentTokens.$inferSelect

export const TOKEN_PREFIX = 'sbt_'

export interface RateLimits {
  readPerMinute: number
  writePerMinute: number
  publishPerHour: number
  publishPerDay: number
}

export const DEFAULT_LIMITS: RateLimits = { readPerMinute: 120, writePerMinute: 30, publishPerHour: 10, publishPerDay: 30 }

export const limitsSchema = z
  .object({
    readPerMinute: z.number().int().min(1).max(6000),
    writePerMinute: z.number().int().min(1).max(600),
    publishPerHour: z.number().int().min(1).max(600),
    publishPerDay: z.number().int().min(1).max(5000),
  })
  .partial()
  .strict()

export const tokenInputSchema = z
  .object({
    name: z.string().trim().min(1, { message: 'Give the token a name, for example "Claude Code, privacy policy".' }).max(80),
    access: z.enum(['read', 'draft']).default('draft'),
    rules: z.array(z.unknown()).max(50).default([]),
    expiresAt: z.iso.datetime().nullable().optional(),
    ipAllow: z.array(z.string().trim().min(1).max(64)).max(20).nullable().optional(),
    limits: limitsSchema.optional(),
  })
  .strict()

export const tokenPatchSchema = tokenInputSchema.partial().extend({ status: z.enum(['active', 'paused']).optional() }).strict()

export type TokenInput = z.input<typeof tokenInputSchema>
export type TokenPatch = z.input<typeof tokenPatchSchema>

export function effectiveLimits(token: Pick<AgentTokenRow, 'limits'>): RateLimits {
  return { ...DEFAULT_LIMITS, ...(token.limits ?? {}) }
}

export function tokenRules(token: Pick<AgentTokenRow, 'rules'>): AgentRule[] {
  const r = normaliseRules(token.rules)
  return r.ok ? r.rules : []
}

/** Is always-allow switched on right now (permanent, or timed and not yet ended)? */
export function alwaysAllowActive(token: Pick<AgentTokenRow, 'alwaysAllowUntil' | 'alwaysAllowPermanent'>, now: Date): boolean {
  if (token.alwaysAllowPermanent) return true
  return !!token.alwaysAllowUntil && Date.parse(token.alwaysAllowUntil) > now.getTime()
}

/** The always-allow state a person or the AI sees: null when off, otherwise permanent or the end time. */
export function alwaysAllowView(token: Pick<AgentTokenRow, 'alwaysAllowUntil' | 'alwaysAllowPermanent'>, now: Date): { permanent: boolean; until: string | null } | null {
  if (!alwaysAllowActive(token, now)) return null
  return token.alwaysAllowPermanent ? { permanent: true, until: null } : { permanent: false, until: token.alwaysAllowUntil }
}

/** What a person (or the AI) may see about a token. Never the hash. */
export function tokenSummary(token: AgentTokenRow, now: Date) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    access: token.access,
    status: token.status,
    pausedReason: token.pausedReason,
    rules: tokenRules(token),
    alwaysAllow: alwaysAllowView(token, now),
    limits: effectiveLimits(token),
    ipAllow: token.ipAllow ?? null,
    expiresAt: token.expiresAt,
    ownerUserId: token.ownerUserId,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    lastUsedIp: token.lastUsedIp,
    revokedAt: token.revokedAt,
  }
}

function requireManager(actor: ActingAs) {
  if (actor.agent) throw forbidden('A token cannot manage tokens.')
  if (!can(actor, 'settings.manage')) throw forbidden('Only admins can manage agent tokens.')
}

function checkIpList(list: string[] | null | undefined) {
  for (const entry of list ?? []) if (!parseIpEntry(entry)) throw new AppError('validation_failed', `"${entry}" is not an IP address or an IPv4 range like 203.0.113.0/24.`, [{ path: 'ipAllow', message: 'Not an IP address or range.' }])
}

function parseRules(raw: unknown[]): AgentRule[] {
  const r = normaliseRules(raw)
  if (!r.ok) throw new AppError('validation_failed', r.message, [{ path: 'rules', message: r.message }])
  // Every agent loads its rules (get_site), so they must fit the agent context budget (shared/agent/context-budget.ts).
  if (JSON.stringify(r.rules).length > AGENT_RULES_MAX_CHARS) {
    const message = `These rules are too long for an AI to load (over ${AGENT_RULES_MAX_CHARS.toLocaleString('en-GB')} characters). Use fewer rules, or shorter lists of addresses and domains.`
    throw new AppError('validation_failed', message, [{ path: 'rules', message }])
  }
  return r.rules
}

export function createAgentToken(ctx: ServiceCtx, actor: ActingAs, raw: TokenInput) {
  requireManager(actor)
  const parsed = tokenInputSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'Invalid token settings.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const input = parsed.data
  const rules = parseRules(input.rules)
  checkIpList(input.ipAllow)
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const id = newId('agentToken', ctx.now().getTime())
  ctx.db
    .insert(agentTokens)
    .values({
      id,
      siteId: ctx.siteId,
      ownerUserId: actor.id,
      name: input.name,
      secretHash: sha256(secret),
      prefix: secret.slice(0, TOKEN_PREFIX.length + 4),
      access: input.access,
      rules,
      limits: input.limits ?? null,
      ipAllow: input.ipAllow ?? null,
      status: 'active',
      expiresAt: input.expiresAt ?? null,
      createdAt: iso(ctx),
      createdBy: actor.id,
    })
    .run()
  audit(ctx, actor, 'agent.token.created', { type: 'agent_token', id }, { name: input.name, access: input.access, rules: rules.length })
  return { token: tokenSummary(requireAgentToken(ctx, id), ctx.now()), secret }
}

export function requireAgentToken(ctx: ServiceCtx, id: string): AgentTokenRow {
  const row = ctx.db.select().from(agentTokens).where(and(eq(agentTokens.id, id), eq(agentTokens.siteId, ctx.siteId))).get()
  if (!row) throw notFound('That token')
  return row
}

export function listAgentTokens(ctx: ServiceCtx, actor: ActingAs) {
  requireManager(actor)
  return ctx.db.select().from(agentTokens).where(eq(agentTokens.siteId, ctx.siteId)).orderBy(desc(agentTokens.createdAt)).all().map((t) => tokenSummary(t, ctx.now()))
}

export function updateAgentToken(ctx: ServiceCtx, actor: ActingAs, id: string, raw: TokenPatch) {
  requireManager(actor)
  const parsed = tokenPatchSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'Invalid token settings.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const patch = parsed.data
  const token = requireAgentToken(ctx, id)
  if (token.status === 'revoked') throw new AppError('invalid_state', 'This token was revoked. Make a new one.')
  const set: Partial<typeof agentTokens.$inferInsert> = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.access !== undefined) set.access = patch.access
  if (patch.rules !== undefined) set.rules = parseRules(patch.rules)
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt
  if (patch.ipAllow !== undefined) {
    checkIpList(patch.ipAllow)
    set.ipAllow = patch.ipAllow
  }
  if (patch.limits !== undefined) set.limits = patch.limits as Record<string, number>
  if (patch.status !== undefined) {
    set.status = patch.status
    set.pausedReason = patch.status === 'paused' ? `Paused by an admin at ${iso(ctx)}.` : null
  }
  ctx.db.update(agentTokens).set(set).where(eq(agentTokens.id, id)).run()
  audit(ctx, actor, 'agent.token.updated', { type: 'agent_token', id }, { fields: Object.keys(patch) })
  return tokenSummary(requireAgentToken(ctx, id), ctx.now())
}

export function revokeAgentToken(ctx: ServiceCtx, actor: ActingAs, id: string) {
  requireManager(actor)
  const token = requireAgentToken(ctx, id)
  if (token.status === 'revoked') return tokenSummary(token, ctx.now())
  ctx.db.update(agentTokens).set({ status: 'revoked', revokedAt: iso(ctx), alwaysAllowUntil: null, alwaysAllowPermanent: false }).where(eq(agentTokens.id, id)).run()
  audit(ctx, actor, 'agent.token.revoked', { type: 'agent_token', id }, { name: token.name })
  return tokenSummary(requireAgentToken(ctx, id), ctx.now())
}

/**
 * Switch always-allow on for a token: for 1 to 7 days (`days`), or with no end date (`permanent: true`). Exactly one of
 * the two. Either way it needs the site name typed out and the admin's password, because it lets the token publish
 * anything that is not on the never-list or the floor. Switching it on again replaces the earlier setting.
 * Permanent stays until someone switches it off or the token is revoked, and every switch is in the audit log.
 */
export function enableAlwaysAllow(ctx: ServiceCtx, actor: ActingAs, id: string, input: { days?: number; permanent?: boolean; siteName: string; password: string }) {
  requireManager(actor)
  const permanent = input.permanent === true
  if (permanent === (input.days !== undefined)) throw new AppError('validation_failed', 'Choose how long: give "days" (1 to 7) or "permanent": true, not both and not neither.', [{ path: permanent ? 'days' : 'permanent', message: 'Give exactly one of days or permanent.' }])
  const days = Math.floor(input.days ?? 0)
  if (!permanent && !(days >= 1 && days <= ALWAYS_ALLOW_MAX_DAYS)) throw new AppError('validation_failed', `Timed always-allow can last 1 to ${ALWAYS_ALLOW_MAX_DAYS} days. For no end date, use permanent.`, [{ path: 'days', message: `1 to ${ALWAYS_ALLOW_MAX_DAYS}.` }])
  const site = ctx.db.select({ name: sites.name }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  if (!site || input.siteName.trim() !== site.name) throw new AppError('validation_failed', 'Type the site name exactly to switch this on.', [{ path: 'siteName', message: 'Does not match the site name.' }])
  const user = ctx.db.select().from(users).where(eq(users.id, actor.id)).get()
  if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) throw new AppError('forbidden', 'That password is not right.')
  const token = requireAgentToken(ctx, id)
  if (token.status !== 'active') throw new AppError('invalid_state', 'Only an active token can have always-allow.')
  const until = permanent ? null : new Date(ctx.now().getTime() + days * 24 * 3600_000).toISOString()
  ctx.db.update(agentTokens).set({ alwaysAllowUntil: until, alwaysAllowPermanent: permanent }).where(eq(agentTokens.id, id)).run()
  audit(ctx, actor, 'agent.token.always_allow_on', { type: 'agent_token', id }, { permanent, until, name: token.name })
  return tokenSummary(requireAgentToken(ctx, id), ctx.now())
}

export function disableAlwaysAllow(ctx: ServiceCtx, actor: ActingAs, id: string) {
  requireManager(actor)
  const token = requireAgentToken(ctx, id)
  ctx.db.update(agentTokens).set({ alwaysAllowUntil: null, alwaysAllowPermanent: false }).where(eq(agentTokens.id, id)).run()
  audit(ctx, actor, 'agent.token.always_allow_off', { type: 'agent_token', id }, { wasPermanent: token.alwaysAllowPermanent, name: token.name })
  return tokenSummary(requireAgentToken(ctx, id), ctx.now())
}

export function setAgentsPaused(ctx: ServiceCtx, actor: ActingAs, paused: boolean) {
  requireManager(actor)
  const row = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  const current = readSettings(row?.settings)
  ctx.db.update(sites).set({ settings: { ...(row?.settings ?? {}), agent: { ...current.agent, paused } } }).where(eq(sites.id, ctx.siteId)).run()
  audit(ctx, actor, paused ? 'agent.paused_all' : 'agent.resumed_all', { type: 'site', id: ctx.siteId })
  return { paused }
}

export function agentsPaused(ctx: ServiceCtx): boolean {
  return readSettings(ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.settings).agent.paused
}

// ---------------------------------------------------------------------------------------------------------------------
// Sign in with a token

interface IpEntry {
  exact?: string
  cidr?: { base: number; bits: number }
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((n) => n > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function parseIpEntry(entry: string): IpEntry | null {
  const v = entry.trim().toLowerCase()
  const slash = v.indexOf('/')
  if (slash >= 0) {
    const base = ipv4ToInt(v.slice(0, slash))
    const bits = Number(v.slice(slash + 1))
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null
    return { cidr: { base, bits } }
  }
  if (ipv4ToInt(v) !== null || /^[0-9a-f:]+$/.test(v) && v.includes(':')) return { exact: v }
  return null
}

/** True if the address is on the list. An empty or missing list allows everything. IPv6 is matched exactly. */
export function ipAllowed(ip: string | null, list: string[] | null | undefined): boolean {
  if (!list?.length) return true
  if (!ip) return false
  const addr = ip.trim().toLowerCase().replace(/^::ffff:/, '')
  const asInt = ipv4ToInt(addr)
  return list.some((entry) => {
    const e = parseIpEntry(entry)
    if (!e) return false
    if (e.exact) return e.exact === addr
    if (asInt === null || !e.cidr) return false
    const mask = e.cidr.bits === 0 ? 0 : (~0 << (32 - e.cidr.bits)) >>> 0
    return (asInt & mask) === (e.cidr.base & mask)
  })
}

export interface SignedInAgent {
  token: AgentTokenRow
  actor: ActingAs
}

const INVALID = 'That token is not valid. It may be wrong, expired or revoked.'

/** Resolve a bearer secret to a token and the person it acts as. Throws a 401 or 403 AppError. */
export function authenticateAgent(ctx: ServiceCtx, secret: string | null, ip: string | null): SignedInAgent {
  if (!secret || !secret.startsWith(TOKEN_PREFIX) || secret.length > 200) throw new AppError('unauthenticated', INVALID)
  const hash = sha256(secret)
  const token = ctx.db.select().from(agentTokens).where(and(eq(agentTokens.secretHash, hash), eq(agentTokens.siteId, ctx.siteId))).get()
  // The lookup is by hash, so there is nothing secret left to compare, but keep the check constant-time anyway.
  if (!token || !timingSafeEqual(Buffer.from(token.secretHash), Buffer.from(hash))) throw new AppError('unauthenticated', INVALID)
  if (token.status === 'revoked') throw new AppError('unauthenticated', INVALID)
  if (token.expiresAt && Date.parse(token.expiresAt) <= ctx.now().getTime()) throw new AppError('unauthenticated', INVALID)
  if (!ipAllowed(ip, token.ipAllow)) throw new AppError('forbidden', 'This token cannot be used from this address.')
  if (agentsPaused(ctx)) throw new AppError('agent_paused', 'An admin has paused all agent access to this site.')
  if (token.status === 'paused') throw new AppError('agent_paused', token.pausedReason ?? 'This token is paused. Ask the site owner to resume it.')
  const owner = ctx.db.select().from(users).where(eq(users.id, token.ownerUserId)).get()
  if (!owner || owner.status !== 'active') throw new AppError('unauthenticated', INVALID)
  const last = token.lastUsedAt ? Date.parse(token.lastUsedAt) : 0
  if (ctx.now().getTime() - last > 60_000 || token.lastUsedIp !== ip) ctx.db.update(agentTokens).set({ lastUsedAt: iso(ctx), lastUsedIp: ip }).where(eq(agentTokens.id, token.id)).run()
  return { token, actor: { id: owner.id, role: owner.role, isOperator: owner.isOperator, agent: { tokenId: token.id, tokenName: token.name } } }
}

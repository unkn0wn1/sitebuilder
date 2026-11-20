// Per-token rate limits and the automatic pause. Kept in SQLite so a restart does not reset them. See ADR 0018.
import { and, count, eq, gte, lt } from 'drizzle-orm'
import { agentCalls, agentTokens, users } from '../../db/schema'
import { audit } from '../audit'
import { iso, type ServiceCtx } from '../context'
import { AppError } from '../errors'
import { notify, usersWithRoles } from '../notify'
import { effectiveLimits, type AgentTokenRow } from './tokens'

export type CallKind = 'read' | 'write' | 'publish'

/** Three rule violations inside ten minutes pause the token. */
export const VIOLATION_LIMIT = 3
export const VIOLATION_WINDOW_MS = 10 * 60_000
const KEEP_MS = 2 * 24 * 3600_000

function since(ctx: ServiceCtx, tokenId: string, kind: CallKind | 'violation', windowMs: number): number {
  const from = new Date(ctx.now().getTime() - windowMs).toISOString()
  return ctx.db.select({ n: count() }).from(agentCalls).where(and(eq(agentCalls.tokenId, tokenId), eq(agentCalls.kind, kind), gte(agentCalls.at, from))).get()?.n ?? 0
}

function rateLimited(what: string, retryAfterSeconds: number): AppError {
  return new AppError('rate_limited', `This token has used up its ${what}. Wait ${retryAfterSeconds} seconds and try again, or ask the site owner to raise the limit.`, undefined, { retryAfterSeconds })
}

/** Count a call, or throw `rate_limited`. Publishes are checked before they happen and recorded when they do. */
export function takeCall(ctx: ServiceCtx, token: AgentTokenRow, kind: CallKind): void {
  const limits = effectiveLimits(token)
  if (kind === 'read' && since(ctx, token.id, 'read', 60_000) >= limits.readPerMinute) throw rateLimited(`${limits.readPerMinute} reads a minute`, 30)
  if (kind === 'write' && since(ctx, token.id, 'write', 60_000) >= limits.writePerMinute) throw rateLimited(`${limits.writePerMinute} edits a minute`, 30)
  if (kind === 'publish') {
    if (since(ctx, token.id, 'publish', 3600_000) >= limits.publishPerHour) throw rateLimited(`${limits.publishPerHour} publishes an hour`, 600)
    if (since(ctx, token.id, 'publish', 24 * 3600_000) >= limits.publishPerDay) throw rateLimited(`${limits.publishPerDay} publishes a day`, 3600)
  }
  ctx.db.insert(agentCalls).values({ tokenId: token.id, kind, at: iso(ctx) }).run()
  if (kind === 'write') ctx.db.delete(agentCalls).where(and(eq(agentCalls.tokenId, token.id), lt(agentCalls.at, new Date(ctx.now().getTime() - KEEP_MS).toISOString()))).run()
}

/** Check a publish would be within limits, without counting it. */
export function assertCanPublish(ctx: ServiceCtx, token: AgentTokenRow): void {
  const limits = effectiveLimits(token)
  if (since(ctx, token.id, 'publish', 3600_000) >= limits.publishPerHour) throw rateLimited(`${limits.publishPerHour} publishes an hour`, 600)
  if (since(ctx, token.id, 'publish', 24 * 3600_000) >= limits.publishPerDay) throw rateLimited(`${limits.publishPerDay} publishes a day`, 3600)
}

/** Record a blocked attempt (a deny rule, the never-list, no permission). Pauses the token on the third in ten minutes. */
export function recordViolation(ctx: ServiceCtx, token: AgentTokenRow): { paused: boolean } {
  ctx.db.insert(agentCalls).values({ tokenId: token.id, kind: 'violation', at: iso(ctx) }).run()
  if (since(ctx, token.id, 'violation', VIOLATION_WINDOW_MS) < VIOLATION_LIMIT) return { paused: false }
  const reason = `Paused automatically: ${VIOLATION_LIMIT} blocked attempts in ${VIOLATION_WINDOW_MS / 60_000} minutes (${iso(ctx)}). An admin can resume it.`
  ctx.db.update(agentTokens).set({ status: 'paused', pausedReason: reason }).where(eq(agentTokens.id, token.id)).run()
  audit(ctx, 'system', 'agent.token.auto_paused', { type: 'agent_token', id: token.id }, { name: token.name })
  const owner = ctx.db.select({ id: users.id }).from(users).where(eq(users.id, token.ownerUserId)).get()
  notify(ctx, [...(owner ? [owner.id] : []), ...usersWithRoles(ctx, ['admin'])], 'agent_paused', `The agent token "${token.name}" was paused after repeated blocked attempts.`, { type: 'agent_token', id: token.id })
  return { paused: true }
}

/** Auto-publishes by this token in the last hour, for the maxPerHour rule limit. */
export function publishesLastHour(ctx: ServiceCtx, tokenId: string): number {
  return since(ctx, tokenId, 'publish', 3600_000)
}

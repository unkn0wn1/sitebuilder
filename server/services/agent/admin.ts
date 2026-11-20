// What an admin can do with agent changes: see them all, and undo any of them in one step.
// The undo is a normal change that publishes straight away: rules and rate limits do not apply to an admin.
import { and, desc, eq } from 'drizzle-orm'
import { agentChanges, agentTokens } from '../../db/schema'
import type { ActingAs, ServiceCtx } from '../context'
import { AppError, forbidden, notFound } from '../errors'
import { can } from '../../../shared/roles'
import { changeTargets, refreshChange, requireChange, undoChange, type ChangeRow } from './changes'
import { changeView } from './gateway'
import { requireAgentToken, type SignedInAgent } from './tokens'

function requireAdmin(actor: ActingAs) {
  if (actor.agent) throw forbidden('A token cannot use the admin screens.')
  if (!can(actor, 'settings.manage')) throw forbidden('Only admins can see and undo agent changes.')
}

/** The token that made a change, wearing the admin's identity. For reading a change the way its token sees it. */
function agentFor(ctx: ServiceCtx, admin: ActingAs, row: ChangeRow): SignedInAgent {
  return { token: requireAgentToken(ctx, row.tokenId), actor: admin }
}

export function listAllChanges(ctx: ServiceCtx, admin: ActingAs, q: { status?: ChangeRow['status']; tokenId?: string; limit: number }) {
  requireAdmin(admin)
  const rows = ctx.db
    .select()
    .from(agentChanges)
    .where(and(eq(agentChanges.siteId, ctx.siteId), q.status ? eq(agentChanges.status, q.status) : undefined, q.tokenId ? eq(agentChanges.tokenId, q.tokenId) : undefined))
    .orderBy(desc(agentChanges.createdAt))
    .limit(q.limit)
    .all()
  const names = new Map(ctx.db.select({ id: agentTokens.id, name: agentTokens.name }).from(agentTokens).where(eq(agentTokens.siteId, ctx.siteId)).all().map((t) => [t.id, t.name]))
  return rows.map((r) => {
    const row = refreshChange(ctx, r)
    return { id: row.id, title: row.title, status: row.status, reason: row.reason, tokenId: row.tokenId, tokenName: names.get(row.tokenId) ?? 'Deleted token', createdAt: row.createdAt, publishedAt: row.publishedAt, undoOf: row.undoOf, targets: changeTargets(row).map((t) => ({ type: t.type, id: t.id, label: t.label, path: t.path ?? null })) }
  })
}

export function getAnyChange(ctx: ServiceCtx, admin: ActingAs, id: string) {
  requireAdmin(admin)
  const row = requireChange(ctx, id)
  if (row.siteId !== ctx.siteId) throw notFound('That change')
  return changeView(ctx, agentFor(ctx, admin, row), row)
}

/** Undo a published agent change as an admin. Goes live without a rule; refused if the pages were published again since. */
export function adminUndoChange(ctx: ServiceCtx, admin: ActingAs, id: string, reason: string) {
  requireAdmin(admin)
  const row = requireChange(ctx, id)
  if (row.siteId !== ctx.siteId) throw notFound('That change')
  if (reason.trim().length < 5) throw new AppError('validation_failed', 'Say why in a sentence.', [{ path: 'reason', message: 'At least 5 characters.' }])
  const agent = agentFor(ctx, admin, row)
  const r = undoChange(ctx, agent, id, { reason: reason.trim(), adminActor: admin })
  return { undoChangeId: r.undo.id, published: r.published, original: changeView(ctx, agent, r.original).change }
}

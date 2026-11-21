// What an admin can do with agent changes: see them all, and undo any of them in one step.
// The undo is a normal change that publishes straight away: rules and rate limits do not apply to an admin.
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { diffPages } from '../../../shared/diff'
import { ACTION_LABELS, AGENT_ACTIONS } from '../../../shared/agent/rules'
import { RULE_PRESETS } from '../../../shared/agent/presets'
import { agentChanges, agentTokens, auditEvents } from '../../db/schema'
import { readDoc, requirePage } from '../pages'
import { readSitePartDoc, requireSitePart } from '../site-parts'
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
  // Refresh every row first: an undo going live marks its original "undone", which may be an earlier row.
  for (const r of rows) refreshChange(ctx, r)
  return rows.map((r) => {
    const row = requireChange(ctx, r.id)
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
  return { undoChangeId: r.undo?.id ?? null, published: r.published, pagesTakenOffline: r.pagesTakenOffline, original: changeView(ctx, agent, r.original).change }
}

/** Ready-made rule sets and the action vocabulary, for the Settings screen. */
export function presetsView(admin: ActingAs) {
  requireAdmin(admin)
  return { presets: RULE_PRESETS, actions: AGENT_ACTIONS.map((key) => ({ key, label: ACTION_LABELS[key] })) }
}

/** Audit events about agents: their tokens, edits, publishes, blocked attempts and the alerts, newest first. */
export function listAgentAudit(ctx: ServiceCtx, admin: ActingAs, q: { page: number; pageSize: number; tokenId?: string }) {
  requireAdmin(admin)
  const mine = or(like(auditEvents.action, 'agent.%'), inArray(auditEvents.action, ['review.approved_by_rule', 'review.approved_admin_undo']), eq(auditEvents.actorType, 'agent'))
  const where = and(eq(auditEvents.siteId, ctx.siteId), mine, q.tokenId ? or(eq(auditEvents.actorId, q.tokenId), eq(auditEvents.targetId, q.tokenId), sql`json_extract(${auditEvents.details}, '$.tokenId') = ${q.tokenId}`) : undefined)
  const total = ctx.db.select({ n: sql<number>`count(*)` }).from(auditEvents).where(where).get()?.n ?? 0
  const items = ctx.db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.at)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all()
  const names = new Map(ctx.db.select({ id: agentTokens.id, name: agentTokens.name }).from(agentTokens).where(eq(agentTokens.siteId, ctx.siteId)).all().map((t) => [t.id, t.name]))
  return { items: items.map((e) => ({ ...e, tokenName: (e.targetType === 'agent_token' && e.targetId ? names.get(e.targetId) : null) ?? (e.actorType === 'agent' && e.actorId ? names.get(e.actorId) : null) ?? null })), page: q.page, pageSize: q.pageSize, total }
}

/**
 * The pages and site parts a change touches, as they are now and as they were before, so the Settings screen can show
 * them rendered with the differences marked. Open and waiting changes show the draft against live. Finished ones show
 * what is live now against what was live before the change.
 */
export function previewForAdmin(ctx: ServiceCtx, admin: ActingAs, id: string) {
  requireAdmin(admin)
  const row = requireChange(ctx, id)
  if (row.siteId !== ctx.siteId) throw notFound('That change')
  const fresh = refreshChange(ctx, row)
  const finished = fresh.status === 'published' || fresh.status === 'undone'
  const items = changeTargets(fresh).map((t) => {
    if (t.type === 'page') {
      const page = requirePage(ctx, t.id)
      const nowId = finished ? page.publishedVersionId : page.draftVersionId
      const beforeId = finished ? (t.beforePublishedVersionId ?? null) : page.publishedVersionId
      const doc = nowId ? readDoc(ctx, nowId) : null
      const before = beforeId ? readDoc(ctx, beforeId) : null
      return { type: 'page' as const, id: page.id, title: page.title, path: page.path, created: !!t.created, doc, hasBefore: !!before, diff: doc ? diffPages(before, doc) : null }
    }
    const part = requireSitePart(ctx, t.id)
    const nowId = finished ? part.publishedVersionId : part.draftVersionId
    return { type: 'site_part' as const, id: part.id, title: part.label, kind: part.kind, doc: nowId ? readSitePartDoc(ctx, part, nowId) : null, hasBefore: !!(finished ? t.beforePublishedVersionId : part.publishedVersionId) }
  })
  const tokenName = ctx.db.select({ name: agentTokens.name }).from(agentTokens).where(eq(agentTokens.id, fresh.tokenId)).get()?.name ?? 'Deleted token'
  const undoable = fresh.status === 'published' && !fresh.undoOf
  return { change: { id: fresh.id, title: fresh.title, status: fresh.status, reasonByAgent: fresh.reason, tokenId: fresh.tokenId, tokenName, createdAt: fresh.createdAt, publishedAt: fresh.publishedAt, undoOf: fresh.undoOf, decision: fresh.decision }, mode: finished ? ('after_publish' as const) : ('draft' as const), undoable, items }
}

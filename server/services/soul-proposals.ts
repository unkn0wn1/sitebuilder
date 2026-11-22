// Personality proposals from an agent. A person approves every one. Rules and always-allow cannot apply them.
import { and, desc, eq, ne } from 'drizzle-orm'
import { can } from '../../shared/roles'
import { DEFAULT_SOUL, SOUL_CHAR_LIMIT, soulBudgetError, stripSoulComments } from '../../shared/soul'
import { readSettings } from '../../shared/settings'
import { newId } from '../../shared/ids'
import type { AgentRule } from '../../shared/agent/rules'
import { agentSoulProposals, sites, type SoulProposalStatus } from '../db/schema'
import { sha256 } from './auth'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { notify, usersWithRoles } from './notify'
import { applySoul } from './soul'
import { tokenRules, type SignedInAgent } from './agent/tokens'

const NEXT_STEPS =
  'Nothing has changed yet. A person must approve this on Settings, AI personality. Rules and always-allow cannot apply it. Check get_site.soul_proposal for the status.'

/** Null when the site is on the shipped default. Otherwise the hash of the stored raw text. */
export function soulBaseHash(stored: string | null | undefined): string | null {
  return stored == null ? null : sha256(stored)
}

function currentStored(ctx: ServiceCtx): string | null {
  const site = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  return site ? readSettings(site.settings).soul : null
}

/**
 * An unscoped deny rule with actions "*" (no page or site-part targets) refuses a proposal. A deny scoped to some
 * pages or parts is about those, not the personality. Other rules, including publish "*", never apply a proposal.
 */
function denyAllRule(rules: AgentRule[]): AgentRule | undefined {
  const scoped = (rule: AgentRule) => !!(rule.targets.pageTemplates?.length || rule.targets.pagePaths?.length || rule.targets.siteParts?.length)
  return rules.find((rule) => rule.result === 'deny' && rule.actions === '*' && !scoped(rule))
}

function requireAdminPerson(actor: ActingAs): void {
  if (actor.agent || actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
}

function requireProposal(ctx: ServiceCtx, id: string) {
  const row = ctx.db.select().from(agentSoulProposals).where(and(eq(agentSoulProposals.id, id), eq(agentSoulProposals.siteId, ctx.siteId))).get()
  if (!row) throw notFound('That proposal')
  return row
}

export interface SoulProposalSummary {
  proposal_id: string
  status: SoulProposalStatus
  stripped_length: number
  limit: number
  stale: boolean
  created_at: string
}

/** This token's pending proposal, or its newest one, for get_site. Never includes the text. */
export function soulProposalSummaryForToken(ctx: ServiceCtx, tokenId: string): SoulProposalSummary | null {
  const pending = ctx.db
    .select()
    .from(agentSoulProposals)
    .where(and(eq(agentSoulProposals.siteId, ctx.siteId), eq(agentSoulProposals.tokenId, tokenId), eq(agentSoulProposals.status, 'pending')))
    .get()
  const row =
    pending ??
    ctx.db
      .select()
      .from(agentSoulProposals)
      .where(and(eq(agentSoulProposals.siteId, ctx.siteId), eq(agentSoulProposals.tokenId, tokenId)))
      .orderBy(desc(agentSoulProposals.createdAt))
      .get()
  if (!row) return null
  const stale = row.status === 'pending' && soulBaseHash(currentStored(ctx)) !== row.baseHash
  return {
    proposal_id: row.id,
    status: row.status,
    stripped_length: stripSoulComments(row.text).length,
    limit: SOUL_CHAR_LIMIT,
    stale,
    created_at: row.createdAt,
  }
}

export function proposeSoul(ctx: ServiceCtx, agent: SignedInAgent, input: { text: string; reason: string }) {
  if (agent.token.access !== 'draft') throw new AppError('forbidden', 'This token is read-only. Ask the site owner for a token that can make drafts.')
  const deny = denyAllRule(tokenRules(agent.token))
  if (deny) {
    throw new AppError('rule_denied', `Rule "${deny.label}" on this token does not allow a personality proposal, so nothing was saved.`, undefined, { ruleId: deny.id })
  }
  const problem = soulBudgetError(input.text)
  if (problem) throw new AppError('validation_failed', problem)
  const strippedLength = stripSoulComments(input.text).length
  return inTx(ctx, () => {
    const previous = ctx.db
      .select()
      .from(agentSoulProposals)
      .where(and(eq(agentSoulProposals.siteId, ctx.siteId), eq(agentSoulProposals.tokenId, agent.token.id), eq(agentSoulProposals.status, 'pending')))
      .get()
    if (previous) ctx.db.update(agentSoulProposals).set({ status: 'superseded' }).where(eq(agentSoulProposals.id, previous.id)).run()
    const id = newId('agentSoulProposal', ctx.now().getTime())
    ctx.db
      .insert(agentSoulProposals)
      .values({
        id,
        siteId: ctx.siteId,
        tokenId: agent.token.id,
        agentLabel: agent.token.name,
        text: input.text,
        baseHash: soulBaseHash(currentStored(ctx)),
        reason: input.reason,
        status: 'pending',
        createdAt: iso(ctx),
      })
      .run()
    audit(ctx, agent.actor, 'agent.soul.proposed', { type: 'soul_proposal', id }, {
      tokenId: agent.token.id,
      proposalId: id,
      strippedLength,
      reason: input.reason,
      ...(previous ? { supersededProposalId: previous.id } : {}),
    })
    notify(
      ctx,
      usersWithRoles(ctx, ['admin']),
      'soul_proposal',
      `Agent "${agent.token.name}" proposed a new AI personality. Open Settings, AI personality to approve or reject it.`,
      { type: 'soul_proposal', id },
    )
    return {
      proposal_id: id,
      status: 'pending' as const,
      stripped_length: strippedLength,
      limit: SOUL_CHAR_LIMIT,
      superseded_proposal_id: previous?.id ?? null,
      next_steps: NEXT_STEPS,
    }
  })
}

export interface SoulProposalView {
  id: string
  tokenId: string
  agentLabel: string
  reason: string
  text?: string
  strippedLength: number
  limit: number
  baseHash: string | null
  stale: boolean
  status: SoulProposalStatus
  createdAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
}

function toView(row: typeof agentSoulProposals.$inferSelect, stored: string | null, includeText: boolean): SoulProposalView {
  const stale = row.status === 'pending' && soulBaseHash(stored) !== row.baseHash
  return {
    id: row.id,
    tokenId: row.tokenId,
    agentLabel: row.agentLabel,
    reason: row.reason,
    ...(includeText ? { text: row.text } : {}),
    strippedLength: stripSoulComments(row.text).length,
    limit: SOUL_CHAR_LIMIT,
    baseHash: row.baseHash,
    stale,
    status: row.status,
    createdAt: row.createdAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
  }
}

/** Pending proposals, then the 20 newest decided ones. Pending rows include the raw text. */
export function listSoulProposals(ctx: ServiceCtx, actor: ActingAs): { proposals: SoulProposalView[]; currentHash: string | null; currentText: string } {
  requireAdminPerson(actor)
  const stored = currentStored(ctx)
  const pending = ctx.db
    .select()
    .from(agentSoulProposals)
    .where(and(eq(agentSoulProposals.siteId, ctx.siteId), eq(agentSoulProposals.status, 'pending')))
    .orderBy(desc(agentSoulProposals.createdAt))
    .all()
  const decided = ctx.db
    .select()
    .from(agentSoulProposals)
    .where(and(eq(agentSoulProposals.siteId, ctx.siteId), ne(agentSoulProposals.status, 'pending')))
    .orderBy(desc(agentSoulProposals.createdAt))
    .limit(20)
    .all()
  return {
    proposals: [...pending.map((row) => toView(row, stored, true)), ...decided.map((row) => toView(row, stored, false))],
    // What the admin is looking at. A stale approval must send this back, so a change made after the diff was shown is not overwritten silently.
    currentHash: soulBaseHash(stored),
    currentText: stored ?? DEFAULT_SOUL,
  }
}

export function approveSoulProposal(ctx: ServiceCtx, actor: ActingAs, id: string, input: { overwrite?: boolean; currentHash?: string | null } = {}) {
  requireAdminPerson(actor)
  return inTx(ctx, () => {
    const row = requireProposal(ctx, id)
    if (row.status !== 'pending') throw new AppError('invalid_state', `This proposal is "${row.status}", so it cannot be approved.`)
    const problem = soulBudgetError(row.text)
    if (problem) throw new AppError('validation_failed', problem)
    const stale = soulBaseHash(currentStored(ctx)) !== row.baseHash
    if (stale && input.overwrite !== true) {
      throw new AppError(
        'conflict',
        'This proposal is stale. The personality changed after it was proposed. Reject it, or approve with overwrite after you have seen the diff against the current text.',
        undefined,
        { stale: true },
      )
    }
    // Overwrite is for the text the admin saw: if it changed again since the list was loaded, check again.
    if (stale && input.currentHash !== undefined && input.currentHash !== soulBaseHash(currentStored(ctx))) {
      throw new AppError('conflict', 'The personality changed again while you were looking. Reload to see the new diff before you approve.', undefined, { stale: true })
    }
    const saved = applySoul(ctx, actor, row.text, { source: 'agent_proposal', proposalId: row.id, tokenId: row.tokenId })
    ctx.db.update(agentSoulProposals).set({ status: 'approved', decidedBy: actor.id, decidedAt: iso(ctx) }).where(eq(agentSoulProposals.id, row.id)).run()
    audit(ctx, actor, 'agent.soul.approved', { type: 'soul_proposal', id: row.id }, { tokenId: row.tokenId, proposalId: row.id, stale, overwrite: input.overwrite === true })
    return { ...saved, proposalId: row.id, status: 'approved' as const }
  })
}

export function rejectSoulProposal(ctx: ServiceCtx, actor: ActingAs, id: string, input: { note?: string } = {}) {
  requireAdminPerson(actor)
  const note = input.note?.trim() ? input.note.trim() : null
  if (note && note.length > 500) throw new AppError('validation_failed', 'The note is too long. Keep it under 500 characters.')
  return inTx(ctx, () => {
    const row = requireProposal(ctx, id)
    if (row.status !== 'pending') throw new AppError('invalid_state', `This proposal is "${row.status}", so it cannot be rejected.`)
    ctx.db.update(agentSoulProposals).set({ status: 'rejected', decidedBy: actor.id, decidedAt: iso(ctx), decisionNote: note }).where(eq(agentSoulProposals.id, row.id)).run()
    audit(ctx, actor, 'agent.soul.rejected', { type: 'soul_proposal', id: row.id }, { tokenId: row.tokenId, proposalId: row.id, note })
    return { proposalId: row.id, status: 'rejected' as const }
  })
}

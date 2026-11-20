// Agent changes: the unit an agent works in. A change is a titled set of draft edits across pages and site parts,
// with a stated reason, a rule decision, and the way back. See ADR 0018 and docs/agent-gateway.md#changes.
//
// Life of a change:   open  ->  review  ->  published   (a person approved it)
//                     open  ->  publishing -> published (a rule on the token allowed it)
//                     published -> undone               (an undo change was published)
//                     open  ->  discarded               (thrown away before it was sent anywhere)
import { and, desc, eq, gte } from 'drizzle-orm'
import { sameDraft } from '../../../shared/clone'
import { diffPages, type PageDiff } from '../../../shared/diff'
import { newId } from '../../../shared/ids'
import { blockUsesMockData } from '../../../shared/data-sources'
import type { InternalOp } from '../../../shared/ops'
import type { PageDoc } from '../../../shared/page'
import type { SitePartDoc, SitePartKind } from '../../../shared/site-parts'
import {
  decideChange,
  isMoneyBlockType,
  stagingDenial,
  type AgentAction,
  type ChangeDecision,
  type FloorFlag,
  type PartFacts,
  type PartTarget,
} from '../../../shared/agent/rules'
import { linkDelta, textLeaves, wordsChanged } from '../../../shared/agent/content'
import { agentChanges, pages, reviews, siteParts, sites, users, type AgentChangeStatus } from '../../db/schema'
import { audit } from '../audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from '../context'
import { AppError, notFound } from '../errors'
import { notify, usersWithRoles } from '../notify'
import { applyPageOps, binPage, readDoc, requirePage, restoreVersion, undoOp } from '../pages'
import { approveReviewDirect, checksFor, summariseDiff, submitPage } from '../reviews'
import { editSitePart, readSitePartDoc, requireSitePart, sitePartChecks, submitSitePart } from '../site-parts'
import { assertCanPublish, recordViolation, takeCall } from './limits'
import { alwaysAllowActive, tokenRules, type AgentTokenRow, type SignedInAgent } from './tokens'
import type { FieldIssue } from '../../../shared/issues'

export type ChangeRow = typeof agentChanges.$inferSelect

export interface ChangeTarget {
  type: 'page' | 'site_part'
  id: string
  label: string
  path?: string
  partKind?: SitePartKind
  /** True when this change created the page. */
  created?: boolean
  actions: AgentAction[]
  /** Draft revision after the agent's last edit. If it moves, someone else has changed the draft since. */
  revision: number
  /** Was there unpublished work on this page or part, from someone else, when the agent first touched it? */
  foreignDraft: boolean
  /** Page operation ids the agent made, so a discard can take them back one by one. */
  opIds: string[]
  /** Site parts are replaced whole, so the document before the first edit is kept for discard. */
  beforeDoc?: unknown
  /** Filled in when the change is sent for review or published. */
  reviewId?: string
  beforePublishedVersionId?: string | null
  afterVersionId?: string
}

export function changeTargets(row: ChangeRow): ChangeTarget[] {
  return row.targets as ChangeTarget[]
}

// ---------------------------------------------------------------------------------------------------------------------
// Staging

function createChangeRow(ctx: ServiceCtx, agent: SignedInAgent, input: { title: string; reason: string; undoOf?: string }): ChangeRow {
  const id = newId('agentChange', ctx.now().getTime())
  const now = iso(ctx)
  ctx.db
    .insert(agentChanges)
    .values({ id, siteId: ctx.siteId, tokenId: agent.token.id, ownerUserId: agent.actor.id, title: input.title.slice(0, 120), reason: input.reason, status: 'open', targets: [], undoOf: input.undoOf ?? null, createdAt: now, updatedAt: now })
    .run()
  audit(ctx, agent.actor, 'agent.change.created', { type: 'agent_change', id }, { title: input.title, reason: input.reason })
  return requireChange(ctx, id)
}

export function requireChange(ctx: ServiceCtx, id: string): ChangeRow {
  const row = ctx.db.select().from(agentChanges).where(and(eq(agentChanges.id, id), eq(agentChanges.siteId, ctx.siteId))).get()
  if (!row) throw notFound('That change')
  return row
}

/** A change an agent may use: its own token's, and still open. */
export function requireOpenChange(ctx: ServiceCtx, agent: SignedInAgent, id: string): ChangeRow {
  const row = requireChange(ctx, id)
  if (row.tokenId !== agent.token.id) throw notFound('That change')
  if (row.status !== 'open') {
    throw new AppError('invalid_state', `Change ${id} is "${row.status}", so it cannot be edited any more. Leave out change_id to start a new change.`, undefined, { status: row.status })
  }
  return row
}

/** A change this token made, in any state. */
export function requireOwnChange(ctx: ServiceCtx, agent: SignedInAgent, id: string): ChangeRow {
  const row = requireChange(ctx, id)
  if (row.tokenId !== agent.token.id) throw notFound('That change')
  return row
}

function pageHasPendingDraft(ctx: ServiceCtx, page: typeof pages.$inferSelect): boolean {
  if (!page.draftVersionId) return false
  if (!page.publishedVersionId) return true
  if (page.publishedPath && page.path !== page.publishedPath) return true
  if (page.draftVersionId === page.publishedVersionId) return false
  return !sameDraft(readDoc(ctx, page.draftVersionId), readDoc(ctx, page.publishedVersionId))
}

function partHasPendingDraft(ctx: ServiceCtx, part: typeof siteParts.$inferSelect): boolean {
  if (!part.draftVersionId) return false
  if (!part.publishedVersionId) return true
  if (part.draftVersionId === part.publishedVersionId) return false
  return !sameDraft(readSitePartDoc(ctx, part, part.draftVersionId), readSitePartDoc(ctx, part, part.publishedVersionId))
}

/** Handed to a tool while it stages edits. Everything it does is in one transaction with the change row. */
export class ChangeHandle {
  constructor(
    readonly ctx: ServiceCtx,
    readonly agent: SignedInAgent,
    public row: ChangeRow,
    private targets: ChangeTarget[],
    /** An admin undoing an agent change is not held to the token's rules. */
    private enforceRules = true,
  ) {}

  get targetList(): ChangeTarget[] {
    return this.targets
  }

  get actor(): ActingAs {
    return this.agent.actor
  }

  private rules() {
    return tokenRules(this.agent.token)
  }

  private deny(action: AgentAction, target: PartTarget) {
    if (!this.enforceRules) return
    const rule = stagingDenial(this.rules(), action, target)
    if (rule) throw new AppError('rule_denied', `Rule "${rule.label}" on this token does not allow "${action}" here, so no draft was made.`, undefined, { ruleId: rule.id })
  }

  private find(type: ChangeTarget['type'], id: string) {
    return this.targets.find((t) => t.type === type && t.id === id)
  }

  /** Register a page as part of this change (first touch records whether someone else already has unpublished work on it). */
  touchPage(pageId: string, action: AgentAction) {
    const page = requirePage(this.ctx, pageId)
    if (page.workflowState === 'in_review') throw new AppError('invalid_state', `The page "${page.title}" is waiting for someone to approve it. Editing it would withdraw that review, so the agent may not change it until it is decided.`, undefined, { pageId })
    if (page.workflowState === 'approved') throw new AppError('invalid_state', `The page "${page.title}" is being published right now. Try again in a moment.`, undefined, { pageId })
    this.deny(action, { type: 'page', id: page.id, path: page.path, template: page.template, label: page.title, holdsMoney: false })
    let target = this.find('page', pageId)
    if (!target) {
      target = { type: 'page', id: pageId, label: page.title, path: page.path, actions: [], revision: page.draftRevision, foreignDraft: pageHasPendingDraft(this.ctx, page), opIds: [] }
      this.targets.push(target)
    }
    if (!target.actions.includes(action)) target.actions.push(action)
    return { page, target }
  }

  touchSitePart(partId: string, action: AgentAction) {
    const part = requireSitePart(this.ctx, partId)
    if (part.workflowState === 'in_review') throw new AppError('invalid_state', `The ${part.label.toLowerCase()} is waiting for someone to approve it. Editing it would withdraw that review, so the agent may not change it until it is decided.`, undefined, { partId })
    if (part.workflowState === 'approved') throw new AppError('invalid_state', `The ${part.label.toLowerCase()} is being published right now. Try again in a moment.`, undefined, { partId })
    this.deny(action, { type: 'site_part', id: part.id, partKind: part.kind, label: part.label })
    let target = this.find('site_part', partId)
    if (!target) {
      target = { type: 'site_part', id: partId, label: part.label, partKind: part.kind, actions: [], revision: part.draftRevision, foreignDraft: partHasPendingDraft(this.ctx, part), opIds: [], beforeDoc: readSitePartDoc(this.ctx, part) }
      this.targets.push(target)
    }
    if (!target.actions.includes(action)) target.actions.push(action)
    return { part, target }
  }

  /** Change a page draft with page operations. All or nothing. */
  editPage(pageId: string, action: AgentAction, ops: InternalOp[]) {
    const { page, target } = this.touchPage(pageId, action)
    const result = applyPageOps(this.ctx, this.actor, pageId, page.draftRevision, ops)
    target.revision = result.revision
    target.opIds.push(...result.opIds)
    target.label = result.doc.title
    target.path = result.meta.path
    return result
  }

  /** Replace a site part's draft document. */
  editPart(partId: string, action: AgentAction, doc: SitePartDoc) {
    const { part, target } = this.touchSitePart(partId, action)
    const result = editSitePart(this.ctx, this.actor, partId, part.draftRevision, doc)
    target.revision = result.revision
    return result
  }

  /** Register a page this change just created. */
  addCreatedPage(page: { id: string; title: string; path: string; draftRevision: number; template?: string }, action: AgentAction) {
    this.deny(action, { type: 'page', id: page.id, path: page.path, template: page.template ?? '', label: page.title, holdsMoney: false })
    this.targets.push({ type: 'page', id: page.id, label: page.title, path: page.path, created: true, actions: [action], revision: page.draftRevision, foreignDraft: false, opIds: [] })
  }

  pageTarget(pageId: string): ChangeTarget | undefined {
    return this.find('page', pageId)
  }

  save() {
    this.row = this.updateRow({ targets: this.targets })
  }

  updateRow(patch: Partial<typeof agentChanges.$inferInsert>): ChangeRow {
    this.ctx.db.update(agentChanges).set({ ...patch, updatedAt: iso(this.ctx) }).where(eq(agentChanges.id, this.row.id)).run()
    return requireChange(this.ctx, this.row.id)
  }
}

/**
 * Run a staging function against an open change (or a new one), atomically.
 * If the function throws, nothing is kept: no draft edit, no new change.
 */
export function runInChange<T>(ctx: ServiceCtx, agent: SignedInAgent, input: { changeId?: string; title: string; reason: string }, fn: (h: ChangeHandle) => T): { change: ChangeRow; result: T } {
  if (agent.token.access !== 'draft') throw new AppError('forbidden', 'This token is read-only. Ask the site owner for a token that can make drafts.')
  return inTx(ctx, () => {
    const row = input.changeId ? requireOpenChange(ctx, agent, input.changeId) : createChangeRow(ctx, agent, input)
    const handle = new ChangeHandle(ctx, agent, row, structuredClone(changeTargets(row)))
    const result = fn(handle)
    if (!handle.targetList.length) throw new AppError('no_matches', 'Nothing was changed.')
    handle.save()
    audit(ctx, agent.actor, 'agent.change.edited', { type: 'agent_change', id: row.id }, { targets: handle.targetList.map((t) => ({ type: t.type, id: t.id, actions: t.actions })) })
    return { change: handle.row, result }
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Evaluating

export interface TextChange {
  where: string
  before: string
  after: string
}

export interface TargetEvaluation {
  target: ChangeTarget
  facts: PartFacts
  summary: string
  unchanged: boolean
  blocks?: PageDiff['blocks']
  meta?: string[]
  textChanges: TextChange[]
  blocking: FieldIssue[]
  warnings: FieldIssue[]
}

export interface ChangeEvaluation {
  decision: ChangeDecision
  targets: TargetEvaluation[]
  blocking: FieldIssue[]
}

function textDiff(before: unknown, after: unknown, limit = 25): TextChange[] {
  const a = new Map(textLeaves(before).map((l) => [l.path.join('.'), l.text]))
  const b = new Map(textLeaves(after).map((l) => [l.path.join('.'), l.text]))
  const out: TextChange[] = []
  for (const [k, v] of b) if (a.get(k) !== v && out.length < limit) out.push({ where: k, before: a.get(k) ?? '', after: v })
  for (const [k, v] of a) if (!b.has(k) && out.length < limit) out.push({ where: k, before: v, after: '' })
  return out
}

function siteOrigin(ctx: ServiceCtx): string | null {
  const domain = ctx.db.select({ d: sites.primaryDomain }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.d
  return domain ? `https://${domain}` : null
}

/** What would happen to each part, and what the rules say. Read-only. */
export function evaluateTargets(ctx: ServiceCtx, token: AgentTokenRow, targets: ChangeTarget[], opts: { actions?: AgentAction[]; changeAgeHours?: number; forceReview?: FloorFlag[] } = {}): ChangeEvaluation {
  const origin = siteOrigin(ctx)
  const out: TargetEvaluation[] = []
  for (const t of targets) {
    const floor: FloorFlag[] = [...(opts.forceReview ?? [])]
    if (t.type === 'page') {
      const page = requirePage(ctx, t.id)
      const draft = readDoc(ctx, page.draftVersionId!)
      const live = page.publishedVersionId ? readDoc(ctx, page.publishedVersionId) : null
      const diff = diffPages(live, draft)
      const checks = checksFor(ctx, page.template, draft)
      const holdsMoney = draft.blocks.some((b) => isMoneyBlockType(b.type)) || !!live?.blocks.some((b) => isMoneyBlockType(b.type))
      if (diff.blocks.some((c) => isMoneyBlockType(c.type))) floor.push('money_section_touched')
      if (draft.blocks.some(blockUsesMockData)) floor.push('mock_data')
      if (t.foreignDraft || page.draftRevision !== t.revision) floor.push('foreign_draft')
      if (checks.blocking.length) floor.push('checks_failing')
      const links = linkDelta(live ?? { blocks: [] }, draft, 'block', origin)
      const metaChanged = diff.meta.length > 0 && live !== null
      const unchanged = live !== null && !diff.blocks.length && !metaChanged && page.path === (page.publishedPath ?? page.path)
      out.push({
        target: { ...t, label: page.title, path: page.path },
        facts: {
          target: { type: 'page', id: page.id, path: page.path, template: page.template, label: page.title, holdsMoney },
          actions: opts.actions ?? t.actions,
          stats: { sectionsTouched: diff.blocks.length + (metaChanged ? 1 : 0), wordsChanged: wordsChanged(live ?? { blocks: [] }, draft), ...links },
          floor: [...new Set(floor)],
          changeAgeHours: opts.changeAgeHours,
        },
        summary: live ? summariseDiff(diff, (type) => ctx.registry.get(type)?.label.toLowerCase() ?? type) : `New page. ${summariseDiff(diff, (type) => ctx.registry.get(type)?.label.toLowerCase() ?? type)}`,
        unchanged,
        blocks: diff.blocks,
        meta: diff.meta,
        textChanges: textDiff(live ?? { blocks: [] }, draft),
        blocking: checks.blocking.map((i) => ({ ...i, path: `${page.path}: ${i.path}` })),
        warnings: checks.warnings,
      })
    } else {
      const part = requireSitePart(ctx, t.id)
      const draft = readSitePartDoc(ctx, part)
      const live = part.publishedVersionId ? readSitePartDoc(ctx, part, part.publishedVersionId) : null
      const checks = sitePartChecks(ctx, part.kind, draft)
      if (t.foreignDraft || part.draftRevision !== t.revision) floor.push('foreign_draft')
      if (checks.blocking.length) floor.push('checks_failing')
      const links = linkDelta(live ?? {}, draft, 'sitepart', origin)
      const unchanged = live !== null && sameDraft(live, draft)
      out.push({
        target: { ...t, label: part.label },
        facts: {
          target: { type: 'site_part', id: part.id, partKind: part.kind, label: part.label },
          actions: opts.actions ?? t.actions,
          stats: { sectionsTouched: 1, wordsChanged: wordsChanged(live ?? {}, draft), ...links },
          floor: [...new Set(floor)],
          changeAgeHours: opts.changeAgeHours,
        },
        summary: live ? `Changed the ${part.label.toLowerCase()}` : `New ${part.label.toLowerCase()}`,
        unchanged,
        textChanges: textDiff(live ?? {}, draft),
        blocking: checks.blocking.map((i) => ({ ...i, path: `${part.label}: ${i.path}` })),
        warnings: checks.warnings,
      })
    }
  }
  const decision = decideChange(out.map((o) => o.facts), decisionInput(ctx, token))
  return { decision, targets: out, blocking: out.flatMap((o) => o.blocking) }
}

function decisionInput(ctx: ServiceCtx, token: AgentTokenRow) {
  const hourAgo = new Date(ctx.now().getTime() - 3600_000).toISOString()
  const recent = ctx.db.select().from(agentChanges).where(and(eq(agentChanges.tokenId, token.id), gte(agentChanges.appliedAt, hourAgo))).all()
  const byRule: Record<string, number> = {}
  for (const c of recent) {
    const d = c.decision as { outcome?: string; ruleIds?: string[] } | null
    if (d?.outcome === 'publish') for (const id of d.ruleIds ?? []) byRule[id] = (byRule[id] ?? 0) + 1
  }
  return { rules: tokenRules(token), alwaysAllow: alwaysAllowActive(token, ctx.now()), publishesLastHourByRule: byRule }
}

export function evaluateChange(ctx: ServiceCtx, agent: SignedInAgent, row: ChangeRow): ChangeEvaluation {
  return evaluateTargets(ctx, agent.token, changeTargets(row))
}

// ---------------------------------------------------------------------------------------------------------------------
// Sending: review or publish

export type ApplyMode = 'request_review' | 'publish_if_allowed'

interface SendOptions {
  mode: ApplyMode
  /** An admin undoing an agent change publishes without a rule. */
  adminActor?: ActingAs
  evaluation?: ChangeEvaluation
  /** What the agent told the reviewer when asking for approval. */
  note?: string
}

function emailBody(row: ChangeRow, ev: ChangeEvaluation, verb: string): string {
  const lines = [`${verb}: ${row.title}`, `The agent's stated reason: ${row.reason}`, '']
  for (const t of ev.targets) {
    lines.push(`${t.target.type === 'page' ? `Page "${t.target.label}" (${t.target.path})` : `The ${t.target.label.toLowerCase()}`}: ${t.summary}.`)
    for (const c of t.textChanges.slice(0, 8)) lines.push(`  - "${c.before.slice(0, 120)}"  becomes  "${c.after.slice(0, 120)}"`)
    if (t.facts.stats.linksRemoved) lines.push(`  - ${t.facts.stats.linksRemoved} link(s) removed`)
    if (t.facts.stats.linksAdded) lines.push(`  - ${t.facts.stats.linksAdded} link(s) added: ${t.facts.stats.newLinkDomains.join(', ')}`)
  }
  lines.push('', `Change id: ${row.id}`)
  return lines.join('\n')
}

/** Submit every target, and approve by rule when allowed. One transaction, so there is no half-sent change. */
export function sendChange(ctx: ServiceCtx, agent: SignedInAgent, row: ChangeRow, opts: SendOptions) {
  return inTx(ctx, () => {
    const ev = opts.evaluation ?? evaluateChange(ctx, agent, row)
    const outcome = ev.decision.outcome
    if (outcome === 'deny' && !opts.adminActor) {
      throw new AppError('rule_denied', ev.decision.reasons[0] ?? 'A rule on this token does not allow this change.', undefined, { reasons: ev.decision.reasons })
    }
    if (!ev.targets.length) throw new AppError('invalid_state', 'This change has no edits yet. Make an edit first.')
    if (ev.targets.every((t) => t.unchanged)) throw new AppError('invalid_state', 'Nothing in this change differs from what is live, so there is nothing to publish. Use discard_change to close it.')
    if (ev.blocking.length) throw new AppError('validation_failed', 'The change has problems that must be fixed before it can be reviewed or published. Edit the change to fix them, then try again.', ev.blocking)

    const publish = opts.mode === 'publish_if_allowed' && (outcome === 'publish' || !!opts.adminActor)
    if (publish && !opts.adminActor) assertCanPublish(ctx, agent.token)

    const actor = opts.adminActor ?? agent.actor
    const note = `Sent by agent "${agent.token.name}" for the owner. Reason given by the agent: ${row.reason}${opts.note ? ` Note: ${opts.note}` : ''}`
    const targets = changeTargets(row).map((t) => ({ ...t }))
    const jobIds: string[] = []
    for (const t of targets) {
      const evalT = ev.targets.find((e) => e.target.id === t.id && e.target.type === t.type)!
      if (evalT.unchanged) continue
      const submitActor = actor
      if (t.type === 'page') {
        const page = requirePage(ctx, t.id)
        t.beforePublishedVersionId = page.publishedVersionId
        const sub = submitPage(ctx, submitActor, t.id, { note })
        t.reviewId = sub.reviewId
        if (publish) jobIds.push(approveReviewDirect(ctx, actor, sub.reviewId, { versionId: sub.versionId, ...basis(ev, opts, agent) }).jobId)
      } else {
        const part = requireSitePart(ctx, t.id)
        t.beforePublishedVersionId = part.publishedVersionId
        const sub = submitSitePart(ctx, submitActor, t.id, { note })
        t.reviewId = sub.reviewId
        if (publish) jobIds.push(approveReviewDirect(ctx, actor, sub.reviewId, { versionId: sub.versionId, ...basis(ev, opts, agent) }).jobId)
      }
    }

    if (publish && !opts.adminActor) takeCall(ctx, agent.token, 'publish')
    const now = iso(ctx)
    const status: AgentChangeStatus = publish ? 'publishing' : 'review'
    ctx.db
      .update(agentChanges)
      .set({ status, targets, decision: { outcome: publish ? 'publish' : outcome, ruleIds: ev.decision.ruleIds, viaAlwaysAllow: ev.decision.viaAlwaysAllow, reasons: ev.decision.reasons, via: opts.adminActor ? 'admin_undo' : opts.mode, jobIds }, appliedAt: now, updatedAt: now })
      .where(eq(agentChanges.id, row.id))
      .run()
    audit(ctx, actor, publish ? 'agent.change.published' : 'agent.change.review_requested', { type: 'agent_change', id: row.id }, {
      title: row.title,
      reason: row.reason,
      rules: ev.decision.ruleIds,
      viaAlwaysAllow: ev.decision.viaAlwaysAllow,
      reasons: ev.decision.reasons,
      targets: ev.targets.map((t) => ({ type: t.target.type, id: t.target.id, summary: t.summary, stats: t.facts.stats, textChanges: t.textChanges.slice(0, 10) })),
    })
    const admins = usersWithRoles(ctx, ['admin'])
    if (publish) {
      notify(ctx, [row.ownerUserId, ...admins], 'agent_change', `Agent "${agent.token.name}" published: ${row.title}. Change id ${row.id}.`, { type: 'agent_change', id: row.id }, emailBody(row, ev, `Agent "${agent.token.name}" published a change${opts.adminActor ? ' (undo by an admin)' : ''}. To take it back, ask the agent to run undo_change on ${row.id}, or use the undo button in the builder`))
    } else {
      notify(ctx, [row.ownerUserId], 'agent_change', `Agent "${agent.token.name}" asked for review: ${row.title}.`, { type: 'agent_change', id: row.id }, emailBody(row, ev, `Agent "${agent.token.name}" has sent a change for review`))
    }
    return { change: requireChange(ctx, row.id), evaluation: ev, published: publish }
  })
}

function basis(ev: ChangeEvaluation, opts: SendOptions, agent: SignedInAgent): { basis: string; via: 'rule' | 'admin_undo' } {
  if (opts.adminActor) return { basis: `Undo by an admin of an agent change (token "${agent.token.name}").`, via: 'admin_undo' }
  return { basis: ev.decision.viaAlwaysAllow ? `Approved by always-allow on token "${agent.token.name}".` : `Approved by rule ${ev.decision.ruleIds.join(', ')} on token "${agent.token.name}".`, via: 'rule' }
}

// ---------------------------------------------------------------------------------------------------------------------
// Keeping the change row in step with its reviews

/** Bring a change's status up to date from its reviews (publish jobs run in the background). */
export function refreshChange(ctx: ServiceCtx, row: ChangeRow): ChangeRow {
  if (row.status !== 'publishing' && row.status !== 'review') return row
  const targets = changeTargets(row).map((t) => ({ ...t }))
  const withReview = targets.filter((t) => t.reviewId)
  if (!withReview.length) return row
  const states = withReview.map((t) => ctx.db.select().from(reviews).where(eq(reviews.id, t.reviewId!)).get())
  if (states.some((r) => !r)) return row
  let status: AgentChangeStatus = row.status
  let decision = row.decision as Record<string, unknown> | null
  if (states.every((r) => r!.state === 'published')) {
    withReview.forEach((t, i) => (t.afterVersionId = states[i]!.versionId))
    status = 'published'
  } else if (row.status === 'publishing' && states.some((r) => r!.state === 'pending' && r!.decisionComment?.startsWith('Publish failed'))) {
    status = 'failed'
    decision = { ...(decision ?? {}), failure: states.find((r) => r!.decisionComment?.startsWith('Publish failed'))?.decisionComment ?? 'Publishing failed.' }
  } else if (row.status === 'review' && states.some((r) => r!.state === 'sent_back' || r!.state === 'withdrawn')) {
    status = 'open'
    const sentBack = states.find((r) => r!.state === 'sent_back')
    decision = { ...(decision ?? {}), feedback: sentBack?.decisionComment ?? 'The review was withdrawn because the draft changed. Make your edits again and send it again.' }
  } else return row
  const patch: Partial<typeof agentChanges.$inferInsert> = { status, targets, decision, publishedAt: status === 'published' ? iso(ctx) : row.publishedAt }
  ctx.db.update(agentChanges).set({ ...patch, updatedAt: iso(ctx) }).where(eq(agentChanges.id, row.id)).run()
  if (status === 'published' && row.undoOf) {
    ctx.db.update(agentChanges).set({ status: 'undone', updatedAt: iso(ctx) }).where(and(eq(agentChanges.id, row.undoOf), eq(agentChanges.status, 'published'))).run()
  }
  return requireChange(ctx, row.id)
}

export function listChanges(ctx: ServiceCtx, agent: SignedInAgent, q: { status?: AgentChangeStatus; limit: number }) {
  const rows = ctx.db
    .select()
    .from(agentChanges)
    .where(and(eq(agentChanges.tokenId, agent.token.id), q.status ? eq(agentChanges.status, q.status) : undefined))
    .orderBy(desc(agentChanges.createdAt))
    .limit(q.limit)
    .all()
  return rows.map((r) => refreshChange(ctx, r))
}

// ---------------------------------------------------------------------------------------------------------------------
// Discard and undo

/** Throw away an open change: take the agent's edits back out of the drafts. Refused if someone else has touched them since. */
export function discardChange(ctx: ServiceCtx, agent: SignedInAgent, changeId: string) {
  return inTx(ctx, () => {
    const row = requireOwnChange(ctx, agent, changeId)
    if (row.status !== 'open') throw new AppError('invalid_state', `Change ${row.id} is "${row.status}". Only an open change can be discarded. To take back something that is live, use undo_change.`, undefined, { status: row.status })
    const conflicts: string[] = []
    for (const t of changeTargets(row)) {
      if (t.type === 'page') {
        const page = requirePage(ctx, t.id)
        if (t.created) {
          binPage(ctx, agent.actor, t.id)
          continue
        }
        if (page.draftRevision !== t.revision) {
          conflicts.push(`${page.title}: it was changed by someone else after the agent's edit`)
          continue
        }
        for (const opId of [...t.opIds].reverse()) undoOp(ctx, agent.actor, t.id, opId)
      } else {
        const part = requireSitePart(ctx, t.id)
        if (part.draftRevision !== t.revision) {
          conflicts.push(`${part.label}: it was changed by someone else after the agent's edit`)
          continue
        }
        editSitePart(ctx, agent.actor, t.id, part.draftRevision, t.beforeDoc)
      }
    }
    if (conflicts.length) throw new AppError('conflict', `The change was not discarded, because ${conflicts.join('; ')}. A person can discard the draft in the builder.`, undefined, { conflicts })
    ctx.db.update(agentChanges).set({ status: 'discarded', updatedAt: iso(ctx) }).where(eq(agentChanges.id, row.id)).run()
    audit(ctx, agent.actor, 'agent.change.discarded', { type: 'agent_change', id: row.id })
    return requireChange(ctx, row.id)
  })
}

/**
 * Undo a published change. Puts each page and part back to the version that was live before it, as a new change that
 * goes through the same rules: a token publishes the undo only if a rule allows "undo_change", otherwise it goes to review.
 * An admin can undo directly. Refused if anyone has published over the change since (use a site rollback then).
 */
export function undoChange(ctx: ServiceCtx, agent: SignedInAgent, changeId: string, input: { reason: string; adminActor?: ActingAs }) {
  return inTx(ctx, () => {
    const original = refreshChange(ctx, input.adminActor ? requireChange(ctx, changeId) : requireOwnChange(ctx, agent, changeId))
    if (original.status !== 'published') {
      throw new AppError('invalid_state', original.status === 'undone' ? `Change ${original.id} was already undone.` : `Change ${original.id} is "${original.status}". Only a published change can be undone. If it is still open, use discard_change; if it is waiting for review, ask a person to send it back.`, undefined, { status: original.status })
    }
    const conflicts: string[] = []
    const targets = changeTargets(original)
    for (const t of targets) {
      const live = t.type === 'page' ? requirePage(ctx, t.id).publishedVersionId : requireSitePart(ctx, t.id).publishedVersionId
      if (live !== t.afterVersionId) conflicts.push(`${t.label}: it has been published again since this change`)
    }
    if (conflicts.length) throw new AppError('conflict', `Cannot undo change ${original.id} automatically, because ${conflicts.join('; ')}. Undoing would also remove the later work. Ask an admin to roll the site back to an earlier release (Settings > Releases), or make the edit you want as a new change.`, undefined, { conflicts })

    const undoAgent: SignedInAgent = agent
    const undoRow = createChangeRow(ctx, undoAgent, { title: `Undo: ${original.title}`, reason: input.reason, undoOf: original.id })
    const handle = new ChangeHandle(ctx, undoAgent, undoRow, [], !input.adminActor)
    const actor = input.adminActor ?? agent.actor
    for (const t of targets) {
      if (t.type === 'page') {
        if (!t.beforePublishedVersionId) throw new AppError('invalid_state', `The page "${t.label}" was created by this change, so undoing means taking it offline. Ask an admin to unpublish it from the builder.`)
        handle.touchPage(t.id, 'undo_change')
        const page = requirePage(ctx, t.id)
        const restored = restoreVersion(ctx, actor, t.id, t.beforePublishedVersionId)
        const tt = handle.pageTarget(t.id)!
        tt.revision = restored.revision
        tt.foreignDraft = tt.foreignDraft || page.draftRevision !== t.revision
      } else {
        if (!t.beforePublishedVersionId) throw new AppError('invalid_state', `The ${t.label.toLowerCase()} had no earlier live version to go back to. Ask an admin to roll the site back.`)
        const part = requireSitePart(ctx, t.id)
        const { target } = handle.touchSitePart(t.id, 'undo_change')
        target.foreignDraft = target.foreignDraft || part.draftRevision !== t.revision
        const before = readSitePartDoc(ctx, part, t.beforePublishedVersionId)
        target.revision = editSitePart(ctx, actor, t.id, part.draftRevision, before).revision
      }
    }
    handle.save()
    const row = handle.row
    const ageHours = original.publishedAt ? (ctx.now().getTime() - Date.parse(original.publishedAt)) / 3600_000 : 0
    const evaluation = evaluateTargets(ctx, agent.token, changeTargets(row), { actions: ['undo_change'], changeAgeHours: ageHours })
    const sent = sendChange(ctx, agent, row, { mode: 'publish_if_allowed', evaluation, adminActor: input.adminActor })
    return { undo: sent.change, original: requireChange(ctx, original.id), evaluation, published: sent.published }
  })
}

/** Summary of an owner and token for the admin screens. */
export function ownerName(ctx: ServiceCtx, userId: string): string {
  return ctx.db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ?? 'Someone'
}

export function violationGuard<T>(ctx: ServiceCtx, token: AgentTokenRow, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof AppError && ['rule_denied', 'never_list', 'forbidden'].includes(error.code)) recordViolation(ctx, token)
    throw error
  }
}


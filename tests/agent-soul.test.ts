// Personality proposals: a draft token can ask, and only a person can apply. Rules and always-allow never apply it.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { agentSoulProposals, auditEvents, notifications, sites } from '../server/db/schema'
import { getSite } from '../server/services/agent/gateway'
import { callOperation } from '../server/services/agent/operations'
import { authenticateAgent, enableAlwaysAllow } from '../server/services/agent/tokens'
import { createUser } from '../server/services/auth'
import { AppError } from '../server/services/errors'
import { approveSoulProposal, listSoulProposals, rejectSoulProposal } from '../server/services/soul-proposals'
import { getSoul, saveSoul } from '../server/services/soul'
import { AGENT_ACTIONS, normaliseRules } from '../shared/agent/rules'
import { readSettings } from '../shared/settings'
import { DEFAULT_SOUL, SOUL_CHAR_LIMIT, stripSoulComments } from '../shared/soul'
import { PASSWORD_FOR_TESTS, PUBLISH_ALL, addToken, code, world, type World } from './agent-helpers'

const REASON = 'The owner asked for a warmer, shorter voice.'
const MARKER = 'ZEBRA-PERSONALITY-MARKER'

const call = (w: World, name: string, input: Record<string, unknown>, agent = w.agent) => callOperation(w.ctx, agent, name, input) as any

function stored(w: World): string | null {
  return readSettings(w.ctx.db.select().from(sites).where(eq(sites.id, w.ctx.siteId)).get()!.settings).soul
}

function events(w: World, action: string) {
  return w.ctx.db.select().from(auditEvents).all().filter((e) => e.action === action)
}

async function raised(fn: () => unknown): Promise<AppError> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an error')
}

describe('proposing a personality', () => {
  it('stores a pending proposal and leaves the personality unchanged', async () => {
    const w = await world()
    const before = getSoul(w.ctx)
    const text = `Be warm and brief. ${MARKER}`
    const r = call(w, 'update_soul', { text, reason: REASON })
    expect(r).toMatchObject({
      status: 'pending',
      stripped_length: stripSoulComments(text).length,
      limit: SOUL_CHAR_LIMIT,
      superseded_proposal_id: null,
    })
    expect(r.proposal_id).toMatch(/^slp_/)
    expect(r.next_steps).toContain('A person must approve')
    expect(r.site_content_notice).toBeUndefined()
    expect(getSoul(w.ctx)).toEqual(before)
    expect(stored(w)).toBeNull()

    const proposed = events(w, 'agent.soul.proposed').at(-1)!
    expect(proposed.actorType).toBe('agent')
    expect(proposed.actorId).toBe(w.admin.id)
    expect(proposed.targetType).toBe('soul_proposal')
    expect(proposed.targetId).toBe(r.proposal_id)
    expect(proposed.details).toMatchObject({
      tokenId: w.tokenId,
      proposalId: r.proposal_id,
      strippedLength: stripSoulComments(text).length,
      reason: REASON,
      agent: { tokenId: w.tokenId, tokenName: 'Claude at 3am' },
    })
    const note = w.ctx.db.select().from(notifications).all().find((n) => n.kind === 'soul_proposal')!
    expect(note.userId).toBe(w.admin.id)
    expect(note.message).toContain('Claude at 3am')
    expect(note.message).toContain('Settings, AI personality')

    const site = call(w, 'get_site', {})
    expect(site.soul_proposal).toEqual(getSite(w.ctx, w.agent).soul_proposal)
    expect(site.soul_proposal).toMatchObject({ proposal_id: r.proposal_id, status: 'pending', stale: false, limit: SOUL_CHAR_LIMIT })
    expect(JSON.stringify(site)).not.toContain(MARKER)
    expect(site.never_list.meaning).toContain('update_soul')
    expect(site.never_list.meaning).toContain('a person must approve')
    expect(getSite(w.ctx, w.agent).soul_proposal).not.toHaveProperty('text')
  })

  it('replaces this token\'s pending proposal and leaves another token\'s alone', async () => {
    const w = await world()
    const other = addToken(w, { name: 'Other assistant', access: 'draft', rules: [] })
    const first = call(w, 'update_soul', { text: 'First voice, warm and brief.', reason: REASON })
    const theirs = call(w, 'update_soul', { text: 'The other token\'s voice.', reason: REASON }, other.agent)
    const second = call(w, 'update_soul', { text: 'Second voice, warm and brief.', reason: REASON })
    expect(second.superseded_proposal_id).toBe(first.proposal_id)
    const rows = w.ctx.db.select().from(agentSoulProposals).all()
    expect(rows.find((row) => row.id === first.proposal_id)!.status).toBe('superseded')
    expect(rows.find((row) => row.id === first.proposal_id)!.decidedBy).toBeNull()
    expect(rows.find((row) => row.id === theirs.proposal_id)!.status).toBe('pending')
    expect(rows.find((row) => row.id === second.proposal_id)!.status).toBe('pending')
    expect(events(w, 'agent.soul.proposed').at(-1)!.details).toMatchObject({ supersededProposalId: first.proposal_id })
  })

  it('accepts a long comment around a short sentence, and an empty personality', async () => {
    const w = await world()
    const commented = `<!-- ${'hidden '.repeat(5000)} --> Be warm and brief.`
    const r = call(w, 'update_soul', { text: commented, reason: REASON })
    expect(r.stripped_length).toBe('Be warm and brief.'.length)
    const empty = call(w, 'update_soul', { text: '<!-- only a note for people -->', reason: REASON })
    expect(empty.stripped_length).toBe(0)
    expect(empty.status).toBe('pending')
  })

  it('refuses a read token, a short reason, and text over either budget', async () => {
    const w = await world()
    const reader = addToken(w, { name: 'Reader', access: 'read', rules: [] })
    expect(await code(() => call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON }, reader.agent))).toBe('forbidden')
    expect(w.ctx.db.select().from(agentSoulProposals).all()).toHaveLength(0)

    expect(await code(() => call(w, 'update_soul', { text: 'Be warm and brief.', reason: 'no' }))).toBe('validation_failed')
    expect(await code(() => call(w, 'update_soul', { text: 'Be warm and brief.' }))).toBe('validation_failed')

    const raw = await raised(() => call(w, 'update_soul', { text: 'a'.repeat(200_001), reason: REASON }))
    expect(raw.code).toBe('validation_failed')
    expect(raw.message).toBe('The personality text is 200001 characters. The limit is 200,000.')

    const stripped = await raised(() => call(w, 'update_soul', { text: 'b'.repeat(48_001), reason: REASON }))
    expect(stripped.code).toBe('validation_failed')
    expect(stripped.message).toBe('The personality the AI sees is 48001 characters. The limit is 48,000. Comments are not counted.')
    expect(w.ctx.db.select().from(agentSoulProposals).all()).toHaveLength(0)
    expect(stored(w)).toBeNull()
  })
})

describe('a person decides', () => {
  it('approves onto the stored personality and records the admin and the token', async () => {
    const w = await world()
    const text = 'Be warm and brief. Use British spelling.'
    const proposed = call(w, 'update_soul', { text, reason: REASON })
    const { user } = createUser(w.ctx, { email: 'claire@example.org', name: 'Claire', role: 'admin', password: PASSWORD_FOR_TESTS })
    const claire = { id: user.id, role: user.role, isOperator: false }
    const saved = approveSoulProposal(w.ctx, w.admin, proposed.proposal_id)
    expect(saved).toMatchObject({ proposalId: proposed.proposal_id, status: 'approved', text, isDefault: false })
    expect(stored(w)).toBe(text)

    const approved = events(w, 'agent.soul.approved').at(-1)!
    expect(approved.actorType).toBe('user')
    expect(approved.actorId).toBe(w.admin.id)
    expect(approved.details).toEqual({ tokenId: w.tokenId, proposalId: proposed.proposal_id, stale: false, overwrite: false })
    const updated = events(w, 'settings.soul.updated').at(-1)!
    expect(updated.details).toMatchObject({ source: 'agent_proposal', proposalId: proposed.proposal_id, tokenId: w.tokenId, isDefault: false })

    expect(await code(() => approveSoulProposal(w.ctx, claire, proposed.proposal_id))).toBe('invalid_state')

    const again = call(w, 'update_soul', { text: DEFAULT_SOUL, reason: REASON })
    const back = approveSoulProposal(w.ctx, w.admin, again.proposal_id, { overwrite: true })
    expect(back.isDefault).toBe(true)
    expect(stored(w)).toBeNull()
    expect(events(w, 'agent.soul.approved').at(-1)!.details).toMatchObject({ overwrite: true, stale: false })

    saveSoul(w.ctx, w.admin, 'Plain and short.')
    expect(events(w, 'settings.soul.updated').at(-1)!.details).toEqual({ isDefault: false, strippedLength: 'Plain and short.'.length })
  })

  it('rejects with a note and leaves the personality unchanged', async () => {
    const w = await world()
    const proposed = call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON })
    const rejected = rejectSoulProposal(w.ctx, w.admin, proposed.proposal_id, { note: '  Not this voice.  ' })
    expect(rejected).toEqual({ proposalId: proposed.proposal_id, status: 'rejected' })
    expect(stored(w)).toBeNull()
    expect(getSoul(w.ctx).isDefault).toBe(true)
    const row = w.ctx.db.select().from(agentSoulProposals).all().find((r) => r.id === proposed.proposal_id)!
    expect(row.status).toBe('rejected')
    expect(row.decisionNote).toBe('Not this voice.')
    expect(row.decidedBy).toBe(w.admin.id)
    expect(events(w, 'agent.soul.rejected').at(-1)!.details).toEqual({ tokenId: w.tokenId, proposalId: proposed.proposal_id, note: 'Not this voice.' })
    expect(rejectSoulProposal(w.ctx, w.admin, call(w, 'update_soul', { text: 'Another voice, still brief.', reason: REASON }).proposal_id, { note: '   ' })).toMatchObject({ status: 'rejected' })
    expect(w.ctx.db.select().from(agentSoulProposals).all().find((r) => r.status === 'rejected' && r.decisionNote === null)).toBeTruthy()
  })

  it('refuses a stale proposal until overwrite is set', async () => {
    const w = await world()
    const text = `Be warm and brief. ${MARKER}`
    const proposed = call(w, 'update_soul', { text, reason: REASON })
    saveSoul(w.ctx, w.admin, 'A later personality, written by hand.')
    const stale = await raised(() => approveSoulProposal(w.ctx, w.admin, proposed.proposal_id))
    expect(stale.code).toBe('conflict')
    expect(stale.message).toContain('stale')
    expect(stale.extra).toEqual({ stale: true })
    expect(stored(w)).toBe('A later personality, written by hand.')
    expect(w.ctx.db.select().from(agentSoulProposals).all().find((r) => r.id === proposed.proposal_id)!.status).toBe('pending')
    const saved = approveSoulProposal(w.ctx, w.admin, proposed.proposal_id, { overwrite: true })
    expect(saved.text).toBe(text)
    expect(stored(w)).toBe(text)
    expect(events(w, 'agent.soul.approved').at(-1)!.details).toMatchObject({ stale: true, overwrite: true })
  })

  it('refuses an overwrite when the text changed again after the admin loaded the diff', async () => {
    const w = await world()
    const proposed = call(w, 'update_soul', { text: `Be warm and brief. ${MARKER}`, reason: REASON })
    saveSoul(w.ctx, w.admin, 'First hand edit.')
    const seen = listSoulProposals(w.ctx, w.admin)
    expect(seen.currentText).toBe('First hand edit.')
    saveSoul(w.ctx, w.admin, 'Second hand edit.')
    const again = await raised(() => approveSoulProposal(w.ctx, w.admin, proposed.proposal_id, { overwrite: true, currentHash: seen.currentHash }))
    expect(again.code).toBe('conflict')
    expect(stored(w)).toBe('Second hand edit.')
    const fresh = listSoulProposals(w.ctx, w.admin)
    approveSoulProposal(w.ctx, w.admin, proposed.proposal_id, { overwrite: true, currentHash: fresh.currentHash })
    expect(stored(w)).toBe(`Be warm and brief. ${MARKER}`)
  })

  it('refuses an over-budget proposal at approval and leaves it pending', async () => {
    const w = await world()
    const proposed = call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON })
    w.ctx.db.update(agentSoulProposals).set({ text: 'a'.repeat(48_001) }).where(eq(agentSoulProposals.id, proposed.proposal_id)).run()
    const error = await raised(() => approveSoulProposal(w.ctx, w.admin, proposed.proposal_id))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('48,000')
    expect(error.message).toContain('48001')
    expect(w.ctx.db.select().from(agentSoulProposals).all().find((r) => r.id === proposed.proposal_id)!.status).toBe('pending')
    expect(stored(w)).toBeNull()
  })

  it('lists pending text and only the 20 newest decided rows', async () => {
    const w = await world()
    for (let i = 0; i < 21; i++) {
      w.clock.advance(1000)
      const proposed = call(w, 'update_soul', { text: `Voice ${i} is warm and brief.`, reason: `Please use voice ${i} today.` })
      rejectSoulProposal(w.ctx, w.admin, proposed.proposal_id, { note: `no ${i}` })
    }
    w.clock.advance(1000)
    const pending = call(w, 'update_soul', { text: 'The one still waiting.', reason: REASON })
    const list = listSoulProposals(w.ctx, w.admin)
    const open = list.proposals.filter((p) => p.status === 'pending')
    const decided = list.proposals.filter((p) => p.status !== 'pending')
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ id: pending.proposal_id, text: 'The one still waiting.', tokenId: w.tokenId })
    expect(decided).toHaveLength(20)
    expect(decided.every((p) => !('text' in p) && p.strippedLength > 0)).toBe(true)
    expect(decided.some((p) => p.reason === 'Please use voice 0 today.')).toBe(false)
    expect(decided.some((p) => p.reason === 'Please use voice 20 today.')).toBe(true)
  })

  it('refuses an editor, an approver, an AI session and an agent', async () => {
    const w = await world()
    const proposed = call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON })
    for (const actor of [w.editor, w.approver, { ...w.admin, aiSessionId: 'ais_test' }, w.agent.actor]) {
      expect(await code(() => listSoulProposals(w.ctx, actor)), actor.role).toBe('forbidden')
      expect(await code(() => approveSoulProposal(w.ctx, actor, proposed.proposal_id))).toBe('forbidden')
      expect(await code(() => rejectSoulProposal(w.ctx, actor, proposed.proposal_id, { note: 'no' }))).toBe('forbidden')
    }
    expect(w.ctx.db.select().from(agentSoulProposals).all()[0]!.status).toBe('pending')
    expect(stored(w)).toBeNull()
  })
})

describe('rules and always-allow cannot apply it', () => {
  it('has no approve tool and is not a rule action', async () => {
    const w = await world()
    expect(await code(() => call(w, 'approve_soul', {}))).toBe('not_found')
    expect((AGENT_ACTIONS as readonly string[]).includes('update_soul')).toBe(false)
    expect(normaliseRules([{ label: 'Personality', actions: ['update_soul'], result: 'publish' }]).ok).toBe(false)
  })

  it('stays pending under publish-all rules and permanent always-allow', async () => {
    const w = await world(PUBLISH_ALL)
    enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { permanent: true, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    const agent = authenticateAgent(w.ctx, w.secret, null)
    const r = call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON }, agent)
    expect(r.status).toBe('pending')
    expect(stored(w)).toBeNull()
    expect(w.ctx.db.select().from(agentSoulProposals).all()[0]!.status).toBe('pending')
    expect(getSite(w.ctx, agent).you.always_allow).toEqual({ permanent: true, until: null })
  })

  it('refuses a deny rule with actions "*" and saves nothing', async () => {
    const w = await world([{ label: 'Nothing', actions: '*', result: 'deny' }])
    const error = await raised(() => call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON }))
    expect(error.code).toBe('rule_denied')
    expect(error.message).toContain('Nothing')
    expect(error.extra).toMatchObject({ ruleId: expect.any(String) })
    expect(w.ctx.db.select().from(agentSoulProposals).all()).toHaveLength(0)
    expect(getSoul(w.ctx).isDefault).toBe(true)
  })

  it('does not let a menu-scoped deny of every action block a proposal', async () => {
    const w = await world([{ label: 'Hands off the menu', actions: '*', targets: { siteParts: ['menu'] }, result: 'deny' }])
    call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON })
    expect(w.ctx.db.select().from(agentSoulProposals).all()).toHaveLength(1)
    expect(getSoul(w.ctx).isDefault).toBe(true)
  })

  it('does not treat a narrower deny rule as a block', async () => {
    const w = await world([{ label: 'No wording', actions: ['edit_text'], result: 'deny' }])
    const r = call(w, 'update_soul', { text: 'Be warm and brief.', reason: REASON })
    expect(r.status).toBe('pending')
    expect(w.ctx.db.select().from(agentSoulProposals).all()).toHaveLength(1)
  })
})

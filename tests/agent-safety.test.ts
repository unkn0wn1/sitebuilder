import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { agentCalls, agentTokens, auditEvents, reviews } from '../server/db/schema'
import { callOperation } from '../server/services/agent/operations'
import * as G from '../server/services/agent/gateway'
import { adminUndoChange } from '../server/services/agent/admin'
import { authenticateAgent, createAgentToken, enableAlwaysAllow, revokeAgentToken, setAgentsPaused, updateAgentToken } from '../server/services/agent/tokens'
import { applyPageOps, getPage, readDoc, requirePage } from '../server/services/pages'
import { approveReview, sendBackReview, submitPage } from '../server/services/reviews'
import { createSitePart } from '../server/services/site-parts'
import { PASSWORD_FOR_TESTS } from './agent-helpers'
import { PUBLISH_ALL, SIGNUP, addToken, code, drain, world, type World } from './agent-helpers'
import { EMB, IMG } from './helpers'

const call = (w: World, name: string, input: Record<string, unknown>, agent = w.agent) => callOperation(w.ctx, agent, name, input) as any
const REASON = 'Testing the agent gateway'
const live = (w: World) => JSON.stringify(readDoc(w.ctx, requirePage(w.ctx, w.pageId).publishedVersionId!))
const draft = (w: World) => JSON.stringify(readDoc(w.ctx, requirePage(w.ctx, w.pageId).draftVersionId!))
const removeAll = (w: World, agent = w.agent, extra: Record<string, unknown> = {}) => call(w, 'remove_link', { url: SIGNUP, everywhere: true, skip_unremovable: false, reason: REASON, ...extra }, agent)

describe('tokens', () => {
  it('stores only a hash, and signs in with the secret', async () => {
    const w = await world()
    expect(w.secret).toMatch(/^sbt_/)
    const rows = w.ctx.db.select().from(agentTokens).all()
    expect(JSON.stringify(rows)).not.toContain(w.secret)
    expect(rows[0]!.secretHash).toMatch(/^[0-9a-f]{64}$/)
    expect(authenticateAgent(w.ctx, w.secret, '203.0.113.9').token.id).toBe(w.tokenId)
  })

  it('refuses wrong, revoked, expired and paused tokens, and addresses that are not allowed', async () => {
    const w = await world()
    expect(await code(() => authenticateAgent(w.ctx, null, null))).toBe('unauthenticated')
    expect(await code(() => authenticateAgent(w.ctx, 'sbt_nonsense', null))).toBe('unauthenticated')
    expect(await code(() => authenticateAgent(w.ctx, w.secret.replace(/.$/, 'x'), null))).toBe('unauthenticated')

    const ip = createAgentToken(w.ctx, w.admin, { name: 'Office only', access: 'read', ipAllow: ['203.0.113.0/24'] })
    expect(authenticateAgent(w.ctx, ip.secret, '203.0.113.50').token.id).toBe(ip.token.id)
    expect(await code(() => authenticateAgent(w.ctx, ip.secret, '198.51.100.1'))).toBe('forbidden')
    expect(await code(() => authenticateAgent(w.ctx, ip.secret, null))).toBe('forbidden')

    const short = addToken(w, { name: 'Short', access: 'read', expiresAt: new Date(w.clock.t + 3600_000).toISOString() })
    authenticateAgent(w.ctx, short.secret, null)
    w.clock.advance(2 * 3600_000)
    expect(await code(() => authenticateAgent(w.ctx, short.secret, null))).toBe('unauthenticated')

    updateAgentToken(w.ctx, w.admin, w.tokenId, { status: 'paused' })
    expect(await code(() => authenticateAgent(w.ctx, w.secret, null))).toBe('agent_paused')
    updateAgentToken(w.ctx, w.admin, w.tokenId, { status: 'active' })
    authenticateAgent(w.ctx, w.secret, null)

    setAgentsPaused(w.ctx, w.admin, true)
    expect(await code(() => authenticateAgent(w.ctx, w.secret, null))).toBe('agent_paused')
    setAgentsPaused(w.ctx, w.admin, false)

    revokeAgentToken(w.ctx, w.admin, w.tokenId)
    expect(await code(() => authenticateAgent(w.ctx, w.secret, null))).toBe('unauthenticated')
  })

  it('lets only admins manage tokens, and never a token', async () => {
    const w = await world()
    expect(await code(() => createAgentToken(w.ctx, w.editor, { name: 'x' }))).toBe('forbidden')
    expect(await code(() => createAgentToken(w.ctx, w.agent.actor, { name: 'x' }))).toBe('forbidden')
    expect(await code(() => createAgentToken(w.ctx, w.admin, { name: 'bad rules', rules: [{ label: 'x', actions: ['nope'], result: 'publish' }] }))).toBe('validation_failed')
    expect(await code(() => createAgentToken(w.ctx, w.admin, { name: 'bad ip', ipAllow: ['not-an-ip'] }))).toBe('validation_failed')
  })

  it('needs the site name and the admin password for always-allow, and it expires', async () => {
    const w = await world([])
    expect(await code(() => enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 1, siteName: 'Wrong', password: PASSWORD_FOR_TESTS }))).toBe('validation_failed')
    expect(await code(() => enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 1, siteName: 'Test charity', password: 'not it' }))).toBe('forbidden')
    expect(await code(() => enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 9, siteName: 'Test charity', password: PASSWORD_FOR_TESTS }))).toBe('validation_failed')
    enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 1, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    const agent = authenticateAgent(w.ctx, w.secret, null)
    const r = removeAll(w, agent)
    expect(r.if_you_publish.outcome).toBe('goes_live')
    expect(r.if_you_publish.always_allow).toBe(true)
    w.clock.advance(25 * 3600_000)
    expect(call(w, 'preview_change', { change_id: r.change.id }, authenticateAgent(w.ctx, w.secret, null)).if_you_publish.outcome).toBe('goes_to_review')
  })
})

describe('draft first, live only by rule or by a person', () => {
  it('keeps live untouched until published, and sends to a person when no rule allows', async () => {
    const w = await world([])
    const r = removeAll(w)
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(live(w)).toContain(SIGNUP)
    expect(draft(w)).not.toContain(SIGNUP)
    const p = call(w, 'publish_change', { change_id: r.change.id })
    expect(p.result).toMatchObject({ published: false, sent_for_review: true })
    expect(p.change.status).toBe('review')
    expect(live(w)).toContain(SIGNUP)

    // A person approves.
    const review = w.ctx.db.select().from(reviews).all().find((x) => x.state === 'pending' && x.targetId === w.pageId)!
    expect(review.note).toMatch(/Sent by agent "Claude at 3am"/)
    approveReview(w.ctx, w.approver, review.id, { versionId: review.versionId })
    const menuReview = w.ctx.db.select().from(reviews).all().find((x) => x.state === 'pending' && x.targetType === 'site_part')!
    approveReview(w.ctx, w.approver, menuReview.id, { versionId: menuReview.versionId })
    await drain(w)
    expect(call(w, 'get_change', { change_id: r.change.id }).change.status).toBe('published')
    expect(live(w)).not.toContain(SIGNUP)
  })

  it('returns a change to open with the reviewer feedback when it is sent back', async () => {
    const w = await world([])
    const r = removeAll(w)
    call(w, 'request_publish', { change_id: r.change.id, note: 'Please check' })
    const review = w.ctx.db.select().from(reviews).all().find((x) => x.state === 'pending' && x.targetId === w.pageId)!
    sendBackReview(w.ctx, w.approver, review.id, 'Keep the menu item')
    const again = call(w, 'get_change', { change_id: r.change.id })
    expect(again.change.status).toBe('open')
    expect(again.feedback_from_reviewer).toBe('Keep the menu item')
  })

  it('records approval by rule in the audit log and on the review', async () => {
    const w = await world()
    const r = removeAll(w)
    call(w, 'publish_change', { change_id: r.change.id })
    const rv = w.ctx.db.select().from(reviews).all().filter((x) => x.decisionComment?.startsWith('Approved by rule'))
    expect(rv.length).toBe(2)
    expect(rv[0]!.decidedBy).toBe(`agent:${w.tokenId}`)
    const actions = w.ctx.db.select().from(auditEvents).all().map((e) => e.action)
    expect(actions).toContain('review.approved_by_rule')
    expect(actions).toContain('agent.change.edited')
  })

  it('cannot edit a page that is waiting for a person, unless asked to skip it', async () => {
    const w = await world()
    applyPageOps(w.ctx, w.editor, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'set_seo', description: 'Changed by a person' }])
    submitPage(w.ctx, w.editor, w.pageId)
    expect(await code(() => removeAll(w))).toBe('invalid_state')
    const r = removeAll(w, w.agent, { skip_blocked: true })
    expect(r.result.skipped.length).toBe(1)
    expect(r.change.targets.map((t: any) => t.type)).toEqual(['site_part'])
  })

  it('will not let a rule publish over someone else’s unpublished work', async () => {
    const w = await world(PUBLISH_ALL)
    applyPageOps(w.ctx, w.editor, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'set_seo', description: 'Half-finished edit by a person' }])
    const r = removeAll(w)
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(r.if_you_publish.reasons.join(' ')).toMatch(/unpublished changes/)
  })

  it('does not publish a change whose pages fail the submission checks', async () => {
    const w = await world(PUBLISH_ALL)
    const r = call(w, 'edit_component', { page_id: w.pageId, block_id: readDoc(w.ctx, requirePage(w.ctx, w.pageId).draftVersionId!).blocks.find((b) => b.type === 'Hero')!.id, props: { image: { media: IMG.media } }, reason: REASON })
    expect(r.problems_to_fix.length).toBeGreaterThan(0)
    expect(await code(() => call(w, 'publish_change', { change_id: r.change.id }))).toBe('validation_failed')
  })
})

describe('the never-list and the floor', () => {
  it('refuses donation forms, embeds and bound props, and says it is final', async () => {
    const w = await world(PUBLISH_ALL)
    expect(await code(() => call(w, 'add_component', { path: '/events', type: 'DonationEmbed', props: { embed: EMB }, reason: REASON }))).toBe('never_list')
    expect(await code(() => call(w, 'add_component', { path: '/events', type: 'Embed', props: {}, reason: REASON }))).toBe('never_list')
    expect(await code(() => call(w, 'create_page', { title: 'X', page_type: 'standard', sections: [{ type: 'DonationEmbed', props: { embed: EMB } }], reason: REASON }))).toBe('never_list')
    const hero = readDoc(w.ctx, requirePage(w.ctx, w.pageId).draftVersionId!).blocks.find((b) => b.type === 'Hero')!
    expect(await code(() => call(w, 'edit_component', { page_id: w.pageId, block_id: hero.id, props: { campaignId: 'c1' }, reason: REASON }))).toBe('never_list')
    expect(await code(() => call(w, 'edit_component', { page_id: w.pageId, block_id: hero.id, props: {}, unset: ['source'], reason: REASON }))).toBe('never_list')
    expect(draft(w)).toBe(JSON.stringify(readDoc(w.ctx, requirePage(w.ctx, w.pageId).draftVersionId!)))
  })

  it('pauses the token after three blocked attempts in ten minutes, and tells the owner', async () => {
    const w = await world(PUBLISH_ALL)
    for (let i = 0; i < 3; i++) expect(await code(() => call(w, 'add_component', { path: '/events', type: 'Embed', props: {}, reason: REASON }))).toBe('never_list')
    expect(w.ctx.db.select().from(agentCalls).all().filter((c) => c.kind === 'violation')).toHaveLength(3)
    expect(w.ctx.db.select().from(agentTokens).where(eq(agentTokens.id, w.tokenId)).get()!.status).toBe('paused')
    expect(await code(() => authenticateAgent(w.ctx, w.secret, null))).toBe('agent_paused')
    const actions = w.ctx.db.select().from(auditEvents).all().map((e) => e.action)
    expect(actions).toContain('agent.token.auto_paused')
    expect(actions.filter((a) => a === 'agent.call.blocked')).toHaveLength(3)
  })

  it('lets a money section be drafted but never auto-published, even with always-allow', async () => {
    const w = await world(PUBLISH_ALL)
    enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 1, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    const agent = authenticateAgent(w.ctx, w.secret, null)
    const r = call(w, 'add_component', { path: '/events', type: 'MatchBanner', props: w.ctx.registry.get('MatchBanner')!.sample, reason: REASON }, agent)
    expect(r.change.status).toBe('open')
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(r.if_you_publish.reasons.join(' ')).toMatch(/money section/)
  })

  it('honours a deny rule before any draft is made', async () => {
    const w = await world([...PUBLISH_ALL, { label: 'Hands off the menu', actions: '*', targets: { siteParts: ['menu'] }, result: 'deny' }])
    expect(await code(() => removeAll(w))).toBe('rule_denied')
    expect(w.ctx.db.select().from(agentCalls).all().filter((c) => c.kind === 'violation')).toHaveLength(1)
    const onePage = call(w, 'remove_link', { url: SIGNUP, path: '/events', reason: REASON })
    expect(onePage.if_you_publish.outcome).toBe('goes_live')
  })

  it('keeps a read-only token read-only', async () => {
    const w = await world()
    const ro = addToken(w, { name: 'Reader', access: 'read' })
    expect(call(w, 'find_links', { url: SIGNUP }, ro.agent).total).toBe(3)
    expect(await code(() => removeAll(w, ro.agent))).toBe('forbidden')
    expect(await code(() => call(w, 'publish_change', { change_id: 'chg_x' }, ro.agent))).toBe('forbidden')
  })
})

describe('limits', () => {
  it('rate limits edits and says how long to wait', async () => {
    const w = await world(PUBLISH_ALL)
    createSitePart(w.ctx, 'banner', 'main', 'Banner')
    const t = addToken(w, { name: 'Slow', access: 'draft', rules: PUBLISH_ALL, limits: { writePerMinute: 2 } })
    call(w, 'set_banner', { message: 'one', reason: REASON }, t.agent)
    call(w, 'set_banner', { message: 'two', reason: REASON }, t.agent)
    const e = await code(() => call(w, 'set_banner', { message: 'three', reason: REASON }, t.agent))
    expect(e).toBe('rate_limited')
    w.clock.advance(61_000)
    call(w, 'set_banner', { message: 'three', reason: REASON }, t.agent)
  })

  it('limits publishes per hour', async () => {
    const w = await world()
    const t = addToken(w, { name: 'One an hour', access: 'draft', rules: PUBLISH_ALL, limits: { publishPerHour: 1 } })
    const a = call(w, 'edit_text', { find: 'Events', replace: 'Our events', path: '/events', reason: REASON }, t.agent)
    expect(call(w, 'publish_change', { change_id: a.change.id }, t.agent).result.published).toBe(true)
    await drain(w)
    const b = call(w, 'edit_text', { find: 'Our events', replace: 'Events', path: '/events', reason: REASON }, t.agent)
    expect(await code(() => call(w, 'publish_change', { change_id: b.change.id }, t.agent))).toBe('rate_limited')
  })
})

describe('undo and discard', () => {
  it('discards an open change and leaves the page as it was', async () => {
    const w = await world()
    const before = draft(w)
    const r = removeAll(w)
    expect(draft(w)).not.toContain(SIGNUP)
    const d = call(w, 'discard_change', { change_id: r.change.id })
    expect(d.change.status).toBe('discarded')
    expect(draft(w)).toBe(before)
    expect(await code(() => call(w, 'publish_change', { change_id: r.change.id }))).toBe('invalid_state')
    expect(await code(() => call(w, 'edit_text', { find: 'Events', replace: 'x', path: '/events', change_id: r.change.id, reason: REASON }))).toBe('invalid_state')
  })

  it('will not discard over a person’s later edit', async () => {
    const w = await world()
    const r = removeAll(w)
    applyPageOps(w.ctx, w.editor, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'set_seo', description: 'A person edited after the agent' }])
    expect(await code(() => call(w, 'discard_change', { change_id: r.change.id }))).toBe('conflict')
  })

  it('undoes a published change when a rule allows undo, and restores the menu too', async () => {
    const w = await world([...PUBLISH_ALL])
    const r = removeAll(w)
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    expect(live(w)).not.toContain(SIGNUP)
    const u = call(w, 'undo_change', { change_id: r.change.id, reason: 'The event is back on' })
    expect(u.result.undo_goes_live).toBe(true)
    await drain(w)
    expect(live(w)).toContain(SIGNUP)
    expect(call(w, 'get_change', { change_id: r.change.id }).change.status).toBe('undone')
    expect(call(w, 'find_links', { url: SIGNUP }).total).toBe(3)
    expect(await code(() => call(w, 'undo_change', { change_id: r.change.id, reason: 'Again please' }))).toBe('invalid_state')
  })

  it('sends an undo to a person when the token has no undo rule, and an admin can undo in one step', async () => {
    const w = await world([{ label: 'Links', actions: ['remove_link'], result: 'publish' }])
    const r = removeAll(w)
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    const u = call(w, 'undo_change', { change_id: r.change.id, reason: 'The event is back on' })
    expect(u.result.undo_sent_for_review).toBe(true)
    expect(live(w)).not.toContain(SIGNUP)
  })

  it('lets an admin undo straight away, whatever the token’s rules', async () => {
    const w = await world([{ label: 'Links', actions: ['remove_link'], result: 'publish' }])
    const r = removeAll(w)
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    const out = adminUndoChange(w.ctx, w.admin, r.change.id, 'Claire asked for it back')
    expect(out.published).toBe(true)
    await drain(w)
    expect(live(w)).toContain(SIGNUP)
    expect(call(w, 'get_change', { change_id: r.change.id }).change.status).toBe('undone')
    expect(await code(() => adminUndoChange(w.ctx, w.editor, r.change.id, 'No permission here'))).toBe('forbidden')
  })

  it('refuses to undo over later published work', async () => {
    const w = await world(PUBLISH_ALL)
    const r = removeAll(w)
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    const later = call(w, 'edit_text', { find: 'Events', replace: 'Our events', path: '/events', reason: REASON })
    call(w, 'publish_change', { change_id: later.change.id })
    await drain(w)
    expect(await code(() => call(w, 'undo_change', { change_id: r.change.id, reason: 'Put it back' }))).toBe('conflict')
  })

  it('shows a token only its own changes', async () => {
    const w = await world()
    const r = removeAll(w)
    const other = addToken(w, { name: 'Another', access: 'draft' })
    expect(await code(() => call(w, 'get_change', { change_id: r.change.id }, other.agent))).toBe('not_found')
    expect(call(w, 'list_changes', {}, other.agent).changes).toHaveLength(0)
    expect(call(w, 'list_changes', {}).changes).toHaveLength(1)
  })
})

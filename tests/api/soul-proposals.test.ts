// Personality proposals over HTTP. Own server: the shared API server does not turn the gateway on.
// The orchestrator runs this file (npm run test:api). It is not part of the unit vitest run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from './client'
import { ADMIN_EMAIL, PASSWORD, lastEmail, startServer, tokenFrom, type TestServer } from './server'

let server: TestServer
let admin: Client
let editor: Client
let siteName = ''
let draftSecret = ''
let draftId = ''
let readSecret = ''
let denySecret = ''
let denyId = ''
let publishSecret = ''
let publishId = ''

const MARKER = 'ZEBRA-PERSONALITY-MARKER'
const REASON = 'The owner asked for a warmer, shorter voice.'

const agent = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
  fetch(`${server.baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${init.token ?? draftSecret}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const rest = (path: string, init?: Parameters<typeof agent>[1]) => agent(`/agent/v1${path}`, init).then(json)
const mcp = async (token: string, name: string, args: unknown) =>
  json(await agent('/agent/mcp', { method: 'POST', token, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } }))

async function resetSoul() {
  const current = await admin.get('/settings/soul')
  if (!current.body.isDefault) expect((await admin.put('/settings/soul', { text: current.body.defaultText })).status).toBe(200)
}

beforeAll(async () => {
  server = await startServer({ SITEBUILDER_AGENT_GATEWAY: '1' })
  admin = new Client(server.baseUrl)
  await admin.login(ADMIN_EMAIL, PASSWORD)
  siteName = (await admin.get('/auth/me')).body.site.name
  const invite = await admin.post('/users', { email: 'editor@example.org', name: 'Asha', role: 'editor' })
  expect(invite.status).toBe(200)
  let token = ''
  for (let i = 0; i < 100 && !token; i++) {
    await new Promise((res) => setTimeout(res, 100))
    try {
      token = tokenFrom(lastEmail(server.outbox, 'editor@example.org').text)
    } catch {}
  }
  expect(token).toBeTruthy()
  expect((await new Client(server.baseUrl).post('/auth/invite/accept', { token, name: 'Asha', password: PASSWORD })).status).toBe(200)
  editor = new Client(server.baseUrl)
  await editor.login('editor@example.org', PASSWORD)

  const draft = await admin.post('/agent/tokens', { name: 'Drafter', access: 'draft', rules: [] })
  draftSecret = draft.body.secret
  draftId = draft.body.token.id
  const reader = await admin.post('/agent/tokens', { name: 'Reader', access: 'read', rules: [] })
  readSecret = reader.body.secret
  const deny = await admin.post('/agent/tokens', { name: 'Deny all', access: 'draft', rules: [{ label: 'Nothing', actions: '*', result: 'deny' }] })
  denySecret = deny.body.secret
  denyId = deny.body.token.id
  const publisher = await admin.post('/agent/tokens', { name: 'Publisher', access: 'draft', rules: [{ label: 'Everything', actions: '*', result: 'publish' }] })
  publishSecret = publisher.body.secret
  publishId = publisher.body.token.id
})

afterAll(async () => {
  await server?.stop()
})

describe('update_soul over the gateway', () => {
  it('proposes over REST and MCP and does not change the personality or return the text on get_site', async () => {
    await resetSoul()
    const before = await admin.get('/settings/soul')
    const proposed = await rest('/soul', { method: 'POST', body: { text: `Be warm and brief. ${MARKER}`, reason: REASON } })
    expect(proposed.status).toBe(200)
    expect(proposed.body).toMatchObject({ status: 'pending', superseded_proposal_id: null })
    expect(proposed.body.proposal_id).toMatch(/^slp_/)
    expect((await admin.get('/settings/soul')).body.text).toBe(before.body.text)

    const viaMcp = await mcp(draftSecret, 'update_soul', { text: 'Be warm and brief over MCP.', reason: REASON })
    expect(viaMcp.status).toBe(200)
    expect(viaMcp.body.result.isError).toBe(false)
    expect(viaMcp.body.result.structuredContent).toMatchObject({ status: 'pending', superseded_proposal_id: proposed.body.proposal_id })

    const site = await rest('/site')
    expect(site.body.soul_proposal).toMatchObject({ proposal_id: viaMcp.body.result.structuredContent.proposal_id, status: 'pending' })
    expect(JSON.stringify(site.body)).not.toContain(MARKER)
    expect(JSON.stringify(site.body)).not.toContain('Be warm and brief over MCP.')
  })

  it('refuses a read token, a short reason, text over the budgets, and a deny-all token', async () => {
    const read = await rest('/soul', { method: 'POST', token: readSecret, body: { text: 'Be warm and brief.', reason: REASON } })
    expect(read.status).toBe(403)
    expect(read.body.error.code).toBe('forbidden')

    const short = await rest('/soul', { method: 'POST', body: { text: 'Be warm and brief.', reason: 'no' } })
    expect(short.status).toBe(400)
    expect(short.body.error.code).toBe('validation_failed')

    const raw = await rest('/soul', { method: 'POST', body: { text: 'a'.repeat(200_001), reason: REASON } })
    expect(raw.status).toBe(400)
    expect(raw.body.error.message).toContain('200001')
    expect(raw.body.error.message).toContain('200,000')

    const stripped = await rest('/soul', { method: 'POST', body: { text: 'b'.repeat(48_001), reason: REASON } })
    expect(stripped.status).toBe(400)
    expect(stripped.body.error.message).toContain('48001')
    expect(stripped.body.error.message).toContain('48,000')

    const denied = await rest('/soul', { method: 'POST', token: denySecret, body: { text: 'Be warm and brief.', reason: REASON } })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('rule_denied')
    const list = await admin.get('/settings/soul/proposals')
    expect(list.body.proposals.filter((p: { tokenId: string }) => p.tokenId === denyId)).toHaveLength(0)
  })
})

describe('admin decisions', () => {
  it('approves, audits the token and the admin, and omits the text once decided', async () => {
    await resetSoul()
    const proposed = await rest('/soul', { method: 'POST', body: { text: 'Be warm and brief. Use British spelling.', reason: REASON } })
    const id = proposed.body.proposal_id as string
    const open = await admin.get('/settings/soul/proposals')
    expect(open.body.proposals.find((p: { id: string }) => p.id === id).text).toContain('British spelling')

    const approved = await admin.post(`/settings/soul/proposals/${id}/approve`, {})
    expect(approved.status).toBe(200)
    expect(approved.body).toMatchObject({ proposalId: id, status: 'approved', isDefault: false })
    expect((await admin.get('/settings/soul')).body.text).toBe('Be warm and brief. Use British spelling.')

    const me = await admin.get('/auth/me')
    const audit = await admin.get('/audit?pageSize=100')
    const proposedEvent = audit.body.items.find((e: { action: string; details?: { proposalId?: string } }) => e.action === 'agent.soul.proposed' && e.details?.proposalId === id)
    const approvedEvent = audit.body.items.find((e: { action: string; details?: { proposalId?: string } }) => e.action === 'agent.soul.approved' && e.details?.proposalId === id)
    expect(proposedEvent.actorType).toBe('agent')
    expect(proposedEvent.details.tokenId).toBe(draftId)
    expect(proposedEvent.details.agent.tokenId).toBe(draftId)
    expect(approvedEvent.actorType).toBe('user')
    expect(approvedEvent.actorId).toBe(me.body.user.id)
    expect(audit.body.items.find((e: { action: string; details?: { proposalId?: string; source?: string } }) => e.action === 'settings.soul.updated' && e.details?.proposalId === id).details.source).toBe('agent_proposal')

    const decided = await admin.get('/settings/soul/proposals')
    const row = decided.body.proposals.find((p: { id: string }) => p.id === id)
    expect(row.status).toBe('approved')
    expect(row.text).toBeUndefined()
    await resetSoul()
  })

  it('rejects and leaves the personality unchanged', async () => {
    await resetSoul()
    const before = await admin.get('/settings/soul')
    const proposed = await rest('/soul', { method: 'POST', token: publishSecret, body: { text: 'A voice to reject.', reason: REASON } })
    const rejected = await admin.post(`/settings/soul/proposals/${proposed.body.proposal_id}/reject`, { note: '  Not this one.  ' })
    expect(rejected.status).toBe(200)
    expect(rejected.body).toEqual({ proposalId: proposed.body.proposal_id, status: 'rejected' })
    expect((await admin.get('/settings/soul')).body.text).toBe(before.body.text)
  })

  it('refuses a stale proposal, then applies it with overwrite', async () => {
    await resetSoul()
    const proposed = await rest('/soul', { method: 'POST', body: { text: `Warm and brief. ${MARKER}`, reason: REASON } })
    expect((await admin.put('/settings/soul', { text: 'A later personality written by hand.' })).status).toBe(200)
    const stale = await admin.post(`/settings/soul/proposals/${proposed.body.proposal_id}/approve`, {})
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('conflict')
    expect(stale.body.error.stale).toBe(true)
    expect(stale.body.error.message).toContain('stale')
    expect((await admin.get('/settings/soul')).body.text).toBe('A later personality written by hand.')
    const overwritten = await admin.post(`/settings/soul/proposals/${proposed.body.proposal_id}/approve`, { overwrite: true })
    expect(overwritten.status).toBe(200)
    expect(overwritten.body.text).toContain(MARKER)
    await resetSoul()
  })

  it('leaves a publish-all always-allow token pending until an admin approves', async () => {
    await resetSoul()
    expect(siteName).toBe('Example charity')
    const on = await admin.post(`/agent/tokens/${publishId}/always-allow`, { permanent: true, siteName, password: PASSWORD })
    expect(on.status).toBe(200)
    const proposed = await rest('/soul', { method: 'POST', token: publishSecret, body: { text: 'Always-allow must not apply this voice.', reason: REASON } })
    expect(proposed.status).toBe(200)
    expect(proposed.body.status).toBe('pending')
    expect((await admin.get('/settings/soul')).body.isDefault).toBe(true)
    const approved = await admin.post(`/settings/soul/proposals/${proposed.body.proposal_id}/approve`, {})
    expect(approved.status).toBe(200)
    expect((await admin.get('/settings/soul')).body.text).toBe('Always-allow must not apply this voice.')
    await resetSoul()
  })

  it('refuses an editor, and a bearer token on the admin route', async () => {
    expect((await editor.get('/settings/soul/proposals')).status).toBe(403)
    expect((await editor.post('/settings/soul/proposals/slp_missing/approve', {})).status).toBe(403)
    expect((await editor.post('/settings/soul/proposals/slp_missing/reject', {})).status).toBe(403)
    const bearer = await fetch(`${server.baseUrl}/api/v1/settings/soul/proposals/slp_missing/approve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${draftSecret}`, 'content-type': 'application/json', origin: server.baseUrl },
      body: '{}',
    })
    expect(bearer.status).toBe(401)
  })
})

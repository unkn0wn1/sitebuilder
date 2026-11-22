import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from './client'
import { ADMIN_EMAIL, PASSWORD, startServer, type TestServer } from './server'
import { RULE_PRESETS } from '../../shared/agent/presets'

// The agent gateway over real HTTP: REST, MCP, tokens, the admin screens' API, and Cloudflare Access bypass.
let server: TestServer
let admin: Client
let secret = ''
let tokenId = ''
let pageId = ''
const LINK = 'https://old-partner.example.org/signup'
const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'text', text: text, marks: [{ type: 'link', href: LINK }] }, { type: 'text', text: ' now.' }] }] })

const agent = (path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) =>
  fetch(`${server.baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? secret}` }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers })
const rest = async (path: string, init?: Parameters<typeof agent>[1]) => json(await agent(`/agent/v1${path}`, init))
const mcp = async (method: string, params?: unknown, id: number | null = 1) => json(await agent('/agent/mcp', { method: 'POST', body: { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params } }))
const tool = async (name: string, args: unknown = {}) => (await mcp('tools/call', { name, arguments: args })).body.result

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  let v = await fn()
  for (let i = 0; i < 60 && !ok(v); i++) {
    await new Promise((r) => setTimeout(r, 200))
    v = await fn()
  }
  return v
}

beforeAll(async () => {
  server = await startServer({ SITEBUILDER_AGENT_GATEWAY: '1' })
  admin = new Client(server.baseUrl)
  await admin.login(ADMIN_EMAIL, PASSWORD)
  expect((await admin.patch('/settings', { workflow: { selfApproval: true } })).status).toBe(200)
  const created = await admin.post('/pages', { title: 'Partners', template: 'standard' })
  pageId = created.body.page.id
  const e = await admin.post(`/pages/${pageId}/ops`, { baseRevision: 0, ops: [{ op: 'set_seo', description: 'Our partners' }, { op: 'add_block', block: { type: 'RichText', props: { content: para('our partner') } } }] })
  expect(e.status).toBe(200)
  const sub = await admin.post(`/pages/${pageId}/submit`, {})
  const ok = await admin.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: sub.body.versionId })
  expect((await admin.job(ok.body.jobId)).state).toBe('done')
})
afterAll(async () => {
  await server?.stop()
})

describe('the gateway is off unless switched on', () => {
  it('answers 404 on a default install', async () => {
    const off = await startServer({}, { seed: true })
    try {
      const r = await fetch(`${off.baseUrl}/agent/v1/site`, { headers: { authorization: 'Bearer sbt_x' } })
      expect(r.status).toBe(404)
      expect((await fetch(`${off.baseUrl}/agent/mcp`, { method: 'POST', body: '{}' })).status).toBe(404)
    } finally {
      await off.stop()
    }
  })
})

describe('tokens and the admin API', () => {
  it('makes a token, shows the secret once, and never lists it', async () => {
    const preset = RULE_PRESETS.find((p) => p.key === 'takedown')!
    const made = await admin.post('/agent/tokens', { name: 'Claude, emergencies', access: preset.access, rules: preset.rules })
    expect(made.status).toBe(200)
    secret = made.body.secret
    tokenId = made.body.token.id
    expect(secret).toMatch(/^sbt_/)
    const list = await admin.get('/agent/tokens')
    expect(list.body.gatewayEnabled).toBe(true)
    expect(JSON.stringify(list.body)).not.toContain(secret)
    expect(list.body.tokens[0]).toMatchObject({ id: tokenId, status: 'active', access: 'draft' })
    expect((await new Client(server.baseUrl).post('/agent/tokens', { name: 'nope' })).status).toBe(401)
  })

  it('switches always-allow on permanently, shows it in the listing, and switches it off', async () => {
    const name = (await rest('/site')).body.site.name as string
    const url = `/agent/tokens/${tokenId}/always-allow`
    expect((await admin.post(url, { permanent: true, siteName: 'Wrong', password: PASSWORD })).status).toBe(400)
    expect((await admin.post(url, { permanent: true, siteName: name, password: 'not the password' })).status).toBe(403)
    expect((await admin.post(url, { siteName: name, password: PASSWORD })).status).toBe(400)
    expect((await admin.post(url, { days: 2, permanent: true, siteName: name, password: PASSWORD })).status).toBe(400)
    const on = await admin.post(url, { permanent: true, siteName: name, password: PASSWORD })
    expect(on.status).toBe(200)
    expect(on.body.token.alwaysAllow).toEqual({ permanent: true, until: null })
    expect((await admin.get('/agent/tokens')).body.tokens.find((t: any) => t.id === tokenId).alwaysAllow).toEqual({ permanent: true, until: null })
    expect((await rest('/site')).body.you.always_allow).toEqual({ permanent: true, until: null })
    const off = await admin.del(url)
    expect(off.status).toBe(200)
    expect(off.body.token.alwaysAllow).toBeNull()
    expect((await rest('/site')).body.you.always_allow).toBeNull()
  })

  it('refuses requests without a good token, with the right headers', async () => {
    const none = await rest('/site', { token: null })
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toMatch(/Bearer/)
    expect(none.headers.get('cache-control')).toBe('no-store')
    expect((await rest('/site', { token: 'sbt_wrong' })).status).toBe(401)
    expect((await rest('/site', { token: 'not-a-token' })).status).toBe(401)
    // A browser session cookie is not accepted.
    const cookie = await fetch(`${server.baseUrl}/agent/v1/site`, { headers: { cookie: (admin as any).cookie ?? '' } })
    expect(cookie.status).toBe(401)
  })
})

describe('REST', () => {
  it('serves OpenAPI without a token', async () => {
    const r = await json(await agent('/agent/v1/openapi.json', { token: null }))
    expect(r.status).toBe(200)
    expect(r.body.openapi).toBe('3.1.0')
    expect(Object.keys(r.body.paths)).toContain('/edits/remove-link')
  })

  it('takes a link down end to end: find, remove as a draft, publish by rule, see it live, undo', async () => {
    const site = await rest('/site')
    expect(site.status).toBe(200)
    expect(site.body.you.can_publish_by_yourself).toBe(true)

    const found = await rest(`/links?url=${encodeURIComponent(LINK)}`)
    expect(found.body.total).toBe(1)
    expect(found.body.results[0].in_live).toBe(true)

    const bad = await rest('/edits/remove-link', { method: 'POST', body: { url: LINK, reason: 'x' } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('validation_failed')

    const removed = await rest('/edits/remove-link', { method: 'POST', body: { url: LINK, everywhere: true, expected_matches: 1, reason: 'The owner asked to take down the old partner link.' } })
    expect(removed.status).toBe(200)
    expect(removed.body.if_you_publish.outcome).toBe('goes_live')
    const id = removed.body.change.id as string
    expect((await admin.get(`/pages/${pageId}`)).body.page.publishedVersionId).toBeTruthy()

    const published = await rest(`/changes/${id}/publish`, { method: 'POST', body: {} })
    expect(published.status).toBe(200)
    expect(published.body.result.published).toBe(true)
    const done = await until(() => rest(`/changes/${id}`), (r) => r.body.change.status === 'published')
    expect(done.body.change.status).toBe('published')
    expect((await rest(`/links?url=${encodeURIComponent(LINK)}`)).body.total).toBe(0)

    // The admin sees it, with the token's name, and can undo it in one step.
    const all = await admin.get('/agent/changes')
    expect(all.body.changes[0]).toMatchObject({ id, tokenName: 'Claude, emergencies', status: 'published' })
    const undo = await admin.post(`/agent/changes/${id}/undo`, { reason: 'Claire wants it back' })
    expect(undo.status).toBe(200)
    expect(undo.body.published).toBe(true)
    const back = await until(() => rest(`/links?url=${encodeURIComponent(LINK)}`), (r) => r.body.total === 1 && r.body.results[0].in_live)
    expect(back.body.results[0].in_live).toBe(true)
    expect((await rest(`/changes/${id}`)).body.change.status).toBe('undone')
  })

  it('returns the standard error shape for unknown routes and wrong methods', async () => {
    expect((await rest('/nothing')).status).toBe(404)
    const wrong = await rest('/site', { method: 'POST', body: {} })
    expect(wrong.status).toBe(400)
    expect(wrong.headers.get('allow')).toBeTruthy()
  })
})

describe('removing a section that has custom CSS', () => {
  it('stays pending review under an edit_sections publish rule, and the live page is unchanged', async () => {
    const created = await admin.post('/pages', { title: 'Styled note', template: 'standard' })
    const id = created.body.page.id as string
    const sheet = 'a { color: #123456 }'
    const added = await admin.post(`/pages/${id}/ops`, {
      baseRevision: 0,
      ops: [
        { op: 'set_seo', description: 'A styled note' },
        { op: 'add_block', block: { type: 'RichText', props: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this.' }] }] } } } },
        { op: 'add_block', block: { type: 'Quote', props: { text: 'They gave him a second chance.', attribution: 'A volunteer' } } },
      ],
    })
    expect(added.status).toBe(200)
    const quoteId = added.body.doc.blocks.find((b: { type: string }) => b.type === 'Quote').id as string
    const styled = await admin.post(`/pages/${id}/ops`, { baseRevision: added.body.revision, ops: [{ op: 'set_block_css', blockId: quoteId, css: sheet }] })
    expect(styled.status).toBe(200)
    const sub = await admin.post(`/pages/${id}/submit`, {})
    const ok = await admin.post(`/reviews/${sub.body.reviewId}/approve`, { versionId: sub.body.versionId })
    expect((await admin.job(ok.body.jobId)).state).toBe('done')
    const publishedVersionId = (await admin.get(`/pages/${id}`)).body.page.publishedVersionId as string

    const made = await admin.post('/agent/tokens', { name: 'Section editor', access: 'draft', rules: [{ label: 'Sections', actions: ['edit_sections'], result: 'publish' }] })
    expect(made.status).toBe(200)
    const token = made.body.secret as string
    const removed = await rest('/edits/remove-component', { method: 'POST', token, body: { page_id: id, block_id: quoteId, reason: 'The owner asked to remove the styled quote.' } })
    expect(removed.status).toBe(200)
    expect(removed.body.if_you_publish.outcome).toBe('goes_to_review')
    expect(removed.body.if_you_publish.reasons[0]).toMatch(/Custom CSS always needs a person to review it/)
    const changeId = removed.body.change.id as string
    const published = await rest(`/changes/${changeId}/publish`, { method: 'POST', token, body: {} })
    expect(published.status).toBe(200)
    expect(published.body.result.published).toBe(false)
    expect(published.body.change.status).toBe('review')
    const live = await admin.get(`/pages/${id}/versions/${publishedVersionId}`)
    expect(live.body.doc.blocks.find((b: { id: string }) => b.id === quoteId).css).toBe(sheet)
  })
})

describe('MCP', () => {
  it('initialises, lists, and runs tools', async () => {
    const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.status).toBe(200)
    expect(init.body.result.serverInfo.name).toBe('sitebuilder')
    expect(init.body.result.instructions).toContain('get_site')
    expect((await mcp('notifications/initialized', undefined, null)).status).toBe(202)
    const tools = await mcp('tools/list')
    expect(tools.body.result.tools.length).toBeGreaterThanOrEqual(29)
    expect(tools.body.result.tools[0].inputSchema.type).toBe('object')
    const res = await mcp('resources/read', { uri: 'sitebuilder://recipe/take-a-link-down' })
    expect(res.body.result.contents[0].text).toContain('find_links')
    const r = await tool('get_site')
    expect(r.isError).toBe(false)
    expect(r.structuredContent.you.token_name).toBe('Claude, emergencies')
    const err = await tool('get_page', { path: '/missing' })
    expect(err.isError).toBe(true)
    expect(err.content[0].text).toMatch(/^ERROR not_found/)
  })

  it('refuses GET, bad JSON and a bad token', async () => {
    expect((await json(await agent('/agent/mcp', { method: 'GET' }))).status).toBe(405)
    const bad = await fetch(`${server.baseUrl}/agent/mcp`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: '{nope' })
    expect(bad.status).toBe(400)
    expect((await json(await agent('/agent/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'ping' }, token: 'sbt_wrong' }))).status).toBe(401)
    expect((await json(await agent('/agent/mcp', { method: 'POST', body: { nope: true } }))).status).toBe(400)
  })
})

describe('switching it off', () => {
  it('stops every token at once, and a revoked token for good', async () => {
    expect((await admin.post('/agent/pause', { paused: true })).status).toBe(200)
    const paused = await rest('/site')
    expect(paused.status).toBe(403)
    expect(paused.body.error.code).toBe('agent_paused')
    expect((await admin.post('/agent/pause', { paused: false })).status).toBe(200)
    expect((await rest('/site')).status).toBe(200)
    expect((await admin.del(`/agent/tokens/${tokenId}`)).status).toBe(200)
    expect((await rest('/site')).status).toBe(401)
  })
})

describe('Cloudflare Access', () => {
  it('blocks /agent/ at the app by default, and lets the token decide when bypass is configured', async () => {
    const access = { SITEBUILDER_ALLOW_NO_ACCESS: '', SITEBUILDER_ACCESS_AUD: 'test-aud', SITEBUILDER_ACCESS_TEAM_DOMAIN: 'example-team', SITEBUILDER_AGENT_GATEWAY: '1' }
    const locked = await startServer(access)
    try {
      expect((await fetch(`${locked.baseUrl}/agent/v1/site`, { headers: { authorization: 'Bearer sbt_x' } })).status).toBe(403)
    } finally {
      await locked.stop()
    }
    const bypass = await startServer({ ...access, SITEBUILDER_AGENT_ACCESS: 'bypass' })
    try {
      expect((await fetch(`${bypass.baseUrl}/agent/v1/site`, { headers: { authorization: 'Bearer sbt_x' } })).status).toBe(401)
      expect((await fetch(`${bypass.baseUrl}/agent/v1/openapi.json`)).status).toBe(200)
      // The builder itself stays behind Access.
      expect((await fetch(`${bypass.baseUrl}/api/v1/pages`)).status).toBe(403)
      expect((await fetch(`${bypass.baseUrl}/`)).status).toBe(403)
    } finally {
      await bypass.stop()
    }
  })
})

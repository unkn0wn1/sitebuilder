// Phase 5: media tools (list, import by address in the background, alt text) and the footer tool.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { auditEvents } from '../server/db/schema'
import { MAX_PENDING_IMPORTS, createMediaImportHandler } from '../server/services/agent/media'
import { callOperation } from '../server/services/agent/operations'
import { revokeAgentToken } from '../server/services/agent/tokens'
import { runJobsOnce } from '../server/services/jobs'
import { approveReview } from '../server/services/reviews'
import { createSitePart, editSitePart, submitSitePart } from '../server/services/site-parts'
import { defaultSitePartDoc } from '../shared/site-parts'
import { PUBLISH_ALL, code, drain, handlers, world, type World } from './agent-helpers'

const REASON = 'The owner sent this for the site'
const call = (w: World, name: string, input: Record<string, unknown>) => callOperation(w.ctx, w.agent, name, input) as any
const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer()
const PUBLIC = async () => ['93.184.216.34']

function fakeFetch(routes: Record<string, () => Promise<Response> | Response>, seen: string[] = []) {
  return (async (url: string) => {
    seen.push(url)
    const r = routes[url]
    return r ? r() : new Response('nope', { status: 404 })
  }) as unknown as typeof fetch
}
async function runImports(w: World, f: typeof fetch, resolve = PUBLIC) {
  const h = { ...handlers, agent_media_import: createMediaImportHandler(mkdtempSync(join(tmpdir(), 'sb-agent-media-')), { fetch: f, resolve }), media_renditions: { run: () => ({}) } }
  for (let i = 0; i < 10; i++) if ((await runJobsOnce(w.ctx, h as any)) === 0) return
}
const IMG_URL = 'https://photos.example.org/dogs/rescued-dog.png'

describe('import_media', () => {
  it('queues, imports in the background, sets alt text, and the photo is then listed', async () => {
    const w = await world([])
    const data = await png()
    const q = call(w, 'import_media', { url: IMG_URL, alt: 'A dog resting on a blanket.', reason: REASON })
    expect(q.status).toBe('queued')
    expect(call(w, 'get_media_import', { import_id: q.import_id }).status).toBe('queued')
    await runImports(w, fakeFetch({ [IMG_URL]: () => new Response(new Uint8Array(data), { headers: { 'content-type': 'image/png' } }) }))
    const done = call(w, 'get_media_import', { import_id: q.import_id })
    expect(done).toMatchObject({ status: 'done', duplicate: false, media: { filename: 'rescued-dog.png', alt: 'A dog resting on a blanket.', kind: 'image' } })
    expect(done.media.use_in_props).toEqual({ media: done.media.media_id, alt: 'A dog resting on a blanket.' })
    const listed = call(w, 'list_media', { search: 'blanket' })
    expect(listed.media.map((m: any) => m.media_id)).toEqual([done.media.media_id])
    expect(listed.site_content_notice).toMatch(/UNTRUSTED/)
    const actions = w.ctx.db.select().from(auditEvents).all().map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(['agent.media.import_queued', 'agent.media.imported']))
    // No change was made: the library is open to draft tokens, nothing needs approval.
    expect(call(w, 'list_changes', {}).changes).toHaveLength(0)
  })

  it('returns the existing photo for a duplicate', async () => {
    const w = await world([])
    const data = await png()
    const f = fakeFetch({ [IMG_URL]: () => new Response(new Uint8Array(data), { headers: { 'content-type': 'image/png' } }) })
    call(w, 'import_media', { url: IMG_URL, alt: 'A dog.', reason: REASON })
    await runImports(w, f)
    const again = call(w, 'import_media', { url: IMG_URL, alt: 'Another description.', reason: REASON })
    await runImports(w, f)
    const r = call(w, 'get_media_import', { import_id: again.import_id })
    expect(r).toMatchObject({ status: 'done', duplicate: true, media: { alt: 'A dog.' } })
  })

  it('refuses unsafe addresses up front and private destinations at fetch time, and checks every redirect', async () => {
    const w = await world([])
    for (const url of ['http://photos.example.org/a.png', 'https://localhost/a.png', 'https://10.0.0.1/a.png', 'https://user:pw@photos.example.org/a.png', 'file:///etc/passwd']) {
      expect(await code(() => call(w, 'import_media', { url, alt: 'x x', reason: REASON })), url).toBe('validation_failed')
    }
    expect(await code(() => call(w, 'import_media', { url: IMG_URL, reason: REASON }))).toBe('validation_failed')

    const seen: string[] = []
    const q1 = call(w, 'import_media', { url: IMG_URL, alt: 'A dog.', reason: REASON })
    await runImports(w, fakeFetch({}, seen), async () => ['10.1.2.3'])
    expect(call(w, 'get_media_import', { import_id: q1.import_id })).toMatchObject({ status: 'failed', error: expect.stringMatching(/inside this network/) })
    expect(seen).toHaveLength(0)

    const q2 = call(w, 'import_media', { url: IMG_URL, alt: 'A dog.', reason: REASON })
    await runImports(w, fakeFetch({ [IMG_URL]: () => new Response('', { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }) }, seen))
    expect(call(w, 'get_media_import', { import_id: q2.import_id }).status).toBe('failed')
    expect(seen.some((u) => u.includes('169.254'))).toBe(false)
  })

  it('fails plainly for pages that are not images, missing files and oversized files', async () => {
    const w = await world([])
    const html = call(w, 'import_media', { url: 'https://photos.example.org/page', alt: 'A dog.', reason: REASON })
    const missing = call(w, 'import_media', { url: 'https://photos.example.org/gone.png', alt: 'A dog.', reason: REASON })
    const big = call(w, 'import_media', { url: 'https://photos.example.org/big.png', alt: 'A dog.', reason: REASON })
    const junk = call(w, 'import_media', { url: 'https://photos.example.org/junk.png', alt: 'A dog.', reason: REASON })
    await runImports(
      w,
      fakeFetch({
        'https://photos.example.org/page': () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        'https://photos.example.org/big.png': () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(200 * 1024 * 1024) } }),
        'https://photos.example.org/junk.png': () => new Response('not really an image', { headers: { 'content-type': 'image/png' } }),
      }),
    )
    expect(call(w, 'get_media_import', { import_id: html.import_id }).error).toMatch(/not a photo/)
    expect(call(w, 'get_media_import', { import_id: missing.import_id }).error).toMatch(/404/)
    expect(call(w, 'get_media_import', { import_id: big.import_id }).error).toMatch(/too big/)
    expect(call(w, 'get_media_import', { import_id: junk.import_id }).status).toBe('failed')
  })

  it('is per token: another token cannot see the import, a revoked token cancels it, and pending imports are capped', async () => {
    const w = await world([])
    const q = call(w, 'import_media', { url: IMG_URL, alt: 'A dog.', reason: REASON })
    const { addToken } = await import('./agent-helpers')
    const other = addToken(w, { name: 'Other', access: 'draft', rules: [] })
    expect(await code(() => callOperation(w.ctx, other.agent, 'get_media_import', { import_id: q.import_id }))).toBe('not_found')
    for (let i = 1; i < MAX_PENDING_IMPORTS; i++) call(w, 'import_media', { url: `${IMG_URL}?n=${i}`, alt: 'A dog.', reason: REASON })
    expect(await code(() => call(w, 'import_media', { url: IMG_URL, alt: 'A dog.', reason: REASON }))).toBe('rate_limited')
    revokeAgentToken(w.ctx, w.admin, w.tokenId)
    const seen: string[] = []
    await runImports(w, fakeFetch({}, seen))
    expect(seen).toHaveLength(0)
  })

  it('needs a draft token', async () => {
    const w = await world([])
    const { addToken } = await import('./agent-helpers')
    const ro = addToken(w, { name: 'Reader', access: 'read', rules: [] })
    expect(await code(() => callOperation(w.ctx, ro.agent, 'import_media', { url: IMG_URL, alt: 'A dog.', reason: REASON }))).toBe('forbidden')
    expect(await code(() => callOperation(w.ctx, ro.agent, 'list_media', {}))).toBe('ok')
  })
})

describe('set_alt_text', () => {
  it('sets or clears alt text with no change or approval, and audits the old value', async () => {
    const w = await world([])
    const data = await png()
    const q = call(w, 'import_media', { url: IMG_URL, decorative: true, reason: REASON })
    await runImports(w, fakeFetch({ [IMG_URL]: () => new Response(new Uint8Array(data), { headers: { 'content-type': 'image/png' } }) }))
    const id = call(w, 'get_media_import', { import_id: q.import_id }).media.media_id
    const r = call(w, 'set_alt_text', { media_id: id, alt: 'Volunteers lifting a cow onto a stretcher.', reason: REASON })
    expect(r.media).toMatchObject({ alt: 'Volunteers lifting a cow onto a stretcher.', decorative: false })
    expect(await code(() => call(w, 'set_alt_text', { media_id: id, reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w, 'set_alt_text', { media_id: 'med_nope', alt: 'x', reason: REASON }))).toBe('not_found')
    const ev = w.ctx.db.select().from(auditEvents).all().find((e) => e.action === 'agent.media.alt_set')!
    expect((ev.details as any).before).toMatchObject({ decorative: true })
    expect(call(w, 'list_changes', {}).changes).toHaveLength(0)
  })
})

describe('set_footer', () => {
  async function withFooter(rules: unknown[] = PUBLISH_ALL) {
    const w = await world(rules)
    const id = createSitePart(w.ctx, 'footer', 'main', 'Footer')
    editSitePart(w.ctx, w.admin, id, 0, { ...(defaultSitePartDoc('footer') as object), contact: { email: 'old@example.org', phone: null, address: null } } as never)
    const sub = submitSitePart(w.ctx, w.admin, id)
    approveReview(w.ctx, w.approver, sub.reviewId, { versionId: sub.versionId })
    await drain(w)
    return w
  }

  it('changes contact, social, text and charity number as a draft, and a rule can publish it', async () => {
    const w = await withFooter([{ label: 'Footer', actions: ['edit_footer'], result: 'publish', limits: { allowNewLinks: true } }])
    const r = call(w, 'set_footer', {
      contact: { email: 'help@example.org', phone: '+91 98290 00000' },
      social: [{ network: 'instagram', url: 'https://instagram.com/example' }],
      text_markdown: 'We rescue **street animals**.',
      charity_number: '12345',
      reason: REASON,
    })
    expect(r.result.changed).toEqual(['text', 'contact', 'social', 'charityNumber'])
    expect(r.result.footer_now.contact).toMatchObject({ email: 'help@example.org', phone: '+91 98290 00000', address: null })
    expect(r.if_you_publish.outcome).toBe('goes_live')
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    expect(JSON.stringify(call(w, 'get_site_part', { kind: 'footer' }))).toContain('help@example.org')
    expect(JSON.stringify(call(w, 'get_site_part', { kind: 'footer' }))).not.toContain('old@example.org')
  })

  it('goes to a person without an edit_footer rule, and refuses bad values without making a change', async () => {
    const w = await withFooter([{ label: 'Text', actions: ['edit_text'], result: 'publish' }])
    expect(call(w, 'set_footer', { charity_number: '12345', reason: REASON }).if_you_publish.outcome).toBe('goes_to_review')
    const w2 = await withFooter()
    expect(await code(() => call(w2, 'set_footer', { contact: { phone: 'call us!' }, reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w2, 'set_footer', { social: [{ network: 'x', url: 'http://x.com/a' }], reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w2, 'set_footer', { text_markdown: '[x](javascript:alert(1))', reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w2, 'set_footer', { reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w2, 'set_footer', { layout: 'columns', reason: REASON }))).toBe('validation_failed')
    expect(call(w2, 'list_changes', {}).changes).toHaveLength(0)
  })

  it('obeys a deny rule for edit_footer', async () => {
    const w = await withFooter([{ label: 'Leave the footer', actions: ['edit_footer'], result: 'deny' }])
    expect(await code(() => call(w, 'set_footer', { charity_number: '12345', reason: REASON }))).toBe('rule_denied')
  })
})

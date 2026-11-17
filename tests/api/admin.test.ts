import sharp from 'sharp'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { Client } from './client'

const baseUrl = inject('baseUrl')
const users = inject('users')
const editor = new Client(baseUrl)
const approver = new Client(baseUrl)
const admin = new Client(baseUrl)

beforeAll(async () => {
  await editor.login(users.editor, users.password)
  await approver.login(users.approver, users.password)
  await admin.login(users.admin, users.password)
})

describe('settings, secrets, redirects, memory, system', () => {
  it('settings are admin only and validated', async () => {
    expect((await approver.get('/settings')).status).toBe(403)
    const bad = await admin.patch('/settings', { tracking: { ga4: 'UA-123' } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.fields[0].path).toBe('tracking.ga4')
    const ok = await admin.patch('/settings', { tracking: { ga4: 'G-ABC123XYZ' }, workflow: { selfApproval: false } })
    expect(ok.body.settings.tracking.ga4).toBe('G-ABC123XYZ')
  })

  it('secrets are write-only', async () => {
    expect((await approver.put('/settings/secrets/ai_api_key', { value: 'x' })).status).toBe(403)
    expect((await admin.put('/settings/secrets/ai_api_key', { value: 'not-a-real-key' })).status).toBe(200)
    const s = await admin.get('/settings')
    expect(s.body.secretsSet.ai_api_key).toBe(true)
    expect(JSON.stringify(s.body)).not.toContain('not-a-real-key')
  })

  it('Google Workspace is how v1 sends mail; SMTP passwords are not accepted', async () => {
    expect((await admin.put('/settings/secrets/smtp_password', { value: 'an-app-password' })).status).toBe(404)
    expect((await editor.post('/settings/mail/google/start', {})).status).toBe(403)
    expect((await admin.post('/settings/mail/google/start', {})).status).toBe(503)
    const secret = await admin.put('/settings/secrets/google_oauth_client_secret', { value: 'fake-client-secret' })
    expect(secret.status).toBe(200)
    const patched = await admin.patch('/settings', { mail: { googleClientId: '123.apps.googleusercontent.com', from: 'noreply@example.org' } })
    expect(patched.status).toBe(200)
    expect(patched.body.mail.from).toBe('noreply@example.org')
    expect(patched.body.mail.googleConnected).toBe(false)
    expect(JSON.stringify(patched.body)).not.toContain('fake-client-secret')
    const start = await admin.post('/settings/mail/google/start', {})
    expect(start.status).toBe(200)
    expect(start.body.url).toContain('accounts.google.com')
    expect(start.body.url).toContain('gmail.send')
    const test = await admin.post('/settings/mail/test', { to: users.admin })
    expect(test.status).toBe(200)
    expect(test.body.to).toBe(users.admin)
  })

  it('redirects', async () => {
    const r = await approver.post('/redirects', { fromPath: '/old-donate', toPath: '/donate' })
    expect(r.status).toBe(200)
    expect((await approver.post('/redirects', { fromPath: '/donate', toPath: '/old-donate' })).status).toBe(400)
    expect((await editor.post('/redirects', { fromPath: '/x', toPath: '/y' })).status).toBe(403)
    expect((await approver.del(`/redirects/${r.body.id}`)).status).toBe(200)
  })

  it('memory', async () => {
    expect((await editor.post('/memory', { scope: 'site', text: 'We are a rescue.' })).status).toBe(403)
    const site = await admin.post('/memory', { scope: 'site', text: "Always say 'rescue', never 'shelter'." })
    const mine = await editor.post('/memory', { scope: 'user', text: 'Short headlines please.' })
    const list = (await editor.get('/memory')).body.items.map((m: { id: string }) => m.id)
    expect(list).toEqual(expect.arrayContaining([site.body.entry.id, mine.body.entry.id]))
    expect((await approver.get('/memory')).body.items.map((m: { id: string }) => m.id)).not.toContain(mine.body.entry.id)
    expect((await approver.del(`/memory/${mine.body.entry.id}`)).status).toBe(404)
  })

  it('system status is for operators', async () => {
    expect((await approver.get('/system')).status).toBe(403)
    const s = await admin.get('/system')
    expect(s.status).toBe(200)
    expect(s.body.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(s.body.databaseBytes).toBeGreaterThan(0)
  })

  it('audit log records what happened', async () => {
    const a = await admin.get('/audit?pageSize=100')
    const actions = a.body.items.map((e: { action: string }) => e.action)
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'settings.updated', 'secret.updated']))
  })
})

describe('media over HTTP', () => {
  it('uploads, makes renditions, serves them to signed-in users, and refuses non-images', async () => {
    const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#3a7' } }).png().toBuffer()
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), 'field.png')
    const up = await editor.req('POST', '/media', undefined, { form })
    expect(up.status).toBe(200)
    expect((await editor.job(up.body.jobId)).state).toBe('done')
    const item = await editor.get(`/media/${up.body.media.id}`)
    expect(item.body.media.status).toBe('ready')
    const name = item.body.renditions.find((n: string) => n.endsWith('-640.webp'))
    const file = await editor.get(`/media/${up.body.media.id}/files/${name}`)
    expect(file.status).toBe(200)
    expect((await sharp(Buffer.from(file.body as ArrayBuffer)).metadata()).width).toBe(640)
    expect((await new Client(baseUrl).get(`/media/${up.body.media.id}/files/${name}`)).status).toBe(401)
    expect((await editor.get(`/media/${up.body.media.id}/files/..%2F..%2Fsitebuilder.db`)).status).toBe(404)

    const fake = new FormData()
    fake.append('file', new Blob([Buffer.from('<?php echo 1; ?>')], { type: 'image/png' }), 'shell.png')
    expect((await editor.req('POST', '/media', undefined, { form: fake })).status).toBe(400)

    expect((await editor.patch(`/media/${up.body.media.id}`, { alt: 'A green field' })).body.media.alt).toBe('A green field')
  })
})

describe('assistant sessions over HTTP', () => {
  it('starts, says the model is not on yet, and cancels', async () => {
    const status = await editor.get('/ai/status')
    expect(status.status).toBe(200)
    expect(status.body.enabled).toBe(false)
    expect(status.body.available).toBe(false)
    expect(status.body.reason).toBe('off')
    expect(status.body.message).toMatch(/isn't switched on yet/)

    const page = (await editor.post('/pages', { title: 'News', template: 'standard' })).body.page
    const s = await editor.post('/ai/sessions', { taskType: 'page_edit', targetId: page.id })
    expect(s.status).toBe(200)
    const again = await editor.post('/ai/sessions', { taskType: 'page_edit', targetId: page.id })
    expect(again.body.session.id).toBe(s.body.session.id)
    const history = await editor.get(`/ai/sessions/${s.body.session.id}`)
    expect(history.status).toBe(200)
    expect(history.body.messages).toEqual([])
    const m = await editor.post(`/ai/sessions/${s.body.session.id}/messages`, { text: 'hello' })
    expect(m.status).toBe(503)
    expect(m.body.error.code).toBe('ai_unavailable')
    expect((await approver.post(`/ai/sessions/${s.body.session.id}/cancel`)).status).toBe(404)
    expect((await editor.post(`/ai/sessions/${s.body.session.id}/cancel`)).body.session.state).toBe('ended')
    expect((await editor.post('/ai/sessions', { taskType: 'brand_design', targetId: 'brd_x' })).status).toBe(403)
  })
})

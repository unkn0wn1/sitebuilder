import { describe, expect, inject, it } from 'vitest'
import { Client } from './client'
import { lastEmail, tokenFrom } from './server'

const baseUrl = inject('baseUrl')
const users = inject('users')
const outbox = inject('outbox')

describe('auth over HTTP', () => {
  it('health is open, everything else needs a session', async () => {
    expect((await fetch(`${baseUrl}/api/v1/health`)).status).toBe(200)
    const anon = new Client(baseUrl)
    const r = await anon.get('/pages')
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: { code: 'unauthenticated', message: 'Please sign in.' } })
  })

  it('refuses writes from another origin or with no origin', async () => {
    const c = new Client(baseUrl)
    expect((await c.req('POST', '/auth/login', { email: users.admin, password: users.password }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await c.req('POST', '/auth/login', { email: users.admin, password: users.password }, { origin: null })).body.error.code).toBe('csrf')
  })

  it('signs in, reports who you are, and signs out', async () => {
    const c = new Client(baseUrl)
    expect((await c.post('/auth/login', { email: users.editor, password: 'wrong-password-123' })).status).toBe(401)
    const r = await c.login(users.editor, users.password)
    expect(r.body.user).toMatchObject({ email: users.editor, role: 'editor', name: 'Asha' })
    expect((await c.get('/auth/me')).body.user.role).toBe('editor')
    await c.post('/auth/logout')
    expect((await c.get('/auth/me')).status).toBe(401)
  })

  it('validates input with field errors', async () => {
    const r = await new Client(baseUrl).post('/auth/login', { email: 'not-an-email', password: 'x' })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('validation_failed')
    expect(r.body.error.fields[0].path).toBe('email')
  })

  it('resets a password by email link, ending old sessions', async () => {
    const old = new Client(baseUrl)
    await old.login(users.approver, users.password)
    const c = new Client(baseUrl)
    const r1 = await c.post('/auth/password/reset-request', { email: users.approver })
    const r2 = await c.post('/auth/password/reset-request', { email: 'nobody@example.org' })
    expect(r1.body).toEqual(r2.body)
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      await new Promise((res) => setTimeout(res, 100))
      try {
        const mail = lastEmail(outbox, users.approver)
        if (mail.subject.includes('Reset')) token = tokenFrom(mail.text)
      } catch {}
    }
    expect(token).not.toBe('')
    expect((await c.post('/auth/password/reset', { token, password: 'short' })).status).toBe(400)
    expect((await c.post('/auth/password/reset', { token, password: 'a-different-long-password' })).status).toBe(200)
    expect((await old.get('/auth/me')).status).toBe(401)
    expect((await c.post('/auth/login', { email: users.approver, password: users.password })).status).toBe(401)
    await c.login(users.approver, 'a-different-long-password')
    // Put it back for the other test files.
    const again = await c.post('/auth/password/reset', { token, password: users.password })
    expect(again.status).toBe(400)
    await c.post('/auth/password/reset-request', { email: users.approver })
    let token2 = ''
    for (let i = 0; i < 100 && !token2; i++) {
      await new Promise((res) => setTimeout(res, 100))
      const t = tokenFrom(lastEmail(outbox, users.approver).text)
      if (t && t !== token) token2 = t
    }
    expect((await c.post('/auth/password/reset', { token: token2, password: users.password })).status).toBe(200)
  })

  it('only admins manage users', async () => {
    const editor = new Client(baseUrl)
    await editor.login(users.editor, users.password)
    expect((await editor.get('/users')).status).toBe(403)
    const admin = new Client(baseUrl)
    await admin.login(users.admin, users.password)
    const list = await admin.get('/users')
    expect(list.body.items.map((u: { email: string }) => u.email).sort()).toEqual([users.admin, users.approver, users.editor].sort())
  })
})

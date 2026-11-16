import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { jobs, pages } from '../server/db/schema'
import { cancelAiSession, runTool, startAiSession } from '../server/services/ai'
import { checkLogin, createSession, getSessionUser, requestPasswordReset, resetPassword, createUser, acceptInvite } from '../server/services/auth'
import { createEmailHandler, outboxMailer } from '../server/services/email'
import { AppError } from '../server/services/errors'
import { runJobsOnce } from '../server/services/jobs'
import { acceptMemory, addMemory, deleteMemory, listMemory } from '../server/services/memory'
import { applyPageOps, binPage, createPage, getPage, listBin, restoreFromBin } from '../server/services/pages'
import { createPublishHandler } from '../server/services/publish'
import { createRedirect, deleteRedirect, listRedirects } from '../server/services/redirects'
import { approveReview, submitPage } from '../server/services/reviews'
import { getSettings, updateSettings } from '../server/services/settings'
import { systemStatus } from '../server/services/system'
import { setup } from './helpers'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof AppError) return e.code
    throw e
  }
  return 'ok'
}

describe('settings', () => {
  it('reads defaults, merges patches, validates ids, and is admin only', () => {
    const s = setup()
    expect(getSettings(s.ctx).settings.workflow.selfApproval).toBe(false)
    expect(getSettings(s.ctx).secretsSet).toEqual({ ai_api_key: false, cloudflare_token: false, smtp_password: false })
    const next = updateSettings(s.ctx, s.admin, { name: 'Animal rescue', tracking: { ga4: 'G-ABC123XYZ' } })
    expect(next.name).toBe('Animal rescue')
    expect(next.settings.tracking).toEqual({ ga4: 'G-ABC123XYZ', gtm: null, plausible: null, cookiebot: null })
    updateSettings(s.ctx, s.admin, { tracking: { plausible: 'example.org' } })
    expect(getSettings(s.ctx).settings.tracking.ga4).toBe('G-ABC123XYZ')
    expect(code(() => updateSettings(s.ctx, s.approver, { workflow: { selfApproval: true } }))).toBe('forbidden')
  })

  it('self-approval setting is what approval reads', () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.approver, { title: 'Contact', template: 'standard' })
    applyPageOps(s.ctx, s.approver, page.id, 0, [{ op: 'set_seo', description: 'How to reach us' }])
    const { reviewId, versionId } = submitPage(s.ctx, s.approver, page.id)
    expect(code(() => approveReview(s.ctx, s.approver, reviewId, { versionId }))).toBe('forbidden')
    updateSettings(s.ctx, s.admin, { workflow: { selfApproval: true } })
    expect(approveReview(s.ctx, s.approver, reviewId, { versionId }).selfApproved).toBe(true)
  })
})

describe('redirects', () => {
  it('normalises paths and refuses loops, duplicates and live addresses', async () => {
    const s = setup()
    expect(createRedirect(s.ctx, s.approver, { fromPath: '/old-page/', toPath: '/new-page' }).fromPath).toBe('/old-page')
    expect(code(() => createRedirect(s.ctx, s.approver, { fromPath: '/old-page', toPath: '/x' }))).toBe('validation_failed')
    expect(code(() => createRedirect(s.ctx, s.approver, { fromPath: '/new-page', toPath: '/old-page' }))).toBe('validation_failed')
    expect(code(() => createRedirect(s.ctx, s.approver, { fromPath: '/a', toPath: 'javascript:alert(1)' }))).toBe('validation_failed')
    expect(code(() => createRedirect(s.ctx, s.approver, { fromPath: '/a/../b', toPath: '/c' }))).toBe('validation_failed')
    expect(createRedirect(s.ctx, s.approver, { fromPath: '/donate-now', toPath: 'https://example.org/give', statusCode: 302 }).statusCode).toBe(302)
    expect(code(() => createRedirect(s.ctx, s.editor, { fromPath: '/b', toPath: '/c' }))).toBe('forbidden')

    // A page published at a redirected address removes the redirect.
    const { page } = createPage(s.ctx, s.editor, { title: 'New page', template: 'standard', slug: 'old-page' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'set_seo', description: 'Back again' }])
    const { reviewId, versionId } = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, reviewId, { versionId })
    await runJobsOnce(s.ctx, { publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } })
    expect(listRedirects(s.ctx).map((r) => r.fromPath)).not.toContain('/old-page')
    expect(code(() => createRedirect(s.ctx, s.approver, { fromPath: '/old-page', toPath: '/x' }))).toBe('validation_failed')
    const id = listRedirects(s.ctx)[0]!.id
    deleteRedirect(s.ctx, s.approver, id)
    expect(listRedirects(s.ctx)).toHaveLength(0)
  })
})

describe('memory', () => {
  it('site memory is admin-edited and readable by all; user memory is private', () => {
    const s = setup()
    const site = addMemory(s.ctx, s.admin, { scope: 'site', text: "Always say 'rescue', never 'shelter'." })
    expect(code(() => addMemory(s.ctx, s.editor, { scope: 'site', text: 'x' }))).toBe('forbidden')
    const mine = addMemory(s.ctx, s.editor, { scope: 'user', text: 'Keep my headlines short.' })
    expect(listMemory(s.ctx, s.editor).map((m) => m.id).sort()).toEqual([site.id, mine.id].sort())
    expect(listMemory(s.ctx, s.editor2).map((m) => m.id)).toEqual([site.id])
    expect(code(() => deleteMemory(s.ctx, s.editor2, mine.id))).toBe('not_found')
    expect(code(() => deleteMemory(s.ctx, s.editor, site.id))).toBe('forbidden')
    deleteMemory(s.ctx, s.editor, mine.id)
  })

  it('the assistant only proposes; a person accepts', () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'News', template: 'standard' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const r = runTool(s.ctx, s.editor, session.id, 'remember', { scope: 'user', text: 'I write news posts.' })
    expect(r.ok).toBe(true)
    const id = (r as { result: { proposedMemoryId: string } }).result.proposedMemoryId
    expect(listMemory(s.ctx, s.editor).find((m) => m.id === id)?.state).toBe('proposed')
    expect(code(() => addMemory(s.ctx, { ...s.editor, aiSessionId: session.id }, { scope: 'user', text: 'sneaky' }))).toBe('forbidden')
    expect(acceptMemory(s.ctx, s.editor, id).state).toBe('active')

    const siteProposal = runTool(s.ctx, s.editor, session.id, 'remember', { scope: 'site', text: 'We were founded in 1998.' }) as { result: { proposedMemoryId: string } }
    expect(code(() => acceptMemory(s.ctx, s.editor, siteProposal.result.proposedMemoryId))).toBe('forbidden')
    expect(acceptMemory(s.ctx, s.admin, siteProposal.result.proposedMemoryId).state).toBe('active')
  })
})

describe('bin', () => {
  it('restores a page, moving it if its address was taken', () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'Events', template: 'standard' })
    binPage(s.ctx, s.editor, page.id)
    expect(listBin(s.ctx).map((p) => p.id)).toEqual([page.id])
    expect(code(() => getPage(s.ctx, page.id))).toBe('not_found')
    createPage(s.ctx, s.editor, { title: 'Events', template: 'standard' })
    expect(code(() => restoreFromBin(s.ctx, s.editor, page.id))).toBe('forbidden')
    const r = restoreFromBin(s.ctx, s.approver, page.id)
    expect(r.moved).toBe(true)
    expect(r.page.path).toBe('/events-restored')
    expect(getPage(s.ctx, page.id).page.deletedAt).toBeNull()
    expect(code(() => restoreFromBin(s.ctx, s.approver, page.id))).toBe('not_found')
  })
})

describe('AI session cancel', () => {
  it('ends the session and stops further tool calls', () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'Volunteer', template: 'standard' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    expect(runTool(s.ctx, s.editor, session.id, 'set_seo', { description: 'Help us' }).ok).toBe(true)
    expect(code(() => cancelAiSession(s.ctx, s.editor2, session.id))).toBe('not_found')
    expect(cancelAiSession(s.ctx, s.editor, session.id).state).toBe('ended')
    expect(runTool(s.ctx, s.editor, session.id, 'set_seo', { description: 'Again' }).ok).toBe(false)
  })
})

describe('password reset and email', () => {
  it('mints links at send time and resets the password, ending sessions', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-outbox-'))
    const handlers = { send_email: createEmailHandler({ mailer: outboxMailer(dir), baseUrl: 'https://builder.example.org' }) }
    const { token: session } = createSession(s.ctx, s.editor.id)
    requestPasswordReset(s.ctx, 'ASHA@example.org')
    requestPasswordReset(s.ctx, 'nobody@example.org')
    const queued = s.ctx.db.select().from(jobs).where(eq(jobs.kind, 'send_email')).all()
    expect(queued).toHaveLength(1)
    expect(JSON.stringify(queued[0]!.payload)).not.toMatch(/token/i)
    await runJobsOnce(s.ctx, handlers)
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    const mail = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as { to: string; text: string }
    expect(mail.to).toBe('asha@example.org')
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!
    resetPassword(s.ctx, token, 'a-brand-new-long-password')
    expect(checkLogin(s.ctx, 'asha@example.org', 'a-brand-new-long-password')?.id).toBe(s.editor.id)
    expect(getSessionUser(s.ctx, session)).toBeNull()
    expect(code(() => resetPassword(s.ctx, token, 'another-long-password-1'))).toBe('validation_failed')
  })

  it('invite emails carry a working link and skip quietly without a mailer', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-outbox-'))
    createUser(s.ctx, { email: 'new@example.org', name: 'New', role: 'editor' })
    const { enqueueJob } = await import('../server/services/jobs')
    const user = s.ctx.db.select().from((await import('../server/db/schema')).users).all().find((u) => u.email === 'new@example.org')!
    enqueueJob(s.ctx, 'send_email', { kind: 'invite', userId: user.id })
    await runJobsOnce(s.ctx, { send_email: createEmailHandler({ mailer: null, baseUrl: 'x' }) })
    expect(readdirSync(dir)).toHaveLength(0)
    enqueueJob(s.ctx, 'send_email', { kind: 'invite', userId: user.id })
    await runJobsOnce(s.ctx, { send_email: createEmailHandler({ mailer: outboxMailer(dir), baseUrl: 'https://b.example.org' }) })
    const mail = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')) as { text: string }
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!
    expect(acceptInvite(s.ctx, token, 'New Person', 'a-long-new-password').status).toBe('active')
  })
})

describe('system status', () => {
  it('reports the queue and last release', () => {
    const s = setup()
    const status = systemStatus(s.ctx, { version: '0.0.0', dbPath: ':memory:', dataDir: tmpdir() })
    expect(status.version).toBe('0.0.0')
    expect(status.lastRelease).toBeNull()
    expect(status.disk?.totalBytes).toBeGreaterThan(0)
    expect(s.ctx.db.select().from(pages).all()).toHaveLength(0)
  })
})

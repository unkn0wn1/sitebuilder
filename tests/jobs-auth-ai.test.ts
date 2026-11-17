import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { jobs, memoryEntries } from '../server/db/schema'
import { acceptInvite, checkLogin, createSession, createUser, decryptSecret, encryptSecret, getSecret, getSessionUser, hashPassword, setSecret, verifyPassword, SESSION_IDLE_MS } from '../server/services/auth'
import { enqueueJob, getJob, runJobsOnce, LEASE_MS, claimNextJob } from '../server/services/jobs'
import { endAiTurn, runTool, startAiSession } from '../server/services/ai'
import { createPage, getPage, listVersions } from '../server/services/pages'
import { getTemplateRules } from '../server/services/templates'
import { AppError } from '../server/services/errors'
import { setup, IMG } from './helpers'

describe('jobs', () => {
  it('runs due jobs, retries with backoff, and gives up after max attempts', async () => {
    const s = setup()
    let calls = 0
    const id = enqueueJob(s.ctx, 'send_email', { to: 'x' }, { maxAttempts: 2 })
    let finalFailures = 0
    const handlers = { send_email: { run: () => { calls++; throw new Error('smtp down') }, onFinalFailure: () => { finalFailures++ } } }
    await runJobsOnce(s.ctx, handlers)
    expect(getJob(s.ctx, id)?.state).toBe('queued')
    expect(getJob(s.ctx, id)?.lastError).toBe('smtp down')
    expect(await runJobsOnce(s.ctx, handlers)).toBe(0) // not due yet
    s.clock.advance(31_000)
    await runJobsOnce(s.ctx, handlers)
    expect(getJob(s.ctx, id)?.state).toBe('failed')
    expect(calls).toBe(2)
    expect(finalFailures).toBe(1)
  })

  it('scheduled jobs wait for run_at, and expired leases are reclaimed', async () => {
    const s = setup()
    enqueueJob(s.ctx, 'publish', {}, { runAt: new Date(s.clock.t + 60_000) })
    expect(claimNextJob(s.ctx, 'publish')).toBeUndefined()
    s.clock.advance(61_000)
    const job = claimNextJob(s.ctx, 'publish')!
    expect(job.state).toBe('running')
    expect(claimNextJob(s.ctx, 'publish')).toBeUndefined()
    s.clock.advance(LEASE_MS + 1)
    expect(claimNextJob(s.ctx, 'publish')?.id).toBe(job.id)
    expect(s.ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()?.state).toBe('running')
  })
})

describe('auth', () => {
  it('hashes and verifies passwords', async () => {
    const h = hashPassword('correct horse battery')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery', h)).toBe(true)
    expect(verifyPassword('wrong', h)).toBe(false)
  })

  it('logs in, keeps sessions alive, and expires idle ones', async () => {
    const s = setup()
    expect(checkLogin(s.ctx, 'ASHA@example.org', 'a-long-test-password')?.name).toBe('asha')
    expect(checkLogin(s.ctx, 'asha@example.org', 'nope')).toBeNull()
    expect(checkLogin(s.ctx, 'nobody@example.org', 'a-long-test-password')).toBeNull()
    const { token } = createSession(s.ctx, s.editor.id)
    expect(getSessionUser(s.ctx, token)?.id).toBe(s.editor.id)
    expect(getSessionUser(s.ctx, 'forged')).toBeNull()
    s.clock.advance(SESSION_IDLE_MS + 1)
    expect(getSessionUser(s.ctx, token)).toBeNull()
  })

  it('invites set a password once, and weak passwords are refused', async () => {
    const s = setup()
    const { inviteToken, user } = createUser(s.ctx, { email: 'new@example.org', name: 'New', role: 'editor' })
    expect(user.status).toBe('invited')
    expect(() => acceptInvite(s.ctx, inviteToken!, 'New Person', 'short')).toThrow(AppError)
    acceptInvite(s.ctx, inviteToken!, 'New Person', 'a-much-longer-password')
    expect(checkLogin(s.ctx, 'new@example.org', 'a-much-longer-password')?.status).toBe('active')
    expect(() => acceptInvite(s.ctx, inviteToken!, 'x', 'a-much-longer-password')).toThrow(/expired or was already used/)
  })

  it('encrypts secrets with the server key', async () => {
    const s = setup()
    const key = randomBytes(32)
    const c = encryptSecret(key, 'sk-test')
    expect(c).not.toContain('sk-test')
    expect(decryptSecret(key, c)).toBe('sk-test')
    expect(() => decryptSecret(randomBytes(32), c)).toThrow()
    setSecret(s.ctx, key, 'ai_api_key', 'sk-1', s.admin.id)
    setSecret(s.ctx, key, 'ai_api_key', 'sk-2', s.admin.id)
    expect(getSecret(s.ctx, key, 'ai_api_key')).toBe('sk-2')
  })
})

describe('AI sessions and tools', () => {
  it('a page edit session edits only its page, through the same validation', async () => {
    const s = setup()
    const a = createPage(s.ctx, s.editor, { title: 'A', template: 'standard' }).page
    const b = createPage(s.ctx, s.editor, { title: 'B', template: 'standard' }).page
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: a.id })

    const ok = await runTool(s.ctx, s.editor, session.id, 'add_block', { block: { type: 'Hero', props: { heading: 'Hi', image: IMG } } })
    expect(ok.ok).toBe(true)
    expect(getPage(s.ctx, a.id).doc.blocks).toHaveLength(1)

    const other = await runTool(s.ctx, s.editor, session.id, 'add_block', { pageId: b.id, block: { type: 'Quote', props: { text: 'x' } } })
    expect(other).toMatchObject({ ok: false })
    expect(getPage(s.ctx, b.id).doc.blocks).toHaveLength(0)

    expect(await runTool(s.ctx, s.editor, session.id, 'edit_menu', {})).toMatchObject({ ok: false })
    expect(await runTool(s.ctx, s.editor, session.id, 'publish', {})).toMatchObject({ ok: false })

    const invalid = await runTool(s.ctx, s.editor, session.id, 'add_block', { block: { type: 'Hero', props: { heading: 'x'.repeat(200), image: IMG } } })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.fields?.[0]?.path).toBe('blocks.1.props.heading')
  })

  it('admins are bound to one target too, and others cannot use your session', async () => {
    const s = setup()
    const a = createPage(s.ctx, s.admin, { title: 'A', template: 'standard' }).page
    const session = startAiSession(s.ctx, s.admin, { taskType: 'page_edit', targetId: a.id })
    expect(await runTool(s.ctx, s.admin, session.id, 'set_template_rules', {})).toMatchObject({ ok: false })
    await expect(runTool(s.ctx, s.editor, session.id, 'get_page', {})).rejects.toThrow(/wasn't found/)
    expect(() => startAiSession(s.ctx, s.editor, { taskType: 'template', targetId: 'tpl_x' })).toThrow(AppError)
  })

  it('records AI work as one sealed version per turn, undoable by the person', async () => {
    const s = setup()
    const session = startAiSession(s.ctx, s.editor, { taskType: 'new_page' })
    await runTool(s.ctx, s.editor, session.id, 'set_meta', { title: 'Winter appeal' })
    await runTool(s.ctx, s.editor, session.id, 'add_block', { block: { type: 'Quote', props: { text: 'Warm' } } })
    endAiTurn(s.ctx, s.editor, session.id)
    const versions = listVersions(s.ctx, session.targetId)
    expect(versions.filter((v) => v.kind === 'ai')).toHaveLength(1)
    expect(versions.find((v) => v.kind === 'ai')?.sealed).toBe(true)
  })

  it('list_blocks gives JSON Schemas for the allowed sections only; remember only proposes', async () => {
    const s = setup()
    const a = createPage(s.ctx, s.editor, { title: 'S', template: 'story' }).page
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: a.id })
    const res = await runTool(s.ctx, s.editor, session.id, 'list_blocks')
    expect(res.ok).toBe(true)
    if (res.ok) {
      const blocks = res.result as { type: string; purpose?: string; good?: { note: string }; bad?: { note: string } }[]
      expect(blocks.map((b) => b.type)).toEqual(getTemplateRules(s.ctx, 'story')!.allowedBlocks)
      for (const block of blocks) {
        expect(block.purpose, block.type).toBeTruthy()
        expect(block.good?.note, block.type).toBeTruthy()
        expect(block.bad?.note, block.type).toBeTruthy()
      }
    }
    await runTool(s.ctx, s.editor, session.id, 'remember', { text: 'Always say rescue, never shelter' })
    expect(s.ctx.db.select().from(memoryEntries).get()?.state).toBe('proposed')
  })
})

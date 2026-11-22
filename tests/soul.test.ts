import { eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { handleRpc, type RpcRequest } from '../server/services/agent/mcp'
import { getSite } from '../server/services/agent/gateway'
import { startAiSession } from '../server/services/ai'
import { buildTurnMessages } from '../server/services/ai-context'
import { ALT_TEXT_SYSTEM_PROMPT } from '../server/services/alt-text'
import { AppError } from '../server/services/errors'
import { createPage } from '../server/services/pages'
import { interviewSystemPrompt } from '../server/services/page-brief'
import { getSoul, saveSoul } from '../server/services/soul'
import { auditEvents, sites } from '../server/db/schema'
import { DEFAULT_SOUL, personalitySection, soulForPrompt, storedSoul, stripSoulComments } from '../shared/soul'
import { mergeSettings, readSettings, settingsPatchSchema, siteSettingsSchema } from '../shared/settings'
import { world } from './agent-helpers'
import { setup } from './helpers'

const ANCHOR = 'Write in plain English, with British spelling.'

let sqlite: { close: () => void } | undefined

afterEach(() => {
  sqlite?.close()
  sqlite = undefined
})

function open() {
  const s = setup()
  sqlite = s.sqlite
  return s
}

function writeStored(ctx: ReturnType<typeof open>['ctx'], soul: string | null) {
  const row = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = { ...readSettings(row.settings), soul }
  ctx.db.update(sites).set({ settings }).where(eq(sites.id, ctx.siteId)).run()
}

describe('stripSoulComments', () => {
  it('removes comments everywhere, collapses blank lines, and trims', () => {
    expect(stripSoulComments('keep <!--\nhidden\nstill\n--> stay')).toBe('keep  stay')
    expect(stripSoulComments('keep <!-- secret\nand the rest')).toBe('keep')
    const fenced = '```\nvisible <!-- no --> still\n```'
    expect(stripSoulComments(fenced)).not.toContain('<!--')
    expect(stripSoulComments(fenced)).toContain('visible')
    expect(stripSoulComments(fenced)).toContain('still')
    expect(stripSoulComments('a\n\n\n\nb')).toBe('a\n\n\nb')
    expect(stripSoulComments('a\n\n\nb')).toBe('a\n\n\nb')
    expect(stripSoulComments('  \nhello <!-- x --> world\n  ')).toContain('hello')
    expect(stripSoulComments('  \nhello <!-- x --> world\n  ')).toContain('world')
    expect(stripSoulComments('  \nhello <!-- x --> world\n  ')).not.toContain('<!--')
  })
})

describe('storage', () => {
  it('parses settings from before this field', () => {
    expect(siteSettingsSchema.parse({ titlePattern: 'News' }).soul).toBeNull()
    expect(readSettings({}).soul).toBeNull()
    expect(readSettings({ titlePattern: '{page} | {site}' }).soul).toBeNull()
    expect(settingsPatchSchema.safeParse({ soul: 'hello' }).success).toBe(false)
    const current = readSettings({ soul: 'custom voice' })
    const next = mergeSettings(current, { ai: { enabled: true } })
    expect(next.soul).toBe('custom voice')
    expect(next.ai.enabled).toBe(true)
  })

  it('stores null for the shipped file and a string for a comment-only edit', () => {
    expect(storedSoul(DEFAULT_SOUL)).toBeNull()
    const edited = DEFAULT_SOUL.replace('how the charity sounds', 'how the charity sounds to visitors')
    expect(edited).not.toBe(DEFAULT_SOUL)
    expect(storedSoul(edited)).toBe(edited)
    const s = open()
    const saved = saveSoul(s.ctx, s.admin, DEFAULT_SOUL)
    expect(saved.isDefault).toBe(true)
    expect(saved.text).toBe(DEFAULT_SOUL)
    expect(saved.defaultText).toBe(DEFAULT_SOUL)
    expect(readSettings(s.ctx.db.select().from(sites).where(eq(sites.id, s.ctx.siteId)).get()!.settings).soul).toBeNull()
    const again = getSoul(s.ctx)
    expect(again.isDefault).toBe(true)
    expect(again.text).toBe(DEFAULT_SOUL)
    const custom = saveSoul(s.ctx, s.admin, edited)
    expect(custom.isDefault).toBe(false)
    expect(readSettings(s.ctx.db.select().from(sites).where(eq(sites.id, s.ctx.siteId)).get()!.settings).soul).toBe(edited)
    const audit = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'settings.soul.updated')).all()
    expect(audit.at(-1)?.details).toEqual({ isDefault: false, strippedLength: stripSoulComments(edited).length })
    expect(JSON.stringify(audit.at(-1)?.details)).not.toContain(ANCHOR)
  })

  it('refuses a stripped personality over 48,000 and a raw text over 200,000', () => {
    const s = open()
    const before = getSoul(s.ctx)
    try {
      saveSoul(s.ctx, s.admin, 'a'.repeat(48_001))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const app = error as AppError
      expect(app.code).toBe('validation_failed')
      expect(app.message).toContain('48,000')
      expect(app.message).toContain('48001')
    }
    expect(getSoul(s.ctx).text).toBe(before.text)
    const allowed = saveSoul(s.ctx, s.admin, 'a'.repeat(48_000))
    expect(allowed.strippedLength).toBe(48_000)
    expect(allowed.isDefault).toBe(false)
    try {
      saveSoul(s.ctx, s.admin, 'b'.repeat(200_001))
      expect.unreachable()
    } catch (error) {
      expect((error as AppError).code).toBe('validation_failed')
      expect((error as AppError).message).toContain('200,000')
    }
    expect(getSoul(s.ctx).text).toBe('a'.repeat(48_000))
    expect(() => saveSoul(s.ctx, s.editor, 'no')).toThrow(AppError)
    expect(() => saveSoul(s.ctx, { ...s.admin, aiSessionId: 'ai_test' }, 'no')).toThrow(AppError)
  })
})

describe('injection', () => {
  it('adds the stripped personality to the assistant and the page brief, and not to alt text', () => {
    const s = open()
    const { page } = createPage(s.ctx, s.admin, { title: 'About', template: 'standard' })
    const session = startAiSession(s.ctx, s.admin, { taskType: 'page_edit', targetId: page.id })
    const system = buildTurnMessages(s.ctx, s.admin, session, [], 'Hello')[0]!.content!
    expect(system.startsWith('You are the sitebuilder assistant.')).toBe(true)
    expect(system).toContain(ANCHOR)
    expect(system).toContain('Site personality')
    expect(system).not.toContain('<!--')
    expect(system.indexOf('Site personality')).toBeLessThan(system.indexOf('Task:'))

    writeStored(s.ctx, '<!-- only a note -->')
    const empty = buildTurnMessages(s.ctx, s.admin, session, [], 'Hello')[0]!.content!
    expect(empty).not.toContain('Site personality')
    expect(empty).not.toContain(ANCHOR)
    expect(personalitySection('')).toBe('')

    const brief = interviewSystemPrompt({ templates: ['standard'], embeds: [] }, [], 0, soulForPrompt(null))
    expect(brief).toContain('Site personality')
    expect(brief).toContain(ANCHOR)
    expect(brief).toContain('The reply is still a single JSON object.')
    expect(brief).not.toContain('<!--')
    expect(interviewSystemPrompt({ templates: ['standard'], embeds: [] }, [], 0, '')).not.toContain('Site personality')
    expect(ALT_TEXT_SYSTEM_PROMPT).not.toContain('Site personality')
  })

  it('gives agents the stripped personality and omits it when empty', async () => {
    const w = await world()
    sqlite = w.sqlite
    const site = getSite(w.ctx, w.agent) as { personality?: string }
    expect(site.personality).toContain(ANCHOR)
    expect(site.personality).not.toContain('<!--')
    const rpc = (method: string, params?: Record<string, unknown>): RpcRequest => ({ jsonrpc: '2.0', id: 1, method, params })
    const listed = (handleRpc(w.ctx, w.agent, rpc('resources/list')) as { result: { resources: { uri: string }[] } }).result.resources
    expect(listed.map((r) => r.uri)).toContain('sitebuilder://soul')
    const read = (handleRpc(w.ctx, w.agent, rpc('resources/read', { uri: 'sitebuilder://soul' })) as { result: { contents: { mimeType: string; text: string }[] } }).result.contents[0]!
    expect(read.mimeType).toBe('text/markdown')
    expect(read.text).toContain(ANCHOR)
    expect(read.text).not.toContain('<!--')

    writeStored(w.ctx, '<!-- nothing for the model -->')
    expect(getSite(w.ctx, w.agent)).not.toHaveProperty('personality')
    const empty = (handleRpc(w.ctx, w.agent, rpc('resources/read', { uri: 'sitebuilder://soul' })) as { result: { contents: { text: string }[] } }).result.contents[0]!
    expect(empty.text).toBe('')
    expect((handleRpc(w.ctx, w.agent, rpc('resources/list')) as { result: { resources: { uri: string }[] } }).result.resources.map((r) => r.uri)).toContain('sitebuilder://soul')
  })
})

describe('the shipped soul.md', () => {
  it('is what the app loads (run npm run soul-default after editing soul.md)', () => {
    expect(DEFAULT_SOUL).toBe(readFileSync(new URL('../shared/soul/soul.md', import.meta.url), 'utf8'))
  })
})

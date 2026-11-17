// HTTP tests for "New page with the assistant". The shared API server leaves
// the assistant off; this file starts its own builder with a scripted mock.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from './client'
import { ADMIN_EMAIL, PASSWORD, startServer, type TestServer } from './server'

const QUESTION = {
  kind: 'question',
  question: {
    id: 'cta',
    prompt: 'What should people do when they reach the page?',
    chips: ['Give through our donation form', 'Follow a donate link', 'Read the story — no ask yet'],
    allowFreeText: true,
  },
}

const PLAN = {
  kind: 'plan',
  plan: {
    title: 'Winter blanket appeal',
    slug: 'winter-blanket-appeal',
    template: 'campaign',
    purpose: 'Raise gifts for blankets',
    audience: 'Existing supporters',
    usage: 'campaign',
    contentNotes: 'A story, photos later.',
    cta: { kind: 'donation', label: 'Donate now', href: '#donate' },
    tone: 'primary',
    sections: [
      { type: 'Hero', purpose: 'Open the appeal' },
      { type: 'ImpactTiers', purpose: 'Gift amounts' },
      { type: 'DonationProgress', purpose: 'Progress' },
      { type: 'MatchBanner', purpose: 'Match' },
      { type: 'StoryBeforeAfter', purpose: 'Story' },
      { type: 'TrustStrip', purpose: 'Trust' },
      { type: 'CallToAction', purpose: 'Ask' },
    ],
    seoTitle: 'Winter blanket appeal',
    seoDescription: 'Help keep street animals warm.',
    summary: "Here's what I'll build: a winter blanket appeal with story, amounts, progress and an ask.",
  },
}

describe('page briefs when the assistant is off', () => {
  let server: TestServer
  let admin: Client

  beforeAll(async () => {
    server = await startServer()
    admin = new Client(server.baseUrl)
    await admin.login(ADMIN_EMAIL, PASSWORD)
  })
  afterAll(() => server.stop())

  it('returns a friendly error and does not create a page', async () => {
    const started = await admin.post('/ai/page-briefs', { prompt: 'A winter blanket appeal' })
    expect(started.status).toBe(503)
    expect(started.body.error.code).toBe('ai_unavailable')
    expect(started.body.error.message).toMatch(/isn't switched on/i)
    const pages = await admin.get('/pages')
    expect(pages.status).toBe(200)
    expect(pages.body.items.some((p: { path: string }) => p.path === '/winter-blanket-appeal')).toBe(false)
  })
})

describe('page briefs with a mocked provider', () => {
  let server: TestServer
  let admin: Client
  let anon: Client

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-brief-'))
    const replies = join(dir, 'replies.json')
    writeFileSync(replies, JSON.stringify([QUESTION, PLAN, PLAN, PLAN]))
    server = await startServer({ SITEBUILDER_AI_PROVIDER: 'mock', SITEBUILDER_AI_MOCK_REPLIES: replies })
    admin = new Client(server.baseUrl)
    anon = new Client(server.baseUrl)
    await admin.login(ADMIN_EMAIL, PASSWORD)
    const settings = await admin.patch('/settings', { ai: { enabled: true, provider: 'xai', model: 'grok-4' } })
    expect(settings.status).toBe(200)
    // Seed creates an editor we can log in as? Global seed uses ADMIN only unless seed users exist.
  })
  afterAll(() => server.stop())

  it('rejects anonymous requests', async () => {
    expect((await anon.post('/ai/page-briefs', { prompt: 'A page' })).status).toBe(401)
  })

  it('runs the interview, builds a draft, and can save a draft page type', async () => {
    const started = await admin.post('/ai/page-briefs', { prompt: 'A winter blanket appeal for existing supporters.' })
    expect(started.status).toBe(200)
    expect(started.body.state).toBe('interviewing')
    expect(started.body.question.id).toBe('cta')
    expect(started.body.pageId).toBeFalsy()

    const listed = await admin.get('/pages')
    expect(listed.body.items.some((p: { path: string }) => p.path === '/winter-blanket-appeal')).toBe(false)

    const answered = await admin.post(`/ai/page-briefs/${started.body.id}/answers`, { questionId: 'cta', chip: 'Give through our donation form' })
    expect(answered.status).toBe(200)
    expect(answered.body.state).toBe('planned')
    expect(answered.body.plan.title).toBe('Winter blanket appeal')

    const built = await admin.post(`/ai/page-briefs/${started.body.id}/build`, { saveAsTemplate: true })
    expect(built.status).toBe(200)
    expect(built.body.state).toBe('built')
    expect(built.body.pageId).toMatch(/^pg_/)
    expect(built.body.templateId).toMatch(/^tpl_/)

    const page = await admin.get(`/pages/${built.body.pageId}`)
    expect(page.status).toBe(200)
    expect(page.body.page.workflowState).toBe('draft')
    expect(page.body.page.publishedVersionId).toBeNull()
    expect(page.body.page.title).toBe('Winter blanket appeal')
    expect(page.body.doc.seo.title).toBe('Winter blanket appeal')
    const types = page.body.doc.blocks.map((b: { type: string }) => b.type)
    expect(types).toEqual(expect.arrayContaining(['Hero', 'ImpactTiers', 'DonationProgress', 'MatchBanner', 'StoryBeforeAfter']))
    expect(types).not.toContain('TrustStrip')

    const template = await admin.get(`/templates/${built.body.templateId}`)
    expect(template.status).toBe(200)
    expect(template.body.template.workflowState).toBe('draft')
    expect(template.body.template.publishedVersionId).toBeNull()
  })
})

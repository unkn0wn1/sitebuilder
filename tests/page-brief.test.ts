import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { answerPageBrief, buildPageBrief, startPageBrief } from '../server/services/page-brief'
import { assistantText, mockProvider, ProviderError } from '../server/services/ai-provider'
import { resetAiCircuitBreaker } from '../server/services/ai-loop'
import { getPage } from '../server/services/pages'
import { getTemplate } from '../server/services/templates'
import { pages, sites } from '../server/db/schema'
import { readSettings } from '../shared/settings'
import { PLACEHOLDER_MARK } from '../shared/page-brief'
import { setup } from './helpers'

function enableAi(ctx: ReturnType<typeof setup>['ctx'], patch: Record<string, unknown> = {}) {
  const current = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(current.settings)
  ctx.db.update(sites).set({ settings: { ...settings, ai: { ...settings.ai, enabled: true, ...patch } } }).where(eq(sites.id, ctx.siteId)).run()
}

const QUESTION = {
  kind: 'question',
  question: {
    id: 'audience',
    prompt: 'Who is it mainly for?',
    chips: ['Existing supporters', 'New visitors'],
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

afterEach(() => {
  resetAiCircuitBreaker()
})

describe('page brief interview', () => {
  it('refuses to start when the assistant is off', async () => {
    const s = setup()
    await expect(startPageBrief(s.ctx, s.editor, 'A winter blanket appeal')).rejects.toMatchObject({ code: 'ai_unavailable' })
    expect(s.ctx.db.select().from(pages).all()).toHaveLength(0)
    s.sqlite.close()
  })

  it('asks a question, then plans, then builds a draft and never publishes', async () => {
    const s = setup()
    enableAi(s.ctx)
    s.ctx.aiProvider = mockProvider([assistantText(JSON.stringify(QUESTION)), assistantText(JSON.stringify(PLAN))])
    const started = await startPageBrief(s.ctx, s.editor, 'A winter blanket appeal for existing supporters.')
    expect(started.state).toBe('interviewing')
    expect(started.question?.id).toBe('audience')
    expect(started.question?.chips).toContain('Existing supporters')
    expect(s.ctx.db.select().from(pages).all()).toHaveLength(0)

    const planned = await answerPageBrief(s.ctx, s.editor, started.id, { questionId: 'audience', chip: 'Existing supporters' })
    expect(planned.state).toBe('planned')
    expect(planned.plan?.title).toBe('Winter blanket appeal')
    expect(planned.plan?.summary).toContain("Here's what I'll build")
    expect(s.ctx.db.select().from(pages).all()).toHaveLength(0)

    const built = await buildPageBrief(s.ctx, s.editor, started.id, { saveAsTemplate: true })
    expect(built.state).toBe('built')
    expect(built.pageId).toBeTruthy()
    expect(built.templateId).toBeFalsy() // editors cannot save page types
    const pack = getPage(s.ctx, built.pageId!)
    expect(pack.page.workflowState).toBe('draft')
    expect(pack.page.publishedVersionId).toBeNull()
    expect(pack.page.title).toBe('Winter blanket appeal')
    expect(pack.page.path).toBe('/winter-blanket-appeal')
    expect(pack.doc.seo.title).toBe('Winter blanket appeal')
    const types = pack.doc.blocks.map((b) => b.type)
    expect(types).toEqual(expect.arrayContaining(['Hero', 'ImpactTiers', 'DonationProgress', 'MatchBanner', 'StoryBeforeAfter', 'TrustStrip', 'CallToAction']))
    expect(JSON.stringify(pack.doc)).toContain(PLACEHOLDER_MARK)
    expect(JSON.stringify(pack.doc)).not.toContain('87,400')
    s.sqlite.close()
  })

  it('lets an admin save the structure as a draft page type, and falls back if the model errors', async () => {
    const s = setup()
    enableAi(s.ctx)
    s.ctx.aiProvider = mockProvider([
      async () => {
        throw new ProviderError('upstream down')
      },
      assistantText(JSON.stringify(PLAN)),
    ])
    const started = await startPageBrief(s.ctx, s.admin, 'Winter blanket appeal, campaign, donation form, warm tone, I have notes only.')
    expect(started.state).toBe('interviewing')
    expect(started.question).toBeTruthy()
    expect(started.warning).toMatch(/couldn't reach the assistant/i)

    const planned = await answerPageBrief(s.ctx, s.admin, started.id, { questionId: started.question!.id, text: 'For our existing supporters.' })
    expect(planned.state).toBe('planned')
    const built = await buildPageBrief(s.ctx, s.admin, started.id, { saveAsTemplate: true })
    expect(built.templateId).toBeTruthy()
    const template = getTemplate(s.ctx, built.templateId!)
    expect(template.template.workflowState).toBe('draft')
    expect(template.template.publishedVersionId).toBeNull()
    expect(template.doc.label).toContain('assistant')
    s.sqlite.close()
  })

  it('enriches a lean plan and honours unchecked sections at Build', async () => {
    const s = setup()
    enableAi(s.ctx)
    const lean = {
      ...PLAN,
      plan: {
        ...PLAN.plan,
        sections: [
          { type: 'Hero', purpose: 'Open the appeal' },
          { type: 'StoryBeforeAfter', purpose: 'Story' },
          { type: 'DonationEmbed', purpose: 'The form' },
        ],
        summary: 'A short draft.',
      },
    }
    s.ctx.aiProvider = mockProvider([assistantText(JSON.stringify(lean))])
    const started = await startPageBrief(s.ctx, s.editor, 'A winter blanket appeal, campaign, use the donation form, I have a story and photos, warm tone.')
    expect(started.state).toBe('planned')
    const types = started.plan?.sections.map((s) => s.type) ?? []
    expect(types).toEqual([
      'Hero',
      'MatchBanner',
      'ImpactTiers',
      'DonationProgress',
      'StoryBeforeAfter',
      'DonationEmbed',
      'TrustStrip',
      'CallToAction',
    ])

    const built = await buildPageBrief(s.ctx, s.editor, started.id, {
      sections: [
        { type: 'Hero', purpose: 'Open the appeal' },
        { type: 'StoryBeforeAfter', purpose: 'Story' },
        { type: 'CallToAction', purpose: 'A short closing ask' },
      ],
    })
    const pack = getPage(s.ctx, built.pageId!)
    expect(pack.doc.blocks.map((b) => b.type)).toEqual(['Hero', 'StoryBeforeAfter', 'CallToAction'])
    s.sqlite.close()
  })
})

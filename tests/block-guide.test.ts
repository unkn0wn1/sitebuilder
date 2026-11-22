import { describe, expect, it } from 'vitest'
import {
  PAGE_TYPE_EXAMPLES,
  blocksMissingAiGuide,
  enrichPlanSections,
  formatBlockAiCatalog,
  formatPageTypeExamples,
  formatPlannerGuidance,
  listBlockAiSummaries,
  recommendedSections,
} from '../shared/ai/block-guide'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { pagePlanSchema, type PagePlan } from '../shared/page-brief'

describe('block AI guides', () => {
  it('gives every registered block a complete guide, including a good example and a bad anti-pattern', () => {
    const registry = createDefaultRegistry()
    const types = registry.list().map((d) => d.type)
    expect(types.length).toBeGreaterThanOrEqual(18)
    expect(blocksMissingAiGuide()).toEqual([])

    const known = new Set(types)
    for (const def of registry.list()) {
      const guide = def.ai
      expect(guide, def.type).toBeTruthy()
      expect(guide!.purpose.trim().length).toBeGreaterThan(20)
      expect(guide!.useWhen.trim().length).toBeGreaterThan(10)
      expect(guide!.avoidWhen.trim().length).toBeGreaterThan(10)
      expect(guide!.fields.trim().length).toBeGreaterThan(10)
      expect(guide!.good.note.trim().length).toBeGreaterThan(10)
      expect(guide!.bad.note.trim().length).toBeGreaterThan(10)
      expect(guide!.good.props).toBeTruthy()
      expect(guide!.bad.props).toBeTruthy()
      for (const partner of guide!.pairsWith) {
        expect(known.has(partner), `${def.type} pairsWith unknown type ${partner}`).toBe(true)
      }
      const parsed = def.props.safeParse(guide!.good.props)
      expect(parsed.success, `${def.type} good props should be valid: ${parsed.success ? '' : parsed.error.message}`).toBe(true)
    }

    const catalog = formatBlockAiCatalog()
    for (const type of types) {
      expect(catalog).toContain(`### ${type} (`)
    }
    expect(catalog).toMatch(/Good:/)
    expect(catalog).toMatch(/Bad:/)
    expect(catalog).toMatch(/bare amounts/i)
    expect(catalog).toMatch(/no goal/i)
    expect(catalog).toMatch(/ungrouped|mix/i)
  })

  it('includes a worked example for campaign, story, evergreen/about and event pages', () => {
    const usages = PAGE_TYPE_EXAMPLES.map((e) => e.usage)
    expect(usages).toEqual(['campaign', 'story', 'evergreen', 'event'])
    for (const example of PAGE_TYPE_EXAMPLES) {
      expect(example.why.trim().length).toBeGreaterThan(40)
      expect(pagePlanSchema.safeParse(example.plan).success, example.label).toBe(true)
      expect(example.plan.sections.length).toBeGreaterThanOrEqual(5)
    }
    const text = formatPageTypeExamples()
    expect(text).toContain('Winter Blanket Appeal')
    expect(text).toContain('Mala’s recovery')
    expect(text).toContain('Help street animals all year')
    expect(text).toContain('Hospital open day')
    expect(text).toContain('Why this structure:')

    const briefing = formatPlannerGuidance()
    expect(briefing).toContain('Recommended outlines:')
    expect(briefing).toContain('Worked examples')
    expect(briefing).toContain('Section catalogue')
    expect(listBlockAiSummaries()).toHaveLength(createDefaultRegistry().list().length)
  })

  it('names the four Hero layouts and points several clips at Hero', () => {
    expect(blocksMissingAiGuide()).toEqual([])
    const registry = createDefaultRegistry()
    const hero = registry.get('Hero')!.ai!
    expect(hero.fields).toMatch(/single photo/i)
    expect(hero.fields).toMatch(/single video/i)
    expect(hero.fields).toMatch(/photo carousel/i)
    expect(hero.fields).toMatch(/video carousel/i)
    expect(hero.fields).toMatch(/real photo/i)
    expect(hero.fields).toMatch(/video from the library/i)
    expect(hero.fields).toContain('Do not stack a Hero and a VideoHero')
    expect(hero.fields).toContain('Do not invent statistics')
    expect(hero.good.props).not.toHaveProperty('mode')
    const video = registry.get('VideoHero')!.ai!
    expect(video.fields).toMatch(/single clip/i)
    expect(video.fields).toContain('Several clips belong on Hero')
  })
})

describe('recommended and enriched outlines', () => {
  function plan(overrides: Partial<PagePlan> = {}): PagePlan {
    return pagePlanSchema.parse({
      title: 'Winter Blanket Appeal',
      slug: 'winter-blanket-appeal',
      template: 'campaign',
      purpose: 'Raise gifts for blankets',
      usage: 'campaign',
      cta: { kind: 'donation', label: 'Donate now', href: '#donate' },
      tone: 'primary',
      sections: [
        { type: 'Hero', purpose: 'Open the appeal' },
        { type: 'StoryBeforeAfter', purpose: 'A story' },
        { type: 'DonationEmbed', purpose: 'The form' },
      ],
      summary: 'A short lean plan.',
      ...overrides,
    })
  }

  it('defaults a campaign to the richer structure, including a closing ask', () => {
    expect(recommendedSections('campaign').map((s) => s.type)).toEqual([
      'Hero',
      'MatchBanner',
      'ImpactTiers',
      'DonationProgress',
      'StoryBeforeAfter',
      'DonationEmbed',
      'TrustStrip',
      'CallToAction',
    ])
  })

  it('drops the match banner or progress bar only when the person has ruled them out', () => {
    const noMatch = recommendedSections('campaign', { prompt: 'A winter appeal with no deadline or match, goal of ₹2,50,000' })
    expect(noMatch.map((s) => s.type)).not.toContain('MatchBanner')
    expect(noMatch.map((s) => s.type)).toContain('DonationProgress')

    const noGoal = recommendedSections('campaign', { prompt: 'A winter appeal with no goal, ending on Giving Tuesday' })
    expect(noGoal.map((s) => s.type)).not.toContain('DonationProgress')
    expect(noGoal.map((s) => s.type)).toContain('MatchBanner')
  })

  it('keeps evergreen pages free of a match or progress bar unless asked', () => {
    expect(recommendedSections('evergreen').map((s) => s.type)).toEqual([
      'Hero',
      'RichText',
      'ImpactTiers',
      'TrustStrip',
      'DonationEmbed',
      'FAQ',
    ])
    expect(recommendedSections('event').map((s) => s.type)).toContain('MatchBanner')
    expect(recommendedSections('story').map((s) => s.type)).toEqual([
      'Hero',
      'RichText',
      'StoryBeforeAfter',
      'Quote',
      'TrustStrip',
      'CallToAction',
    ])
  })

  it('enriches a lean model plan with the missing recommended sections, without dropping extras', () => {
    const enriched = enrichPlanSections(plan())
    expect(enriched.sections.map((s) => s.type)).toEqual([
      'Hero',
      'MatchBanner',
      'ImpactTiers',
      'DonationProgress',
      'StoryBeforeAfter',
      'DonationEmbed',
      'TrustStrip',
      'CallToAction',
    ])
    expect(enriched.sections.find((s) => s.type === 'StoryBeforeAfter')?.purpose).toBe('A story')
    expect(enriched.summary).toContain("Here's what I'll build:")

    const withFaq = enrichPlanSections(plan({ sections: [...plan().sections, { type: 'FAQ', purpose: 'Extra questions' }] }))
    expect(withFaq.sections.map((s) => s.type)).toContain('FAQ')
  })
})

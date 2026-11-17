import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { PLACEHOLDER_MARK, pagePlanSchema, type PagePlan } from '../shared/page-brief'
import { runChecks } from '../shared/checks'
import {
  composePageFromPlan,
  extractJson,
  planFromAnswers,
  slugifyTitle,
  validateAndRepairBlock,
} from '../shared/page-compose'

const EMBED = 'emb_00000000000000000000000001'
const PHOTO = { id: 'med_00000000000000000000000009', alt: 'A rescued dog' }

function campaignPlan(overrides: Partial<PagePlan> = {}): PagePlan {
  return pagePlanSchema.parse({
    title: 'Winter blanket appeal',
    slug: 'winter-blanket-appeal',
    template: 'campaign',
    purpose: 'Raise gifts for winter blankets',
    audience: 'Existing supporters',
    usage: 'campaign',
    contentNotes: 'We have a rescue story and will add photos later.',
    cta: { kind: 'donation', embedId: EMBED, label: 'Donate now', href: '#donate' },
    tone: 'primary',
    sections: [
      { type: 'Hero', purpose: 'Open the appeal' },
      { type: 'MatchBanner', purpose: 'Deadline or match' },
      { type: 'StoryBeforeAfter', purpose: 'A rescue story' },
      { type: 'ImpactTiers', purpose: 'Gift amounts' },
      { type: 'DonationProgress', purpose: 'Progress' },
      { type: 'TrustStrip', purpose: 'Trust marks' },
      { type: 'DonationEmbed', purpose: 'The form' },
      { type: 'FAQ', purpose: 'Common questions' },
    ],
    seoTitle: 'Winter blanket appeal',
    seoDescription: 'Help keep street animals warm this winter.',
    summary: "Here's what I'll build: a winter blanket appeal with a story, gift amounts, progress and a donation form.",
    ...overrides,
  })
}

describe('composePageFromPlan', () => {
  it('composes a campaign draft from a plan, including the campaign blocks', () => {
    const page = composePageFromPlan(campaignPlan(), {
      images: [PHOTO],
      embeds: [{ id: EMBED, name: 'Winter form', kind: 'virtuous' }],
      knownTemplates: ['home', 'standard', 'campaign', 'story'],
    })
    expect(page.title).toBe('Winter blanket appeal')
    expect(page.slug).toBe('winter-blanket-appeal')
    expect(page.template).toBe('campaign')
    expect(page.seoTitle).toBe('Winter blanket appeal')
    expect(page.seoDescription).toContain('warm this winter')
    expect(page.blocks.map((b) => b.type)).toEqual([
      'Hero',
      'MatchBanner',
      'StoryBeforeAfter',
      'ImpactTiers',
      'DonationProgress',
      'DonationEmbed',
      'FAQ',
    ])
    expect(page.blocks.some((b) => b.type === 'TrustStrip')).toBe(false)
    const hero = page.blocks[0]!.props as { heading: string; tone: string; image: { media: string } }
    expect(hero.heading).toBe('Winter blanket appeal')
    expect(hero.tone).toBe('primary')
    expect(hero.image.media).toBe(PHOTO.id)
    const progress = page.blocks.find((b) => b.type === 'DonationProgress')!.props as { raised: string; goal: string; label: string }
    expect(progress.raised).toBe('TBC')
    expect(progress.goal).toBe('TBC')
    expect(progress.label).toContain(PLACEHOLDER_MARK)
    expect(JSON.stringify(page.blocks)).not.toContain('87,400')
    expect(JSON.stringify(page.blocks)).not.toContain('2,50,000')
    expect(page.placeholderCount).toBeGreaterThan(0)
    const form = page.blocks.find((b) => b.type === 'DonationEmbed')!.props as { embed: string }
    expect(form.embed).toBe(EMBED)
  })

  it('omits TrustStrip when no real marks exist, even if the plan asked for one', () => {
    const page = composePageFromPlan(campaignPlan(), {
      images: [PHOTO],
      embeds: [{ id: EMBED, name: 'Winter form', kind: 'virtuous' }],
      knownTemplates: ['home', 'standard', 'campaign', 'story'],
    })
    expect(page.blocks.some((b) => b.type === 'TrustStrip')).toBe(false)
  })

  it('fills TrustStrip from existing media and published marks, without placeholders', () => {
    const candid = { id: 'med_00000000000000000000000021', filename: 'candid-seal.svg', alt: 'Candid seal for Animal Aid Unlimited', kind: 'svg' }
    const nav = { id: 'med_00000000000000000000000022', filename: 'charity-navigator-three-star.png', alt: 'Charity Navigator Three-Star Rating badge', kind: 'image' }
    const page = composePageFromPlan(campaignPlan(), {
      images: [PHOTO],
      embeds: [{ id: EMBED, name: 'Winter form', kind: 'virtuous' }],
      trustMedia: [candid, nav],
      existingTrustStrips: [
        {
          heading: 'Give with confidence',
          intro: 'Independent marks already used on the site.',
          items: [
            {
              name: 'Candid',
              logo: { media: candid.id, alt: candid.alt },
              href: 'https://app.candid.org/profile/8069592/animal-aid-unlimited-71-0884843',
              group: 'Rated by',
            },
          ],
        },
      ],
      knownTemplates: ['home', 'standard', 'campaign', 'story'],
    })
    const strip = page.blocks.find((b) => b.type === 'TrustStrip')
    expect(strip).toBeTruthy()
    const props = strip!.props as { intro: string; items: { name: string; href?: string; logo?: { media: string } }[] }
    expect(props.intro).toBe('Independent marks already used on the site.')
    expect(props.items.map((i) => i.name)).toEqual(['Candid', 'Charity Navigator'])
    expect(props.items[0]!.logo?.media).toBe(candid.id)
    expect(props.items[0]!.href).toContain('app.candid.org')
    expect(JSON.stringify(strip)).not.toContain(PLACEHOLDER_MARK)
    expect(JSON.stringify(strip)).not.toMatch(/\bTBC\b/)
    const doc = {
      schemaVersion: 1,
      title: page.title,
      seo: { title: page.seoTitle, description: page.seoDescription, image: null, canonical: null, noindex: false },
      blocks: page.blocks.map((b, i) => ({ id: `b_${String(i).padStart(26, '0')}`, type: b.type, version: 1, props: b.props })),
    }
    const checks = runChecks(doc as never, createDefaultRegistry(), null)
    expect(checks.blocking.filter((i) => i.path.includes('TrustStrip') || /blocks\.\d+\.props/.test(i.path) && page.blocks[Number(i.path.split('.')[1])]?.type === 'TrustStrip')).toEqual([])
  })

  it('does not invent a donation form when none is registered', () => {

    const page = composePageFromPlan(campaignPlan(), { embeds: [], knownTemplates: ['home', 'standard', 'campaign', 'story'] })
    expect(page.blocks.some((b) => b.type === 'DonationEmbed')).toBe(false)
    expect(page.blocks.some((b) => b.type === 'CallToAction' || b.type === 'Hero')).toBe(true)
  })

  it('drops blocks a story page type does not allow', () => {
    const page = composePageFromPlan(
      campaignPlan({ usage: 'story', template: 'story', sections: [{ type: 'Hero', purpose: '' }, { type: 'ImpactTiers', purpose: '' }, { type: 'RichText', purpose: '' }] }),
      { knownTemplates: ['home', 'standard', 'campaign', 'story'] },
    )
    expect(page.template).toBe('story')
    expect(page.blocks.map((b) => b.type)).toEqual(['Hero', 'RichText'])
  })

  it('maps aliases and repairs invalid props from the sample skeleton', () => {
    const registry = createDefaultRegistry()
    const plan = campaignPlan()
    const repaired = validateAndRepairBlock(
      'thermometer',
      { heading: 'Progress', raised: { bad: true }, goal: 12 },
      registry,
      { images: [PHOTO], embeds: [{ id: EMBED, name: 'Form' }] },
      plan,
    )
    expect(repaired).not.toBeNull()
    expect(repaired!.type).toBe('DonationProgress')
    expect(repaired!.repaired).toBe(true)
    const props = repaired!.props as { raised: string; goal: string; heading: string }
    expect(props.heading).toBe('Progress')
    expect(props.raised).toBe('TBC')
    expect(props.goal).toBe('TBC')
    expect(validateAndRepairBlock('not-a-block', {}, registry, {}, plan)).toBeNull()
  })

  it('marks unknown facts so checks will block review, not invent live totals', () => {
    const page = composePageFromPlan(campaignPlan(), { embeds: [{ id: EMBED, name: 'Form' }] })
    const doc = {
      schemaVersion: 1,
      title: page.title,
      seo: { title: page.seoTitle, description: page.seoDescription, image: null, canonical: null, noindex: false },
      blocks: page.blocks.map((b, i) => ({ id: `b_${String(i).padStart(26, '0')}`, type: b.type, version: 1, props: b.props })),
    }
    const registry = createDefaultRegistry()
    const checks = runChecks(doc as never, registry, null)
    expect(checks.blocking.some((i) => /placeholder text/i.test(i.message))).toBe(true)
  })

  it('builds a deterministic plan from a rich first prompt', () => {
    const plan = planFromAnswers(
      'A winter blanket appeal for existing supporters, campaign page, warm and urgent, we have a story and photos, use the donation form.',
      [],
      { embeds: [{ id: EMBED, name: 'Virtuous winter form', kind: 'virtuous' }] },
    )
    expect(plan.title.toLowerCase()).toContain('winter blanket appeal')
    expect(plan.usage).toBe('campaign')
    expect(plan.template).toBe('campaign')
    expect(plan.tone).toBe('primary')
    expect(plan.cta.kind).toBe('donation')
    expect(plan.sections.map((s) => s.type)).toEqual([
      'Hero',
      'MatchBanner',
      'ImpactTiers',
      'DonationProgress',
      'StoryBeforeAfter',
      'DonationEmbed',
      'TrustStrip',
      'CallToAction',
    ])
    expect(plan.summary.startsWith("Here's what I'll build:")).toBe(true)
  })
})

describe('extractJson and slugifyTitle', () => {
  it('reads JSON from a fenced reply', () => {
    expect(extractJson('Here you go:\n```json\n{"kind":"plan","title":"Hello"}\n```\n')).toEqual({ kind: 'plan', title: 'Hello' })
  })
  it('slugifies a title', () => {
    expect(slugifyTitle('Winter Blanket Appeal!')).toBe('winter-blanket-appeal')
  })
})

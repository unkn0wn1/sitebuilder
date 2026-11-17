// Turn a page plan into a draft document made of real block types, validated
// against their schemas. Unknown facts are marked [placeholder] — never presented
// as live statistics. Used by the assistant briefing flow and its tests.
import { createDefaultRegistry, type BlockRegistry } from './blocks/registry'
import { SAMPLE_EMBED_ID, SAMPLE_MEDIA_ID } from './blocks/library'
import { PLACEHOLDER_MARK, answerText, pagePlanSchema, type BriefAnswer, type PagePlan, type PageUsage, type PlannedSection } from './page-brief'
import { enrichPlanSections, recommendedSections } from './ai/block-guide'
import { richTextFromParagraphs } from './richtext'
import type { StoredBlock } from './blocks/registry'

export interface ComposeImage {
  id: string
  alt?: string | null
}

export interface ComposeEmbed {
  id: string
  name: string
  kind?: string
}

export interface ComposeOptions {
  registry?: BlockRegistry
  images?: ComposeImage[]
  embeds?: ComposeEmbed[]
  allowedBlocksByTemplate?: Record<string, string[] | 'all'>
  knownTemplates?: string[]
}

export interface ComposedPage {
  title: string
  slug: string
  template: string
  seoTitle: string
  seoDescription: string
  blocks: { type: string; props: Record<string, unknown> }[]
  repairedCount: number
  placeholderCount: number
}

const TYPE_ALIASES: Record<string, string> = {
  hero: 'Hero',
  videohero: 'VideoHero',
  'video hero': 'VideoHero',
  richtext: 'RichText',
  text: 'RichText',
  body: 'RichText',
  copy: 'RichText',
  textandimage: 'TextAndImage',
  'text and image': 'TextAndImage',
  image: 'Image',
  gallery: 'Gallery',
  quote: 'Quote',
  stats: 'Stats',
  numbers: 'Stats',
  cardgrid: 'CardGrid',
  cards: 'CardGrid',
  calltoaction: 'CallToAction',
  cta: 'CallToAction',
  faq: 'FAQ',
  donationembed: 'DonationEmbed',
  donation: 'DonationEmbed',
  form: 'DonationEmbed',
  virtuous: 'DonationEmbed',
  embed: 'Embed',
  impacttiers: 'ImpactTiers',
  impact: 'ImpactTiers',
  tiers: 'ImpactTiers',
  donationprogress: 'DonationProgress',
  progress: 'DonationProgress',
  thermometer: 'DonationProgress',
  matchbanner: 'MatchBanner',
  match: 'MatchBanner',
  countdown: 'MatchBanner',
  storybeforeafter: 'StoryBeforeAfter',
  story: 'StoryBeforeAfter',
  'before after': 'StoryBeforeAfter',
  truststrip: 'TrustStrip',
  trust: 'TrustStrip',
  partners: 'TrustStrip',
  badges: 'TrustStrip',
}

const STORY_ALLOWED = new Set([
  'Hero',
  'VideoHero',
  'RichText',
  'TextAndImage',
  'Image',
  'Gallery',
  'Quote',
  'CallToAction',
  'DonationEmbed',
  'StoryBeforeAfter',
  'TrustStrip',
])

export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'page'
  )
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fence ? fence[1]! : trimmed).trim()
  const start = body.search(/[\[{]/)
  if (start < 0) throw new Error('The model did not return JSON.')
  return JSON.parse(body.slice(start))
}

export function markPlaceholder(text: string): string {
  return text.includes(PLACEHOLDER_MARK) ? text : `${text} ${PLACEHOLDER_MARK}`.trim()
}

function imageRef(opts: ComposeOptions, alt: string, index = 0): { media: string; alt: string } {
  const img = opts.images?.[index] ?? opts.images?.[0]
  return { media: img?.id ?? SAMPLE_MEDIA_ID, alt: markPlaceholder(img?.alt || alt) }
}

function hasImages(opts: ComposeOptions): boolean {
  return (opts.images?.length ?? 0) > 0
}

function pickEmbed(plan: PagePlan, opts: ComposeOptions): ComposeEmbed | null {
  const wanted = plan.cta.embedId
  if (wanted && opts.embeds?.some((e) => e.id === wanted)) return opts.embeds.find((e) => e.id === wanted)!
  const virtuous = opts.embeds?.find((e) => /virtuous/i.test(`${e.name} ${e.kind ?? ''}`))
  if (virtuous && plan.cta.kind === 'donation') return virtuous
  return opts.embeds?.[0] ?? null
}

export function resolveBlockType(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (TYPE_ALIASES[trimmed]) return TYPE_ALIASES[trimmed]
  const key = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (TYPE_ALIASES[key]) return TYPE_ALIASES[key]
  const spaced = trimmed.toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (TYPE_ALIASES[spaced]) return TYPE_ALIASES[spaced]
  // Already a real type name.
  const registry = createDefaultRegistry()
  if (registry.get(trimmed)) return trimmed
  return null
}

function templateFor(plan: PagePlan, opts: ComposeOptions): string {
  const known = opts.knownTemplates ?? ['home', 'standard', 'campaign', 'story']
  const preferred: Record<PageUsage, string> = {
    campaign: 'campaign',
    event: plan.cta.kind === 'donation' ? 'campaign' : 'standard',
    evergreen: 'standard',
    story: 'story',
    standard: 'standard',
    home: 'home',
  }
  const wanted = plan.template && known.includes(plan.template) ? plan.template : preferred[plan.usage]
  return known.includes(wanted) ? wanted : 'standard'
}

function allowedFor(template: string, opts: ComposeOptions): Set<string> | null {
  const listed = opts.allowedBlocksByTemplate?.[template]
  if (listed === 'all' || listed === undefined) {
    if (template === 'story') return STORY_ALLOWED
    return null
  }
  return new Set(listed)
}

function placeholderSample(type: string, sample: Record<string, unknown>, opts: ComposeOptions, plan: PagePlan): Record<string, unknown> {
  const heading = plan.title
  const ctaLabel = plan.cta.label || 'Donate now'
  const ctaHref = plan.cta.href || '#donate'
  const photo = imageRef(opts, `Photo for ${heading}`)
  const clone = structuredClone(sample)

  if (type === 'Hero') {
    return {
      heading,
      subheading: markPlaceholder('A short supporting line goes here.'),
      image: photo,
      cta: { label: ctaLabel, href: ctaHref },
      tone: plan.tone,
    }
  }
  if (type === 'RichText') {
    return {
      content: richTextFromParagraphs([
        plan.contentNotes?.trim()
          || markPlaceholder('Add the real story, facts and details here. Nothing on this draft should be treated as a published figure.'),
      ]),
    }
  }
  if (type === 'TextAndImage') {
    return {
      heading: markPlaceholder('The story'),
      content: richTextFromParagraphs([markPlaceholder('Add the real copy and a photo from the library.')]),
      image: photo,
    }
  }
  if (type === 'Image') return { image: photo, caption: markPlaceholder('Add a caption.') }
  if (type === 'Gallery') return { heading: markPlaceholder('Photos'), images: [photo, imageRef(opts, `Another photo for ${heading}`, 1)] }
  if (type === 'Quote') {
    return {
      text: markPlaceholder('Add a real quote from a volunteer, donor or the animal’s carers.'),
      attribution: markPlaceholder('Attribution'),
    }
  }
  if (type === 'Stats') {
    return {
      heading: markPlaceholder('Our impact'),
      items: [
        { value: 'TBC', label: markPlaceholder('Add the real figure') },
        { value: 'TBC', label: markPlaceholder('Add the real figure') },
        { value: 'TBC', label: markPlaceholder('Add the real figure') },
      ],
    }
  }
  if (type === 'CardGrid') {
    return {
      heading: markPlaceholder('Ways to help'),
      cards: [
        { title: markPlaceholder('A way to help'), text: markPlaceholder('Add a short description.') },
        { title: markPlaceholder('Another way'), text: markPlaceholder('Add a short description.') },
      ],
    }
  }
  if (type === 'CallToAction') {
    return {
      heading: plan.cta.kind === 'none' ? markPlaceholder('Stay in touch') : `Help with ${heading}`,
      text: markPlaceholder('A sentence about what the gift or action does.'),
      button: { label: ctaLabel, href: ctaHref },
      tone: plan.tone === 'neutral' ? 'accent' : plan.tone,
    }
  }
  if (type === 'FAQ') {
    return {
      heading: 'Questions',
      items: [
        {
          question: markPlaceholder('Add a question people actually ask'),
          answer: richTextFromParagraphs([markPlaceholder('Add the real answer.')]),
        },
      ],
    }
  }
  if (type === 'DonationEmbed') {
    const embed = pickEmbed(plan, opts)
    return { embed: embed?.id ?? SAMPLE_EMBED_ID, heading: 'Give now', anchor: 'donate' }
  }
  if (type === 'Embed') {
    const embed = pickEmbed(plan, opts)
    return { embed: embed?.id ?? SAMPLE_EMBED_ID, title: markPlaceholder('Embedded form') }
  }
  if (type === 'ImpactTiers') {
    return {
      heading: 'What your gift can do',
      intro: markPlaceholder('Add the real gift amounts and what each one covers. These rows are only a layout.'),
      items: [
        { amount: 'TBC', title: markPlaceholder('A first gift'), explanation: markPlaceholder('Add what this amount covers.') },
        { amount: 'TBC', title: markPlaceholder('A second gift'), explanation: markPlaceholder('Add what this amount covers.') },
        { amount: 'TBC', title: markPlaceholder('A third gift'), explanation: markPlaceholder('Add what this amount covers.') },
      ],
      otherAmount: 'Or give a different amount',
      cta: { label: ctaLabel, href: ctaHref },
    }
  }
  if (type === 'DonationProgress') {
    return {
      heading: markPlaceholder(`${heading} progress`),
      raised: 'TBC',
      goal: 'TBC',
      currency: '₹',
      label: markPlaceholder('Add the real total raised and the goal'),
      matchLine: markPlaceholder('Add a real match line, or remove this.'),
      cta: { label: ctaLabel, href: ctaHref },
    }
  }
  if (type === 'MatchBanner') {
    return {
      message: markPlaceholder('Add the real deadline or match offer, or remove this banner.'),
      matchLine: markPlaceholder('Only include a match if it is confirmed.'),
      tone: plan.tone,
      hideWhenPassed: true,
      cta: { label: ctaLabel, href: ctaHref },
    }
  }
  if (type === 'StoryBeforeAfter') {
    return {
      eyebrow: 'A rescue story',
      heading: markPlaceholder('From intake to recovery'),
      content: richTextFromParagraphs([
        plan.contentNotes?.trim() || markPlaceholder('Add the real rescue story. Do not publish this placeholder as fact.'),
      ]),
      quote: markPlaceholder('Add a real quote, or remove it.'),
      attribution: markPlaceholder('Who said it'),
      before: imageRef(opts, 'Before: add an intake photo'),
      beforeCaption: markPlaceholder('Before'),
      after: imageRef(opts, 'After: add a recovery photo', 1),
      afterCaption: markPlaceholder('After'),
      cta: { label: ctaLabel, href: ctaHref },
    }
  }
  if (type === 'TrustStrip') {
    const logo = opts.images?.[0] ? imageRef(opts, 'Organisation mark') : undefined
    const items = logo
      ? [
          { name: markPlaceholder('A trusted mark'), logo, note: markPlaceholder("Use the organisation's real seal."), group: 'Rated by' },
          { name: markPlaceholder('Another mark'), logo: imageRef(opts, 'Organisation mark', 1), note: markPlaceholder('Use the real rating or badge.'), group: 'Rated by' },
        ]
      : [
          { name: markPlaceholder('A trusted mark'), badgeHtml: '<span>Add a real badge</span>', note: markPlaceholder("Add the organisation's real seal."), group: 'Rated by' },
        ]
    return {
      heading: 'Give with confidence',
      intro: markPlaceholder('Add the real ratings and partners, or remove this section.'),
      items,
    }
  }
  // Unknown type: return the sample with images rewritten when present.
  if (clone && typeof clone === 'object') rewriteImages(clone, opts)
  return clone
}

function rewriteImages(value: unknown, opts: ComposeOptions): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteImages(item, opts))
    return
  }
  const rec = value as Record<string, unknown>
  if (typeof rec.media === 'string' && String(rec.media).startsWith('med_')) {
    rec.media = opts.images?.[0]?.id ?? rec.media
    if (typeof rec.alt === 'string') rec.alt = markPlaceholder(rec.alt)
  }
  for (const v of Object.values(rec)) rewriteImages(v, opts)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergeSafe(base: Record<string, unknown>, overlay: unknown): Record<string, unknown> {
  if (!isPlainObject(overlay)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue
    const current = out[key]
    if (isPlainObject(current) && isPlainObject(value)) out[key] = mergeSafe(current, value)
    else out[key] = value
  }
  return out
}

/** Copy overlay fields whose types match the skeleton, so a bad value does not wipe a good placeholder. */
function compatibleOverlay(base: Record<string, unknown>, overlay: unknown): Record<string, unknown> {
  if (!isPlainObject(overlay)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue
    const current = base[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      const nested = compatibleOverlay(current, value)
      if (Object.keys(nested).length) out[key] = nested
    } else if (typeof current === 'string' && typeof value === 'string') out[key] = value
    else if (typeof current === 'number' && typeof value === 'number') out[key] = value
    else if (typeof current === 'boolean' && typeof value === 'boolean') out[key] = value
    else if (current === undefined && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) out[key] = value
  }
  return out
}

export function validateAndRepairBlock(
  type: string,
  props: unknown,
  registry: BlockRegistry,
  opts: ComposeOptions,
  plan: PagePlan,
): { type: string; props: Record<string, unknown>; repaired: boolean } | null {
  const resolved = resolveBlockType(type)
  if (!resolved) return null
  const def = registry.get(resolved)
  if (!def) return null
  const first = def.props.safeParse(props)
  if (first.success) return { type: resolved, props: first.data as Record<string, unknown>, repaired: false }
  const sample = placeholderSample(resolved, (def.sample ?? {}) as Record<string, unknown>, opts, plan)
  const merged = mergeSafe(sample, compatibleOverlay(sample, props))
  const second = def.props.safeParse(merged)
  if (second.success) return { type: resolved, props: second.data as Record<string, unknown>, repaired: true }
  const fallback = def.props.safeParse(sample)
  if (fallback.success) return { type: resolved, props: fallback.data as Record<string, unknown>, repaired: true }
  return null
}

function countPlaceholders(value: unknown): number {
  let n = 0
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.includes(PLACEHOLDER_MARK) || /\bTBC\b/.test(v)) n += 1
      return
    }
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v as object).forEach(walk)
  }
  walk(value)
  return n
}

function ensureRequired(template: string, sections: PlannedSection[], plan: PagePlan, opts: ComposeOptions): PlannedSection[] {
  const types = new Set(sections.map((s) => resolveBlockType(s.type) ?? s.type))
  const out = [...sections]
  const add = (type: string) => {
    if (!types.has(type)) {
      out.push({ type, purpose: '' })
      types.add(type)
    }
  }
  if (template === 'campaign' || template === 'home') add('Hero')
  if (template === 'campaign' && pickEmbed(plan, opts)) add('DonationEmbed')
  if (template === 'story') add('RichText')
  return out
}

export function composePageFromPlan(input: PagePlan, opts: ComposeOptions = {}): ComposedPage {
  const plan = pagePlanSchema.parse(input)
  const registry = opts.registry ?? createDefaultRegistry()
  const template = templateFor(plan, opts)
  const allowed = allowedFor(template, opts)
  const hasDonation = plan.cta.kind === 'donation' && !!pickEmbed(plan, opts)
  let sections = plan.sections.length ? plan.sections : recommendedSections(plan.usage, { hasDonation })
  sections = ensureRequired(template, sections, plan, opts)

  const blocks: { type: string; props: Record<string, unknown> }[] = []
  let repairedCount = 0
  const seen = new Set<string>()

  for (const section of sections) {
    const type = resolveBlockType(section.type)
    if (!type) continue
    if (allowed && !allowed.has(type)) continue
    if (type === 'DonationEmbed' && !pickEmbed(plan, opts)) continue
    if (type === 'Embed' && !pickEmbed(plan, opts)) continue
    if (type === 'VideoHero') continue // needs a real video; fall back is not automatic
    // One of each campaign / structural block is enough; allow multiple RichText / Image.
    const unique = !['RichText', 'Image', 'Gallery', 'Quote'].includes(type)
    if (unique && seen.has(type)) continue
    seen.add(type)
    const rawProps = section.props ?? placeholderSample(type, (registry.get(type)?.sample ?? {}) as Record<string, unknown>, opts, plan)
    const result = validateAndRepairBlock(type, rawProps, registry, opts, plan)
    if (!result) continue
    if (result.repaired) repairedCount += 1
    blocks.push({ type: result.type, props: result.props })
  }

  if (!blocks.length) {
    const fallback = validateAndRepairBlock('RichText', {}, registry, opts, plan)
    if (fallback) blocks.push({ type: fallback.type, props: fallback.props })
  }

  const title = plan.title.trim()
  const slug = slugifyTitle(plan.slug?.trim() || title)
  const seoTitle = (plan.seoTitle?.trim() || title).slice(0, 70)
  const seoDescription = (plan.seoDescription?.trim() || `${plan.purpose || title}. A draft assembled by the assistant — replace ${PLACEHOLDER_MARK} copy before review.`).slice(0, 160)

  return {
    title,
    slug,
    template,
    seoTitle,
    seoDescription,
    blocks,
    repairedCount,
    placeholderCount: countPlaceholders(blocks) + countPlaceholders(seoDescription),
  }
}

export function planFromAnswers(prompt: string, answers: BriefAnswer[], extras: { embeds?: ComposeEmbed[] } = {}): PagePlan {
  const blob = [prompt, ...answers.map((a) => `${a.id}: ${answerText(a)}`)].join('\n').toLowerCase()
  const usage = detectUsage(blob)
  const tone = detectTone(blob)
  const ctaKind = detectCta(blob)
  const title = titleFromPrompt(prompt)
  const purpose = findAnswer(answers, 'purpose') || firstSentence(prompt)
  const audience = findAnswer(answers, 'audience') || (/\bsupporter/.test(blob) ? 'Existing supporters' : '')
  const contentNotes = findAnswer(answers, 'content') || undefined
  const embed = extras.embeds?.[0]
  const template = usage === 'home' ? 'home' : usage === 'story' ? 'story' : usage === 'campaign' || (usage === 'event' && ctaKind === 'donation') ? 'campaign' : 'standard'
  const draft = pagePlanSchema.parse({
    title,
    slug: slugifyTitle(title),
    template,
    purpose,
    audience,
    usage,
    contentNotes,
    cta: {
      kind: ctaKind,
      embedId: ctaKind === 'donation' ? embed?.id : undefined,
      label: ctaKind === 'none' ? 'Learn more' : 'Donate now',
      href: '#donate',
    },
    tone,
    sections: [],
    seoTitle: title.slice(0, 70),
    seoDescription: (purpose || title).slice(0, 160),
    summary: "Here's what I'll build.",
  })
  const plan = enrichPlanSections(draft, { prompt, answers, hasDonation: ctaKind === 'donation' && !!embed })
  const labels = plan.sections.map((s) => s.type).join(', ')
  return {
    ...plan,
    summary: `Here's what I'll build: ${labels}. It will use the current brand pack, with a ${tone} tone on the opening and the ask. I'll leave a draft only — nothing is published. Where a figure isn't known, you'll see ${PLACEHOLDER_MARK} copy to replace.`,
  }
}

function findAnswer(answers: BriefAnswer[], id: string): string {
  const row = answers.find((a) => a.id === id)
  return row ? answerText(row) : ''
}

function firstSentence(text: string): string {
  return text.split(/[.!\n]/)[0]?.trim().slice(0, 400) ?? ''
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .trim()
    .replace(/^(please |i'd like |i would like |i want |i need |can you |could you |make |create |build |write |draft )/i, '')
    .replace(/^(a |an |the )/i, '')
  const first = cleaned.split(/[.!\n]/)[0]!.trim().replace(/\s+/g, ' ')
  const named = first.match(/^(.{4,60}?)(?:,| for | with | that | to )/i)
  const candidate = (named?.[1] || first).trim()
  if (candidate.length >= 4 && candidate.length <= 80) return capitalise(candidate)
  if (first.length > 80) return capitalise(first.slice(0, 77).replace(/\s+\S*$/, '') || 'New page')
  return 'New page'
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function detectUsage(blob: string): PageUsage {
  if (/\bhome page\b|\bhomepage\b|\blanding page for the site\b/.test(blob)) return 'home'
  if (/\bevergreen\b|\byear[- ]round\b|\balways on\b/.test(blob)) return 'evergreen'
  if (/\bstory\b|\brescue story\b|\bbefore and after\b/.test(blob) && !/\bcampaign\b|\bappeal\b/.test(blob)) return 'story'
  if (/\bevent\b|\bgiving tuesday\b|\bdeadline\b|\bopen day\b/.test(blob) && !/\bappeal\b/.test(blob)) return 'event'
  if (/\bcampaign\b|\bappeal\b|\bfundrais|\bdonate\b|\bdonation\b|\bwinter blanket\b/.test(blob)) return 'campaign'
  return 'standard'
}

export function detectTone(blob: string): 'primary' | 'neutral' | 'accent' {
  if (/\bcalm\b|\breassur|\bfactual\b|\bstraightforward\b|\bquiet\b/.test(blob)) return 'neutral'
  if (/\bcelebrat|\bhopeful\b|\bjoyful\b|\bbright\b/.test(blob)) return 'accent'
  return 'primary'
}

export function detectCta(blob: string): 'donation' | 'link' | 'none' {
  if (/\bno ask\b|\bno donation\b|\bjust (the )?story\b|\bread only\b/.test(blob)) return 'none'
  if (/\blink to donate\b|\bdonate link\b|\bbutton only\b/.test(blob)) return 'link'
  if (/\bdonate\b|\bdonation\b|\bvirtuous\b|\bgive\b|\bappeal\b|\bcampaign\b/.test(blob)) return 'donation'
  return 'link'
}

/** @internal used in tests to inspect a composed block list as StoredBlock-shaped data */
export function asStored(blocks: ComposedPage['blocks']): Pick<StoredBlock, 'type' | 'props'>[] {
  return blocks
}

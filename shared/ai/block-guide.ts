// AI-facing guidance for every section type, plus recommended page outlines
// and worked examples. Used by the page-assistant planner, list_blocks, and
// the editor assistant context. Guides themselves live on each block definition.
import { createDefaultRegistry } from '../blocks/registry'
import type { BlockAiGuide, BlockDefinition } from '../blocks/define'
import type { BriefAnswer, PagePlan, PageUsage, PlannedSection } from '../page-brief'
import { answerText } from '../page-brief'
import { compactExampleProps, formatPageTypeExamples } from './page-examples'

export type { PageTypeWorkedExample } from './page-examples'
export { PAGE_TYPE_EXAMPLES, formatPageTypeExamples } from './page-examples'

export type BlockAiSummary = BlockAiGuide & { type: string; label: string }

export function isCompleteAiGuide(guide: BlockAiGuide | undefined): guide is BlockAiGuide {
  if (!guide) return false
  if (!guide.purpose?.trim() || !guide.useWhen?.trim() || !guide.avoidWhen?.trim() || !guide.fields?.trim()) return false
  if (!Array.isArray(guide.pairsWith)) return false
  if (!guide.good?.note?.trim() || !guide.bad?.note?.trim()) return false
  return true
}

export function blockAiSummary(def: BlockDefinition): BlockAiSummary | null {
  if (!isCompleteAiGuide(def.ai)) return null
  return { type: def.type, label: def.label, ...def.ai }
}

export function listBlockAiSummaries(types?: string[]): BlockAiSummary[] {
  const registry = createDefaultRegistry()
  const defs = types?.length ? types.map((t) => registry.get(t)).filter((d): d is BlockDefinition => !!d) : registry.list()
  return defs.map(blockAiSummary).filter((s): s is BlockAiSummary => !!s)
}

/** Types in the registry that are missing a complete purpose / use / pairs / avoid / fields / good / bad guide. */
export function blocksMissingAiGuide(): string[] {
  return createDefaultRegistry()
    .list()
    .filter((def) => !isCompleteAiGuide(def.ai))
    .map((def) => def.type)
}

function formatExample(kind: 'Good' | 'Bad', example: BlockAiGuide['good']): string {
  const props = example.props ? ` Props: ${JSON.stringify(compactExampleProps(example.props))}` : ''
  return `${kind}: ${example.note}${props}`
}

/** Catalogue for a system prompt, including a good example and a bad anti-pattern for each section. */
export function formatBlockAiCatalog(types?: string[]): string {
  const rows = listBlockAiSummaries(types)
  if (!rows.length) return ''
  return rows
    .map((s) => {
      const pairs = s.pairsWith.length ? s.pairsWith.join(', ') : '—'
      return [
        `### ${s.type} (${s.label})`,
        `Purpose: ${s.purpose}`,
        `Use when: ${s.useWhen}`,
        `Pairs with: ${pairs}.`,
        `Avoid when: ${s.avoidWhen}`,
        `Fields: ${s.fields}`,
        formatExample('Good', s.good),
        formatExample('Bad', s.bad),
      ].join('\n')
    })
    .join('\n\n')
}

export interface StructureHints {
  prompt?: string
  answers?: BriefAnswer[]
  hasDonation?: boolean
}

function blobOf(hints: StructureHints): string {
  const bits = [hints.prompt ?? '', ...(hints.answers ?? []).map((a) => `${a.id} ${answerText(a)}`)]
  return bits.join('\n').toLowerCase()
}

export function mentionsMatchOrDeadline(blob: string): boolean {
  return /\b(deadline|match(\s+offer)?|countdown|giving tuesday|ends? on|ending|until\b|by \d)/i.test(blob)
}

export function rulesOutMatch(blob: string): boolean {
  return /\bno (deadline|match|countdown|date)\b/.test(blob)
}

export function mentionsGoal(blob: string): boolean {
  return /\b(goal|target|progress|raised so far|thermometer|appeal total)\b/.test(blob)
}

export function rulesOutGoal(blob: string): boolean {
  return /\bno (goal|target|progress|thermometer)\b/.test(blob)
}

function section(type: string, purpose: string): PlannedSection {
  return { type, purpose }
}

/** Deterministic recommended outline for a page type, adjusted by what the person has said. */
export function recommendedSections(usage: PageUsage, hints: StructureHints = {}): PlannedSection[] {
  const blob = blobOf(hints)
  const hasDonation = hints.hasDonation ?? true
  const includeMatch = !rulesOutMatch(blob) && (usage === 'campaign' || usage === 'event' || mentionsMatchOrDeadline(blob))
  const includeProgress = !rulesOutGoal(blob) && (usage === 'campaign' || mentionsGoal(blob))
  const donate = hasDonation ? 'DonationEmbed' : 'CallToAction'

  if (usage === 'campaign') {
    const out: PlannedSection[] = [section('Hero', 'Open the appeal')]
    if (includeMatch) out.push(section('MatchBanner', mentionsMatchOrDeadline(blob) ? 'The deadline or match offer' : 'A match or countdown if you have one — uncheck if not'))
    out.push(section('ImpactTiers', 'Suggested gift amounts'))
    if (includeProgress) out.push(section('DonationProgress', mentionsGoal(blob) ? 'Progress towards the goal' : 'Progress towards the goal — uncheck if you have no target'))
    out.push(section('StoryBeforeAfter', 'A rescue or beneficiary story'))
    if (hasDonation) out.push(section('DonationEmbed', 'The donation form'))
    out.push(section('TrustStrip', 'Real trust marks'))
    out.push(section('CallToAction', 'A short closing ask'))
    return out
  }
  if (usage === 'event') {
    const out: PlannedSection[] = [section('Hero', 'Open with the event')]
    if (includeMatch) out.push(section('MatchBanner', 'The date or countdown'))
    out.push(section('RichText', 'What the event is and how to take part'))
    out.push(section('FAQ', 'Practical questions'))
    out.push(section(donate, hasDonation ? 'The donation form' : 'The main ask'))
    return out
  }
  if (usage === 'evergreen') {
    return [
      section('Hero', 'Open the page'),
      section('RichText', 'The lasting case for support'),
      section('ImpactTiers', 'Suggested gift amounts'),
      section('TrustStrip', 'Real trust marks'),
      section(donate, hasDonation ? 'The donation form' : 'The main ask'),
      section('FAQ', 'Practical questions'),
    ]
  }
  if (usage === 'story') {
    return [
      section('Hero', 'Open the story'),
      section('RichText', 'The written story'),
      section('StoryBeforeAfter', 'Before and after'),
      section('Quote', 'A real quote, if you have one'),
      section('TrustStrip', 'Real trust marks'),
      section('CallToAction', 'A closing ask'),
    ]
  }
  if (usage === 'home') {
    return [
      section('Hero', 'Open the site'),
      section('CardGrid', 'Ways to help or key destinations'),
      section('Stats', 'Real headline numbers, or leave as placeholders'),
      section('TrustStrip', 'Real trust marks'),
      section('CallToAction', 'The main ask'),
    ]
  }
  return [
    section('Hero', 'Open the page'),
    section('RichText', 'The main copy'),
    section('TextAndImage', 'Copy with a supporting photo'),
    section('CallToAction', 'A closing ask'),
  ]
}

export function formatRecommendedOutlines(): string {
  const usages: PageUsage[] = ['campaign', 'event', 'evergreen', 'story', 'home', 'standard']
  const notes: Record<PageUsage, string> = {
    campaign:
      'Default on: MatchBanner and DonationProgress, unless the person has said there is no deadline, match or goal (they can also uncheck those sections in the plan). Always include a closing CallToAction in addition to DonationEmbed, not instead of it. FAQ is not in the campaign default.',
    event: 'Use MatchBanner for the event date or a confirmed match, never an invented offer.',
    evergreen: 'No match banner or progress bar unless the person has a standing target or deadline they want to show.',
    story: 'One story. A Quote only if a real one exists, or clearly marked as a placeholder. Close with a single ask.',
    home: 'A few destinations or ways to help, real stats or placeholders, trust marks, and one main ask.',
    standard: 'A simple page: opening, copy, a supporting photo if useful, and a closing ask.',
  }
  return usages
    .map((usage) => {
      const types = recommendedSections(usage).map((s) => s.type).join(', ')
      return `- ${usage}: ${types}. ${notes[usage]}`
    })
    .join('\n')
}

/** Merge a model- or user-supplied plan with the recommended outline for its page type. */
export function enrichPlanSections(plan: PagePlan, hints: StructureHints = {}): PagePlan {
  const recommended = recommendedSections(plan.usage, { ...hints, hasDonation: hints.hasDonation ?? plan.cta.kind === 'donation' })
  const recTypes = recommended.map((s) => s.type)
  const byType = new Map<string, PlannedSection>()
  for (const s of plan.sections) {
    const type = s.type
    if (!byType.has(type)) byType.set(type, { ...s, type })
  }
  const merged: PlannedSection[] = recommended.map((r) => byType.get(r.type) ?? r)
  for (const s of plan.sections) {
    if (!recTypes.includes(s.type)) merged.push(s)
  }
  const labels = merged.map((s) => s.type).join(', ')
  const summary = plan.summary.includes("Here's what I'll build:")
    ? plan.summary
    : `Here's what I'll build: ${labels}. ${plan.summary}`.slice(0, 800)
  return { ...plan, sections: merged, summary }
}

/** Full planner briefing: recommended outlines, worked examples, and the section catalogue. */
export function formatPlannerGuidance(): string {
  const types = listBlockAiSummaries()
    .map((s) => s.type)
    .join(', ')
  return [
    'How to plan a page:',
    'Start from the recommended outline for the page type. Only drop a section if the person has said they do not want it (for example “no deadline” or “no goal”). They will also be able to uncheck sections before Build. Prefer adding a missing recommended section rather than inventing a short page.',
    'Do not invent statistics, totals, ratings, deadlines, match offers or quotes as if they were facts. If a figure is unknown, mark it TBC or [placeholder], or leave that field for the editor to fill in.',
    '',
    `Use only these section types: ${types}.`,
    '',
    'Recommended outlines:',
    formatRecommendedOutlines(),
    '',
    'Worked examples (follow the structure and the tone of the good props; do not copy sample figures as live totals):',
    formatPageTypeExamples(),
    '',
    'Section catalogue (purpose, when to use, what it pairs with, when to avoid, fields, a good example and a bad anti-pattern):',
    formatBlockAiCatalog(),
  ].join('\n')
}

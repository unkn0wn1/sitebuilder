// Schemas for "New page with the assistant": a short interview, then a plan,
// then a draft page. The page is created only when the person confirms Build.
import { z } from 'zod'

export const PAGE_USAGES = ['campaign', 'evergreen', 'story', 'event', 'standard', 'home'] as const
export type PageUsage = (typeof PAGE_USAGES)[number]

export const pageUsageSchema = z.enum(PAGE_USAGES)

export const BRIEF_QUESTION_IDS = ['purpose', 'audience', 'usage', 'content', 'cta', 'look'] as const
export type BriefQuestionId = (typeof BRIEF_QUESTION_IDS)[number]

export const briefQuestionIdSchema = z.enum(BRIEF_QUESTION_IDS)

export const briefChipSchema = z.string().trim().min(1).max(80)
export const briefQuestionSchema = z
  .object({
    id: briefQuestionIdSchema,
    prompt: z.string().trim().min(1).max(280),
    chips: z.array(briefChipSchema).max(8).default([]),
    allowFreeText: z.boolean().default(true),
  })
  .strict()
export type BriefQuestion = z.infer<typeof briefQuestionSchema>

export const briefAnswerSchema = z
  .object({
    id: briefQuestionIdSchema,
    prompt: z.string().max(280),
    chip: z.string().max(80).optional(),
    text: z.string().max(2000).optional(),
  })
  .strict()
export type BriefAnswer = z.infer<typeof briefAnswerSchema>

export const plannedSectionSchema = z
  .object({
    type: z.string().trim().min(1).max(60),
    purpose: z.string().trim().max(200).default(''),
    notes: z.string().trim().max(400).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type PlannedSection = z.infer<typeof plannedSectionSchema>

export const pagePlanCtaSchema = z
  .object({
    kind: z.enum(['donation', 'link', 'none']).default('donation'),
    embedId: z.string().max(64).optional(),
    label: z.string().trim().max(40).optional(),
    href: z.string().trim().max(300).optional(),
  })
  .strict()

export const pagePlanSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    slug: z.string().trim().max(80).optional(),
    template: z.string().trim().min(1).max(40),
    purpose: z.string().trim().max(400).default(''),
    audience: z.string().trim().max(400).default(''),
    usage: pageUsageSchema,
    contentNotes: z.string().trim().max(2000).optional(),
    cta: pagePlanCtaSchema.default({ kind: 'donation' }),
    tone: z.enum(['primary', 'neutral', 'accent']).default('primary'),
    sections: z.array(plannedSectionSchema).max(16).default([]),
    seoTitle: z.string().trim().max(70).optional(),
    seoDescription: z.string().trim().max(160).optional(),
    summary: z.string().trim().min(1).max(800),
  })
  .strict()
export type PagePlan = z.infer<typeof pagePlanSchema>

export const interviewTurnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), question: briefQuestionSchema }).strict(),
  z.object({ kind: z.literal('plan'), plan: pagePlanSchema }).strict(),
])
export type InterviewTurn = z.infer<typeof interviewTurnSchema>

export const MAX_BRIEF_QUESTIONS = 5
export const MAX_BRIEF_PROMPT = 4000
export const PLACEHOLDER_MARK = '[placeholder]'

export function answerText(answer: BriefAnswer): string {
  return [answer.chip, answer.text].filter((p) => p && p.trim()).join(' — ').trim()
}

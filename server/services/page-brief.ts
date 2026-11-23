// "New page with the assistant": a short interview, a plan, then a draft page
// created only when the person confirms Build. Reuses the existing provider,
// caps and block schemas. Never publishes.
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { can } from '../../shared/roles'
import { costMicrosFor, penceToMicros } from '../../shared/ai-pricing'
import { newId } from '../../shared/ids'
import {
  MAX_BRIEF_PROMPT,
  MAX_BRIEF_QUESTIONS,
  briefAnswerSchema,
  briefQuestionSchema,
  pagePlanSchema,
  type BriefAnswer,
  type BriefQuestion,
  type PagePlan,
  type PlannedSection,
} from '../../shared/page-brief'
import { composePageFromPlan, extractJson, planFromAnswers, type ComposeEmbed, type ComposeImage } from '../../shared/page-compose'
import { isTrustMedia, type TrustMedia, type TrustStripSource } from '../../shared/trust-marks'
import { enrichPlanSections, formatPlannerGuidance } from '../../shared/ai/block-guide'
import { personalitySection } from '../../shared/soul'
import { strippedSoul } from './soul'
import { aiSessions, media, pageBriefs, pages } from '../db/schema'
import { audit } from './audit'
import { addAiUsage, monthCostMicros } from './ai'
import { resolveAi, resolveProvider, unavailableMessage, recordProviderFailure, type ResolvedAi } from './ai-loop'
import { iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { listEmbeds } from './site'
import { applyPageOps, createPage, getPage, readDoc, slugify } from './pages'
import { createTemplateDraft, getTemplateRules, listTemplates } from './templates'
import type { TemplateRules } from '../../shared/templates'
import type { InternalOp } from '../../shared/ops'
import type { ChatResult } from './ai-provider'
import { ProviderError } from './ai-provider'

export const FALLBACK_QUESTIONS: BriefQuestion[] = [
  {
    id: 'purpose',
    prompt: 'What is this page for, in a sentence or two?',
    chips: ['A fundraising appeal', 'An evergreen donation page', 'A rescue story', 'An event or deadline', 'About our work'],
    allowFreeText: true,
  },
  {
    id: 'audience',
    prompt: 'Who is it mainly for?',
    chips: ['People who already support us', 'People new to the charity', 'Local visitors', 'Donors we are writing to in a campaign'],
    allowFreeText: true,
  },
  {
    id: 'usage',
    prompt: 'How will the page be used?',
    chips: ['Campaign', 'Evergreen', 'Story', 'Event', 'Standard page'],
    allowFreeText: true,
  },
  {
    id: 'content',
    prompt: 'What content do you already have to go on the page?',
    chips: ['A story and photos', 'Notes and a headline only', 'A donation form and amounts', "I'll add the details later"],
    allowFreeText: true,
  },
  {
    id: 'cta',
    prompt: 'What should people do when they reach the page?',
    chips: ['Give through our donation form', 'Follow a donate link', 'Read the story — no ask yet', 'Sign up or get in touch'],
    allowFreeText: true,
  },
  {
    id: 'look',
    prompt: 'How should it feel, within the current brand pack?',
    chips: ['Warm and urgent', 'Calm and reassuring', 'Celebratory and hopeful', 'Straightforward and factual'],
    allowFreeText: true,
  },
]

export interface PageBriefView {
  id: string
  state: 'interviewing' | 'planned' | 'built'
  prompt: string
  questionCount: number
  question?: BriefQuestion
  plan?: PagePlan
  pageId?: string | null
  templateId?: string | null
  warning?: string
}

type BriefRow = typeof pageBriefs.$inferSelect

function requireEdit(actor: ActingAs) {
  if (!can(actor, 'page.edit')) throw forbidden()
}

function briefUnavailable(reason: ResolvedAi['reason']): string {
  if (reason === 'off') return "The assistant isn't switched on yet. An admin can turn it on in Settings. You can still start a page yourself."
  return unavailableMessage(reason)
}

function requireReadyAi(ctx: ServiceCtx): ResolvedAi {
  const resolved = resolveAi(ctx)
  if (!resolved.enabled) throw new AppError('ai_unavailable', briefUnavailable('off'))
  if (!resolved.available && !ctx.aiProvider) throw new AppError('ai_unavailable', briefUnavailable(resolved.reason))
  return resolved
}

function toView(row: BriefRow, extras: { question?: BriefQuestion; warning?: string } = {}): PageBriefView {
  const answers = (row.answers ?? []) as BriefAnswer[]
  const plan = row.plan ? pagePlanSchema.safeParse(row.plan).data : undefined
  return {
    id: row.id,
    state: row.state,
    prompt: row.prompt,
    questionCount: answers.length,
    question: extras.question,
    plan: plan,
    pageId: row.pageId,
    templateId: row.templateId,
    ...(extras.warning ? { warning: extras.warning } : {}),
  }
}

function requireBrief(ctx: ServiceCtx, actor: ActingAs, id: string): BriefRow {
  const row = ctx.db.select().from(pageBriefs).where(and(eq(pageBriefs.id, id), eq(pageBriefs.siteId, ctx.siteId))).get()
  if (!row || row.userId !== actor.id) throw notFound('That page brief')
  return row
}

function saveBrief(ctx: ServiceCtx, id: string, patch: Partial<BriefRow>) {
  ctx.db.update(pageBriefs).set({ ...patch, updatedAt: iso(ctx) }).where(eq(pageBriefs.id, id)).run()
}

function publishedTrustStrips(ctx: ServiceCtx): TrustStripSource[] {
  const rows = ctx.db
    .select({ publishedVersionId: pages.publishedVersionId })
    .from(pages)
    .where(and(eq(pages.siteId, ctx.siteId), isNotNull(pages.publishedVersionId), isNull(pages.deletedAt)))
    .all()
  const out: TrustStripSource[] = []
  for (const row of rows) {
    if (!row.publishedVersionId) continue
    const doc = readDoc(ctx, row.publishedVersionId)
    for (const block of doc.blocks) {
      if (block.type !== 'TrustStrip') continue
      const props = block.props as TrustStripSource
      out.push({ heading: typeof props.heading === 'string' ? props.heading : undefined, intro: typeof props.intro === 'string' ? props.intro : undefined, items: props.items ?? [] })
    }
  }
  return out
}

function siteContext(ctx: ServiceCtx): { images: ComposeImage[]; embeds: ComposeEmbed[]; trustMedia: TrustMedia[]; existingTrustStrips: TrustStripSource[]; templates: string[]; allowed: Record<string, string[]> } {
  const rows = ctx.db
    .select({ id: media.id, alt: media.alt, filename: media.filename, kind: media.kind })
    .from(media)
    .where(and(eq(media.siteId, ctx.siteId), inArray(media.kind, ['image', 'svg']), eq(media.status, 'ready'), isNull(media.deletedAt)))
    .all()
  const trustMedia = rows.filter((row) => isTrustMedia(row))
  const images = rows.filter((row) => row.kind !== 'svg' && !isTrustMedia(row)).slice(0, 24)
  const embeds = listEmbeds(ctx).map((e) => ({ id: e.id, name: e.name, kind: e.provider }))
  const allowed: Record<string, string[]> = {}
  const templateKeys: string[] = []
  for (const row of listTemplates(ctx)) {
    if (!row.publishedVersionId) continue
    const rules = getTemplateRules(ctx, row.key)
    if (!rules) continue
    templateKeys.push(row.key)
    allowed[row.key] = rules.allowedBlocks
  }
  return { images, embeds, trustMedia, existingTrustStrips: publishedTrustStrips(ctx), templates: templateKeys, allowed }
}

function alreadyCovered(id: BriefQuestion['id'], blob: string): boolean {
  switch (id) {
    case 'purpose':
      return blob.replace(/\s+/g, ' ').trim().length >= 40
    case 'audience':
      return /\baudience\b|\bsupporter|\bdonor|\bvisitor|\bpublic\b|\bnew to\b|\blocal\b/.test(blob)
    case 'usage':
      return /\bcampaign\b|\bevergreen\b|\bstory\b|\bevent\b|\bappeal\b|\bstandard page\b|\bhome page\b/.test(blob)
    case 'content':
      return /\bphoto|\bstory\b|\bnotes\b|\bi have\b|\bform\b|\blater\b/.test(blob)
    case 'cta':
      return /\bdonate\b|\bdonation\b|\bvirtuous\b|\bno ask\b|\bcall to action\b|\bgive\b/.test(blob)
    case 'look':
      return /\btone\b|\burgent\b|\bcalm\b|\bcelebrat|\bhopeful\b|\bbrand\b|\blook\b|\bfeel\b|\bfactual\b/.test(blob)
    default:
      return false
  }
}

export function nextFallbackQuestion(prompt: string, answers: BriefAnswer[]): BriefQuestion | null {
  const asked = new Set(answers.map((a) => a.id))
  const blob = [prompt, ...answers.map((a) => `${a.id} ${a.chip ?? ''} ${a.text ?? ''}`)].join('\n').toLowerCase()
  for (const question of FALLBACK_QUESTIONS) {
    if (asked.has(question.id)) continue
    if (alreadyCovered(question.id, blob)) continue
    return question
  }
  return null
}

function parseTurn(raw: unknown, asked: Set<string>): { kind: 'question'; question: BriefQuestion } | { kind: 'plan'; plan: PagePlan } | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const planCandidate = rec.kind === 'plan' && rec.plan ? rec.plan : rec.sections || rec.title ? rec : null
  if (planCandidate) {
    const parsed = pagePlanSchema.safeParse(planCandidate)
    if (parsed.success) return { kind: 'plan', plan: parsed.data }
  }
  const questionCandidate = rec.kind === 'question' && rec.question ? rec.question : rec.prompt ? rec : rec.question
  const parsed = briefQuestionSchema.safeParse(questionCandidate)
  if (parsed.success && !asked.has(parsed.data.id)) return { kind: 'question', question: parsed.data }
  return null
}

function finalisePlan(plan: PagePlan, row: BriefRow): PagePlan {
  const answers = (row.answers ?? []) as BriefAnswer[]
  return enrichPlanSections(plan, { prompt: row.prompt, answers })
}

export function interviewSystemPrompt(ctxInfo: { templates: string[]; embeds: ComposeEmbed[] }, asked: string[], questionCount: number, stripped = ''): string {
  const embedList = ctxInfo.embeds.length
    ? ctxInfo.embeds.map((e) => `${e.name} (${e.id}${e.kind ? `, ${e.kind}` : ''})`).join('; ')
    : 'none registered'
  const base = `You help a charity staff member plan a new web page. Reply with one JSON object only, no markdown and no commentary.

Ask one question at a time, at most ${MAX_BRIEF_QUESTIONS} questions in total, only to fill gaps on: purpose, audience, usage (campaign, evergreen, story, event, standard, home), content they already have, the call to action or donation (including a Virtuous form if they have one), and look and feel (tone: primary, neutral or accent — the current brand pack is already applied). Do not re-ask what they already answered. Already asked: ${asked.join(', ') || 'none'}. Questions asked so far: ${questionCount}.

If you have enough to plan, or ${MAX_BRIEF_QUESTIONS} questions have already been asked, return a plan instead of a question.

Question shape:
{"kind":"question","question":{"id":"purpose|audience|usage|content|cta|look","prompt":"...","chips":["..."],"allowFreeText":true}}

Plan shape:
{"kind":"plan","plan":{"title":"...","slug":"...","template":"${ctxInfo.templates.join('|') || 'standard'}","purpose":"...","audience":"...","usage":"campaign|evergreen|story|event|standard|home","contentNotes":"...","cta":{"kind":"donation|link|none","embedId":"...","label":"...","href":"..."},"tone":"primary|neutral|accent","sections":[{"type":"Hero","purpose":"..."}],"seoTitle":"...","seoDescription":"...","summary":"Here's what I'll build: ..."}}

Use only these block types: Hero, RichText, TextAndImage, Image, Gallery, Quote, Stats, CardGrid, CallToAction, FAQ, DonationEmbed, Embed, ImpactTiers, DonationProgress, MatchBanner, MatchThermometer, StoryBeforeAfter, TrustStrip.
Prefer the campaign blocks (ImpactTiers, DonationProgress, MatchBanner, MatchThermometer, StoryBeforeAfter, TrustStrip) on a fundraising campaign.
Registered donation forms: ${embedList}.
Do not invent statistics, totals, ratings, deadlines or quotes as if they were facts. If a figure is unknown, leave it out of the plan so placeholders can be used.
The page will stay a draft and will not be published.

${formatPlannerGuidance()}`
  const section = personalitySection(stripped)
  if (!section) return base
  return `${base}\n\n${section}\n\nThe reply is still a single JSON object.`
}

async function callModel(ctx: ServiceCtx, actor: ActingAs, sessionId: string, system: string, user: string): Promise<{ text: string } | { error: string }> {
  const resolved = requireReadyAi(ctx)
  const session = ctx.db.select().from(aiSessions).where(eq(aiSessions.id, sessionId)).get()
  if (!session) throw new AppError('internal', 'The assistant session is missing.')
  const sessionCap = penceToMicros(resolved.settings.sessionCapPence)
  const monthly = resolved.monthCapMicros
  if (monthly > 0 && monthCostMicros(ctx) >= monthly) throw new AppError('ai_unavailable', briefUnavailable('monthly'))
  if (sessionCap > 0 && session.costMicros >= sessionCap) throw new AppError('ai_unavailable', "That's as far as I can go in this conversation. You can still start a page yourself.")
  const provider = resolveProvider(ctx, resolved, ctx.aiProvider)
  let result: ChatResult
  try {
    result = await provider.complete({
      model: resolved.settings.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
  } catch (error) {
    recordProviderFailure(ctx.now().getTime())
    const message = error instanceof ProviderError || error instanceof AppError ? error.message : "The assistant isn't available right now. Everything else works as normal."
    return { error: message }
  }
  const cost = costMicrosFor(resolved.settings.model, result.usage.tokensIn, result.usage.tokensOut)
  const requestCap = penceToMicros(resolved.settings.requestCapPence)
  addAiUsage(ctx, sessionId, result.usage.tokensIn, result.usage.tokensOut, cost, resolved.settings.model)
  if (requestCap > 0 && cost > requestCap) {
    return { error: "That's as far as I can go in one go. You can still start a page yourself." }
  }
  return { text: typeof result.message.content === 'string' ? result.message.content : '' }
}

async function nextTurn(ctx: ServiceCtx, actor: ActingAs, row: BriefRow, warning?: string): Promise<PageBriefView> {
  const answers = (row.answers ?? []) as BriefAnswer[]
  const asked = answers.map((a) => a.id)
  const info = siteContext(ctx)
  const forcePlan = answers.length >= MAX_BRIEF_QUESTIONS || !nextFallbackQuestion(row.prompt, answers)

  if (forcePlan) {
    const user = buildUserMessage(row.prompt, answers, 'Return a plan now. Do not ask another question.')
    const called = row.sessionId ? await callModel(ctx, actor, row.sessionId, interviewSystemPrompt(info, asked, answers.length, strippedSoul(ctx)), user) : { error: 'no session' }
    let plan: PagePlan | undefined
    if ('text' in called) {
      try {
        const parsed = parseTurn(extractJson(called.text), new Set(asked))
        if (parsed?.kind === 'plan') plan = parsed.plan
      } catch {
        plan = undefined
      }
    }
    if (!plan) plan = planFromAnswers(row.prompt, answers, { embeds: info.embeds })
    else plan = finalisePlan(plan, row)
    saveBrief(ctx, row.id, { state: 'planned', plan })
    const updated = requireBrief(ctx, actor, row.id)
    const warn = warning ?? ('error' in called ? "I couldn't reach the assistant just then, so I've drafted a plan from what you've already told me." : undefined)
    return toView(updated, { warning: warn })
  }

  const user = buildUserMessage(row.prompt, answers, 'Ask the next useful question, or return a plan if you already have enough.')
  const called = row.sessionId ? await callModel(ctx, actor, row.sessionId, interviewSystemPrompt(info, asked, answers.length, strippedSoul(ctx)), user) : { error: 'no session' }
  if ('text' in called) {
    try {
      const parsed = parseTurn(extractJson(called.text), new Set(asked))
      if (parsed?.kind === 'plan') {
        saveBrief(ctx, row.id, { state: 'planned', plan: finalisePlan(parsed.plan, row) })
        return toView(requireBrief(ctx, actor, row.id), { warning })
      }
      if (parsed?.kind === 'question') {
        return toView(row, { question: parsed.question, warning })
      }
    } catch {
      // fall through
    }
  }
  const fallback = nextFallbackQuestion(row.prompt, answers)
  if (fallback) {
    const warn = warning ?? ('error' in called ? "I couldn't reach the assistant just then, so I've asked the next question from a short list." : "I couldn't read the assistant's last reply, so I've asked the next question from a short list.")
    return toView(row, { question: fallback, warning: warn })
  }
  const plan = planFromAnswers(row.prompt, answers, { embeds: info.embeds })
  saveBrief(ctx, row.id, { state: 'planned', plan })
  return toView(requireBrief(ctx, actor, row.id), { warning: warning ?? "I've drafted a plan from what you've already told me." })
}

function buildUserMessage(prompt: string, answers: BriefAnswer[], instruction: string): string {
  const lines = [`The person said: ${prompt}`]
  if (answers.length) {
    lines.push('Answers so far:')
    for (const a of answers) {
      lines.push(`- ${a.id}: ${(a.chip || a.text || '').trim()}${a.chip && a.text ? ` (${a.text})` : ''}`)
    }
  }
  lines.push(instruction)
  return lines.join('\n')
}

function openBriefSession(ctx: ServiceCtx, actor: ActingAs, briefId: string): string {
  const session = {
    id: newId('aiSession', ctx.now().getTime()),
    siteId: ctx.siteId,
    userId: actor.id,
    taskType: 'new_page' as const,
    targetType: 'page' as const,
    targetId: briefId,
    state: 'active' as const,
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    createdAt: iso(ctx),
    endedAt: null,
  }
  ctx.db.insert(aiSessions).values(session).run()
  audit(ctx, actor, 'ai.session_started', { type: 'page_brief', id: briefId }, { sessionId: session.id, taskType: 'new_page' })
  return session.id
}

export async function startPageBrief(ctx: ServiceCtx, actor: ActingAs, prompt: string): Promise<PageBriefView> {
  requireEdit(actor)
  requireReadyAi(ctx)
  const text = prompt.trim()
  if (!text) throw new AppError('validation_failed', 'Say what you want the page to be.', [{ path: 'prompt', message: 'Needed.' }])
  if (text.length > MAX_BRIEF_PROMPT) throw new AppError('validation_failed', `Keep the description under ${MAX_BRIEF_PROMPT} characters.`, [{ path: 'prompt', message: 'Too long.' }])
  const id = newId('pageBrief', ctx.now().getTime())
  const sessionId = openBriefSession(ctx, actor, id)
  const now = iso(ctx)
  ctx.db.insert(pageBriefs).values({
    id,
    siteId: ctx.siteId,
    userId: actor.id,
    sessionId,
    state: 'interviewing',
    prompt: text,
    answers: [],
    plan: null,
    pageId: null,
    templateId: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  audit(ctx, actor, 'page_brief.started', { type: 'page_brief', id }, {})
  return nextTurn(ctx, actor, requireBrief(ctx, actor, id))
}

export function getPageBrief(ctx: ServiceCtx, actor: ActingAs, id: string): PageBriefView {
  requireEdit(actor)
  const row = requireBrief(ctx, actor, id)
  if (row.state === 'interviewing') {
    const answers = (row.answers ?? []) as BriefAnswer[]
    const question = nextFallbackQuestion(row.prompt, answers) ?? undefined
    return toView(row, { question })
  }
  return toView(row)
}

export async function answerPageBrief(ctx: ServiceCtx, actor: ActingAs, id: string, input: { questionId?: string; chip?: string; text?: string; prompt?: string }): Promise<PageBriefView> {
  requireEdit(actor)
  const row = requireBrief(ctx, actor, id)
  if (row.state !== 'interviewing') throw new AppError('invalid_state', 'This brief is past the questions. You can build the page from the plan.')
  const chip = input.chip?.trim()
  const text = input.text?.trim()
  if (!chip && !text) throw new AppError('validation_failed', 'Choose a suggestion or write an answer.', [{ path: 'text', message: 'Needed.' }])
  const answers = [...((row.answers ?? []) as BriefAnswer[])]
  const questionId = briefQuestionSchema.shape.id.safeParse(input.questionId).success
    ? (input.questionId as BriefAnswer['id'])
    : (nextFallbackQuestion(row.prompt, answers)?.id ?? 'purpose')
  const parsed = briefAnswerSchema.parse({
    id: questionId,
    prompt: (input.prompt ?? '').slice(0, 280),
    ...(chip ? { chip } : {}),
    ...(text ? { text } : {}),
  })
  answers.push(parsed)
  saveBrief(ctx, row.id, { answers })
  return nextTurn(ctx, actor, requireBrief(ctx, actor, id))
}

function uniqueSlug(ctx: ServiceCtx, base: string): string {
  const root = (base || 'page').slice(0, 80)
  for (let i = 0; i < 40; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const slug = `${root.slice(0, 80 - suffix.length)}${suffix}`
    const path = `/${slug}`
    const clash = ctx.db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.siteId, ctx.siteId), eq(pages.path, path), isNull(pages.deletedAt)))
      .get()
    if (!clash) return slug
  }
  return `${root.slice(0, 70)}-${ctx.now().getTime().toString(36)}`
}

function templateKeyFromTitle(title: string): string {
  const base = slugify(title).slice(0, 32) || 'page'
  const keyed = /^[a-z]/.test(base) ? base : `p-${base}`
  return keyed.slice(0, 40)
}

function uniqueTemplateKey(ctx: ServiceCtx, title: string): string {
  const base = templateKeyFromTitle(title)
  for (let i = 0; i < 20; i++) {
    const key = i === 0 ? base : `${base.slice(0, 36)}-${i + 1}`.slice(0, 40)
    if (!listTemplates(ctx).some((t) => t.key === key)) return key
  }
  return `${base.slice(0, 30)}-${ctx.now().getTime().toString(36)}`.slice(0, 40)
}

export async function buildPageBrief(ctx: ServiceCtx, actor: ActingAs, id: string, input: { saveAsTemplate?: boolean; sections?: PlannedSection[] } = {}): Promise<PageBriefView> {
  requireEdit(actor)
  const row = requireBrief(ctx, actor, id)
  if (row.state === 'built' && row.pageId) return toView(row)
  if (row.state !== 'planned' || !row.plan) throw new AppError('invalid_state', 'Finish the questions and confirm the plan before building.')
  let plan = pagePlanSchema.parse(row.plan)
  if (input.sections) {
    // Honour the person's checked list. Do not re-add sections they unchecked.
    plan = pagePlanSchema.parse({ ...plan, sections: input.sections })
  }
  const info = siteContext(ctx)
  const composed = composePageFromPlan(plan, {
    registry: ctx.registry,
    images: info.images,
    embeds: info.embeds,
    trustMedia: info.trustMedia,
    existingTrustStrips: info.existingTrustStrips,
    allowedBlocksByTemplate: info.allowed,
    knownTemplates: info.templates,
  })
  const slug = uniqueSlug(ctx, composed.slug)
  const created = createPage(ctx, actor, { title: composed.title, template: composed.template, slug })
  const pack = getPage(ctx, created.page.id)
  const removeOps: InternalOp[] = pack.doc.blocks.map((block) => ({ op: 'remove_block', blockId: block.id }))
  const addOps: InternalOp[] = composed.blocks.map((block) => ({ op: 'add_block', block: { type: block.type, props: block.props } }))
  const metaOps: InternalOp[] = [
    { op: 'set_meta', title: composed.title },
    { op: 'set_seo', title: composed.seoTitle, description: composed.seoDescription },
  ]
  applyPageOps(ctx, actor, created.page.id, pack.revision, [...removeOps, ...addOps, ...metaOps])

  const after = getPage(ctx, created.page.id)
  if (after.page.workflowState !== 'draft' || after.page.publishedVersionId) {
    throw new AppError('internal', 'The new page was not left as a draft.')
  }

  let templateId: string | null = null
  if (input.saveAsTemplate && can(actor, 'template.edit')) {
    const types = composed.blocks.map((b) => b.type)
    const allowed = [...new Set([...types, 'Hero', 'RichText', 'CallToAction'])]
    const rules: TemplateRules = {
      schemaVersion: 1,
      label: `${composed.title} (assistant)`,
      allowedBlocks: allowed,
      requiredBlocks: composed.template === 'campaign' ? ['Hero', 'DonationEmbed'].filter((t) => types.includes(t) || t === 'Hero') : [],
      startingBlocks: composed.blocks.map((b) => ({ type: b.type, props: b.props })),
    }
    const createdTemplate = createTemplateDraft(ctx, actor, { key: uniqueTemplateKey(ctx, composed.title), rules })
    templateId = createdTemplate.id
  }

  if (row.sessionId) {
    ctx.db.update(aiSessions).set({ state: 'ended', endedAt: iso(ctx), targetId: created.page.id }).where(eq(aiSessions.id, row.sessionId)).run()
  }
  saveBrief(ctx, row.id, { state: 'built', pageId: created.page.id, templateId })
  audit(ctx, actor, 'page_brief.built', { type: 'page', id: created.page.id }, { briefId: row.id, templateId, placeholderCount: composed.placeholderCount })
  return toView(requireBrief(ctx, actor, id))
}

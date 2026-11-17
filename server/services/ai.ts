// AI sessions and the server side of the page builder tools. Every call goes through
// checkToolCall (task, role, owner, bound target) and then the same services as the GUI.
// The model loop lives in ai-loop.ts. See docs/12-ai-harness.md#task-scoped-tools.
import { and, asc, eq, gte, isNull, like, sql } from 'drizzle-orm'
import { checkToolCall, canStartTask, TASKS, type TaskType } from '../../shared/ai-tasks'
import { runChecks } from '../../shared/checks'
import { ratioFromSize } from '../../shared/crop'
import { newId } from '../../shared/ids'
import { opSchema, type Op } from '../../shared/ops'
import { blockAiSummary } from '../../shared/ai/block-guide'
import { aiMessages, aiSessions, embeds, media, memoryEntries, pages, templates } from '../db/schema'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { resolveCrop } from './media'
import { applyPageOps, createPage, getPage, requirePage, sealDraft, slugify } from './pages'
import { renderSessionPreview } from './preview'
import { submitPage } from './reviews'
import { getTemplateRules } from './templates'

export type AiSession = typeof aiSessions.$inferSelect

export function startAiSession(ctx: ServiceCtx, actor: ActingAs, input: { taskType: TaskType; targetId?: string; template?: string }): AiSession {
  if (!canStartTask(actor.role, input.taskType)) throw forbidden("Your role can't use the assistant here.")
  const task = TASKS[input.taskType]
  let targetId = input.targetId
  if (input.taskType === 'new_page') {
    if (!targetId) targetId = createPage(ctx, actor, { title: 'Untitled page', template: input.template ?? 'standard', slug: `untitled-${Date.now().toString(36)}` }).page.id
    const page = requirePage(ctx, targetId)
    if (page.publishedVersionId || page.createdBy !== actor.id) throw new AppError('validation_failed', 'A new page task must start on your own new draft.')
  } else if (input.taskType === 'page_edit') {
    if (!targetId) throw new AppError('validation_failed', 'Say which page to edit.', [{ path: 'targetId', message: 'Needed.' }])
    requirePage(ctx, targetId)
  } else if (input.taskType === 'template') {
    if (!targetId || !ctx.db.select().from(templates).where(and(eq(templates.id, targetId), eq(templates.siteId, ctx.siteId))).get()) throw notFound('That page type')
  } else if (input.taskType === 'alt_text') {
    if (!targetId || !ctx.db.select().from(media).where(and(eq(media.id, targetId), eq(media.siteId, ctx.siteId))).get()) throw notFound('That photo')
  } else if (!targetId) {
    throw new AppError('validation_failed', 'Say which brand pack or theme.', [{ path: 'targetId', message: 'Needed.' }])
  }
  const existing = ctx.db
    .select()
    .from(aiSessions)
    .where(and(eq(aiSessions.siteId, ctx.siteId), eq(aiSessions.userId, actor.id), eq(aiSessions.taskType, input.taskType), eq(aiSessions.targetId, targetId!), eq(aiSessions.state, 'active')))
    .get()
  if (existing) return existing

  const session: AiSession = {
    id: newId('aiSession', ctx.now().getTime()),
    siteId: ctx.siteId,
    userId: actor.id,
    taskType: input.taskType,
    targetType: task.targetType,
    targetId: targetId!,
    state: 'active',
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    createdAt: iso(ctx),
    endedAt: null,
  }
  ctx.db.insert(aiSessions).values(session).run()
  audit(ctx, actor, 'ai.session_started', { type: task.targetType, id: session.targetId }, { sessionId: session.id, taskType: input.taskType })
  return session
}

export function getAiSession(ctx: ServiceCtx, actor: ActingAs, id: string): AiSession {
  const s = ctx.db.select().from(aiSessions).where(and(eq(aiSessions.id, id), eq(aiSessions.siteId, ctx.siteId))).get()
  if (!s || s.userId !== actor.id) throw notFound('That assistant session')
  return s
}

export function findActiveAiSession(ctx: ServiceCtx, actor: ActingAs, taskType: TaskType, targetId: string): AiSession | null {
  return (
    ctx.db
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.siteId, ctx.siteId), eq(aiSessions.userId, actor.id), eq(aiSessions.taskType, taskType), eq(aiSessions.targetId, targetId), eq(aiSessions.state, 'active')))
      .get() ?? null
  )
}

export function listAiMessages(ctx: ServiceCtx, sessionId: string) {
  return ctx.db.select().from(aiMessages).where(eq(aiMessages.sessionId, sessionId)).orderBy(asc(aiMessages.createdAt)).all()
}

export function appendAiMessage(ctx: ServiceCtx, sessionId: string, role: 'user' | 'assistant' | 'tool', content: Record<string, unknown>) {
  const id = newId('aiMessage', ctx.now().getTime())
  ctx.db.insert(aiMessages).values({ id, siteId: ctx.siteId, sessionId, role, content, createdAt: iso(ctx) }).run()
  return id
}

export function addAiUsage(ctx: ServiceCtx, sessionId: string, tokensIn: number, tokensOut: number, costMicros: number, model?: string) {
  const session = ctx.db.select().from(aiSessions).where(eq(aiSessions.id, sessionId)).get()
  if (!session) return
  ctx.db
    .update(aiSessions)
    .set({
      tokensIn: session.tokensIn + tokensIn,
      tokensOut: session.tokensOut + tokensOut,
      costMicros: session.costMicros + costMicros,
      ...(model ? { model } : {}),
    })
    .where(eq(aiSessions.id, sessionId))
    .run()
}

/** Sum of costMicros for sessions created in the current UTC month. */
export function monthCostMicros(ctx: ServiceCtx): number {
  const now = ctx.now()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const row = ctx.db
    .select({ n: sql<number>`coalesce(sum(${aiSessions.costMicros}), 0)` })
    .from(aiSessions)
    .where(and(eq(aiSessions.siteId, ctx.siteId), gte(aiSessions.createdAt, start)))
    .get()
  return Number(row?.n ?? 0)
}

const PAGE_OPS = new Set(['add_block', 'update_props', 'move_block', 'remove_block', 'set_seo', 'set_meta'])

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string; fields?: { path: string; message: string }[] }

/** Run one tool call for an AI session. Never throws for model mistakes: returns an error the model can read and fix. */
export async function runTool(ctx: ServiceCtx, actor: ActingAs, sessionId: string, tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const session = getAiSession(ctx, actor, sessionId)
  const callTargetId = typeof args.pageId === 'string' ? args.pageId : undefined
  const decision = checkToolCall({ role: actor.role, session, userId: actor.id, tool, callTargetType: callTargetId ? 'page' : undefined, callTargetId })
  const asAi: ActingAs = { ...actor, aiSessionId: session.id }
  if (!decision.ok) {
    audit(ctx, asAi, 'ai.tool_refused', { type: session.targetType, id: session.targetId }, { tool, reason: decision.reason })
    return { ok: false, error: decision.reason }
  }
  try {
    const result = await dispatch(ctx, asAi, session, tool, args)
    audit(ctx, asAi, 'ai.tool', { type: session.targetType, id: session.targetId }, { tool })
    return { ok: true, result }
  } catch (error) {
    if (error instanceof AppError) {
      audit(ctx, asAi, 'ai.tool_failed', { type: session.targetType, id: session.targetId }, { tool, code: error.code })
      return { ok: false, error: error.message, fields: error.fields }
    }
    throw error
  }
}

async function dispatch(ctx: ServiceCtx, actor: ActingAs, session: AiSession, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const pageId = session.targetId
  if (PAGE_OPS.has(tool)) {
    const { op: _ignored, pageId: _p, ...rest } = args
    const parsed = opSchema.safeParse({ op: tool, ...rest })
    if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]!.message, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
    const page = requirePage(ctx, pageId)
    const result = applyPageOps(ctx, actor, pageId, page.draftRevision, [parsed.data as Op])
    return { revision: result.revision, opIds: result.opIds, blocks: result.doc.blocks.map((b) => ({ id: b.id, type: b.type })) }
  }
  switch (tool) {
    case 'get_page': {
      const { page, doc, revision } = getPage(ctx, pageId)
      return { title: page.title, path: page.path, template: page.template, revision, doc }
    }
    case 'list_blocks': {
      const page = requirePage(ctx, pageId)
      const rules = getTemplateRules(ctx, page.template)
      return (rules?.allowedBlocks ?? []).map((type) => {
        const def = ctx.registry.get(type)
        const guide = def ? blockAiSummary(def) : null
        return {
          type,
          label: def?.label,
          schema: ctx.registry.jsonSchema(type),
          required: rules?.requiredBlocks.includes(type) ?? false,
          ...(guide
            ? {
                purpose: guide.purpose,
                useWhen: guide.useWhen,
                pairsWith: guide.pairsWith,
                avoidWhen: guide.avoidWhen,
                fields: guide.fields,
                good: guide.good,
                bad: guide.bad,
              }
            : {}),
        }
      })
    }
    case 'list_templates':
      return ctx.db.select({ key: templates.key, label: templates.label }).from(templates).where(eq(templates.siteId, ctx.siteId)).all()
    case 'list_embeds':
      return ctx.db.select({ id: embeds.id, name: embeds.name, provider: embeds.provider }).from(embeds).where(and(eq(embeds.siteId, ctx.siteId), isNull(embeds.archivedAt))).all()
    case 'search_media': {
      const q = typeof args.query === 'string' ? args.query : ''
      return ctx.db
        .select({ id: media.id, filename: media.filename, alt: media.alt, width: media.width, height: media.height })
        .from(media)
        .where(and(eq(media.siteId, ctx.siteId), isNull(media.deletedAt), eq(media.status, 'ready'), q ? like(media.alt, `%${q}%`) : undefined))
        .limit(20)
        .all()
    }
    case 'run_checks': {
      const { page, doc } = getPage(ctx, pageId)
      return runChecks(doc, ctx.registry, getTemplateRules(ctx, page.template))
    }
    case 'submit_for_review': {
      sealDraft(ctx, pageId, actor, 'ai')
      // Submitted in the person's name: they asked for it and they are accountable.
      const { aiSessionId: _s, ...person } = actor
      return submitPage(ctx, person, pageId, { note: typeof args.summary === 'string' ? args.summary.slice(0, 500) : undefined })
    }
    case 'remember': {
      const text = typeof args.text === 'string' ? args.text.trim().slice(0, 300) : ''
      if (!text) throw new AppError('validation_failed', 'Nothing to remember.')
      const id = newId('memory', ctx.now().getTime())
      ctx.db
        .insert(memoryEntries)
        .values({ id, siteId: ctx.siteId, scope: args.scope === 'site' ? 'site' : 'user', userId: actor.id, text, state: 'proposed', createdBy: actor.id, createdAt: iso(ctx) })
        .run()
      return { proposedMemoryId: id, note: 'Shown to the person to accept. Not saved until they do.' }
    }
    case 'create_draft':
      return createDraft(ctx, actor, session, args)
    case 'request_upload':
      return requestUpload(ctx, actor, session, args)
    case 'crop_media':
      return cropMedia(ctx, actor, session, args)
    case 'preview_screenshot':
      return renderSessionPreview(ctx, session, args, { filesDir: ctx.filesDir })
    default:
      throw new AppError('validation_failed', `Unknown tool "${tool}".`)
  }
}

function createDraft(ctx: ServiceCtx, actor: ActingAs, session: AiSession, args: Record<string, unknown>) {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title) throw new AppError('validation_failed', 'Give the page a title.', [{ path: 'title', message: 'Needed.' }])
  const template = typeof args.template === 'string' ? args.template : undefined
  const slugArg = typeof args.slug === 'string' ? args.slug : undefined
  const parentId = args.parentId === null ? null : typeof args.parentId === 'string' ? args.parentId : undefined
  return inTx(ctx, () => {
    const page = requirePage(ctx, session.targetId)
    if (template && template !== page.template) {
      if (!getTemplateRules(ctx, template)) {
        throw new AppError('validation_failed', `There is no "${template}" page type.`, [{ path: 'template', message: 'Unknown page type.' }])
      }
      ctx.db.update(pages).set({ template, updatedAt: iso(ctx) }).where(eq(pages.id, page.id)).run()
    }
    const slug = slugArg ?? (page.slug.startsWith('untitled-') ? slugify(title) : undefined)
    const current = requirePage(ctx, page.id)
    const result = applyPageOps(ctx, actor, page.id, current.draftRevision, [{ op: 'set_meta', title, ...(slug !== undefined ? { slug } : {}), ...(parentId !== undefined ? { parentId } : {}) }])
    const latest = requirePage(ctx, page.id)
    return { pageId: latest.id, title: latest.title, template: latest.template, path: latest.path, revision: result.revision }
  })
}

function requestUpload(ctx: ServiceCtx, actor: ActingAs, session: AiSession, args: Record<string, unknown>) {
  const purpose = typeof args.purpose === 'string' ? args.purpose.trim() : ''
  const message = typeof args.message === 'string' ? args.message.trim() : ''
  if (!purpose && !message) throw new AppError('validation_failed', 'Say what photo you need and what it is for.', [{ path: 'purpose', message: 'Needed.' }])
  const blockId = typeof args.blockId === 'string' ? args.blockId : undefined
  const slot = typeof args.slot === 'string' ? args.slot : undefined
  let ratio = typeof args.ratio === 'string' ? args.ratio : undefined
  if (blockId) {
    const found = slotOnPage(ctx, session.targetId, blockId, slot)
    ratio = ratio ?? found.ratio
  }
  const requestId = newId('aiMessage', ctx.now().getTime())
  const result = {
    needsYou: 'upload' as const,
    requestId,
    purpose: purpose || message,
    message: message || purpose,
    blockId,
    slot,
    ratio,
    note: 'Shown to the person to upload. The assistant cannot upload a file for them.',
  }
  recordNeedsYou(ctx, actor, session, requestId, 'request_upload', result)
  return result
}

function cropMedia(ctx: ServiceCtx, actor: ActingAs, session: AiSession, args: Record<string, unknown>) {
  const mediaId = typeof args.mediaId === 'string' ? args.mediaId : ''
  if (!mediaId) throw new AppError('validation_failed', 'Pick an image to crop.', [{ path: 'mediaId', message: 'Needed.' }])
  const blockId = typeof args.blockId === 'string' ? args.blockId : undefined
  const slot = typeof args.slot === 'string' ? args.slot : undefined
  let ratio = typeof args.ratio === 'string' ? args.ratio : undefined
  if (blockId) {
    const found = slotOnPage(ctx, session.targetId, blockId, slot)
    ratio = ratio ?? found.ratio
  }
  if (!ratio) throw new AppError('validation_failed', 'Say the crop ratio, or which section slot it is for.', [{ path: 'ratio', message: 'Needed.' }])
  const rectArg = isRect(args.rect) ? args.rect : undefined
  const breakpoint = args.breakpoint === 'mobile' || args.breakpoint === 'desktop' || args.breakpoint === 'all' ? args.breakpoint : 'all'
  const resolved = resolveCrop(ctx, mediaId, { ratio, breakpoint, rect: rectArg })
  const requestId = newId('aiMessage', ctx.now().getTime())
  const result = {
    needsYou: 'approve_crop' as const,
    requestId,
    mediaId: resolved.media.id,
    ratio: resolved.ratio,
    breakpoint: resolved.breakpoint,
    rect: resolved.rect,
    suggested: !rectArg,
    blockId,
    slot,
    note: 'Shown to the person to approve. The crop is not applied until they do.',
  }
  recordNeedsYou(ctx, actor, session, requestId, 'crop_media', result)
  return result
}

function slotOnPage(ctx: ServiceCtx, pageId: string, blockId: string, slot?: string): { ratio: string; slot: string } {
  const { doc } = getPage(ctx, pageId)
  const block = doc.blocks.find((b) => b.id === blockId)
  if (!block) throw new AppError('validation_failed', "That section isn't on this page.", [{ path: 'blockId', message: 'Not on this page.' }])
  const slots = ctx.registry.get(block.type)?.imageSlots ?? {}
  const key = slot ?? Object.keys(slots)[0]
  const size = key ? slots[key] : undefined
  if (!key || !size) throw new AppError('validation_failed', "That section doesn't have an image slot.", [{ path: 'slot', message: 'No image slot.' }])
  return { slot: key, ratio: ratioFromSize(size.width, size.height) }
}

function isRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return [v.x, v.y, v.width, v.height].every((n) => typeof n === 'number' && Number.isInteger(n))
}

function recordNeedsYou(ctx: ServiceCtx, actor: ActingAs, session: AiSession, id: string, tool: string, content: Record<string, unknown>) {
  ctx.db
    .insert(aiMessages)
    .values({ id, siteId: ctx.siteId, sessionId: session.id, role: 'tool', content: { tool, ...content }, createdAt: iso(ctx) })
    .run()
  audit(ctx, actor, 'ai.needs_you', { type: session.targetType, id: session.targetId }, { tool, requestId: id })
}

/** End of an AI turn: seal the AI's snapshot so it shows as one entry in History. */
export function endAiTurn(ctx: ServiceCtx, actor: ActingAs, sessionId: string) {
  const session = getAiSession(ctx, actor, sessionId)
  if (session.targetType === 'page') sealDraft(ctx, session.targetId, { ...actor, aiSessionId: session.id }, 'ai')
}

/** Stop a session (the Stop button, or closing the task). Its changes stay in the draft as one AI version. */
export function cancelAiSession(ctx: ServiceCtx, actor: ActingAs, sessionId: string) {
  const session = getAiSession(ctx, actor, sessionId)
  if (session.state === 'ended') return session
  if (session.targetType === 'page') {
    const page = ctx.db.select({ id: pages.id, deletedAt: pages.deletedAt }).from(pages).where(eq(pages.id, session.targetId)).get()
    if (page && !page.deletedAt) sealDraft(ctx, session.targetId, { ...actor, aiSessionId: session.id }, 'ai')
  }
  ctx.db.update(aiSessions).set({ state: 'ended', endedAt: iso(ctx) }).where(eq(aiSessions.id, session.id)).run()
  audit(ctx, actor, 'ai.session_cancelled', { type: session.targetType, id: session.targetId }, { sessionId: session.id })
  return { ...session, state: 'ended' as const, endedAt: iso(ctx) }
}

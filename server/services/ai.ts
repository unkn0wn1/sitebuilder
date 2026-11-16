// AI sessions and the server side of the page builder tools. No model calls here: the harness
// (Phase 4) will call runTool for each tool call the model makes. Every call goes through
// checkToolCall (task, role, owner, bound target) and then the same services as the GUI.
// See docs/12-ai-harness.md#task-scoped-tools.
import { and, eq, isNull, like } from 'drizzle-orm'
import { checkToolCall, canStartTask, TASKS, type TaskType } from '../../shared/ai-tasks'
import { runChecks } from '../../shared/checks'
import { newId } from '../../shared/ids'
import { opSchema, type Op } from '../../shared/ops'
import { aiSessions, embeds, media, memoryEntries, templates } from '../db/schema'
import { audit } from './audit'
import { iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { applyPageOps, createPage, getPage, requirePage, sealDraft } from './pages'
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
  } else if (!targetId) {
    throw new AppError('validation_failed', 'Say which brand pack or theme.', [{ path: 'targetId', message: 'Needed.' }])
  }
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

const PAGE_OPS = new Set(['add_block', 'update_props', 'move_block', 'remove_block', 'set_seo', 'set_meta'])

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string; fields?: { path: string; message: string }[] }

/** Run one tool call for an AI session. Never throws for model mistakes: returns an error the model can read and fix. */
export function runTool(ctx: ServiceCtx, actor: ActingAs, sessionId: string, tool: string, args: Record<string, unknown> = {}): ToolResult {
  const session = getAiSession(ctx, actor, sessionId)
  const callTargetId = typeof args.pageId === 'string' ? args.pageId : undefined
  const decision = checkToolCall({ role: actor.role, session, userId: actor.id, tool, callTargetType: callTargetId ? 'page' : undefined, callTargetId })
  const asAi: ActingAs = { ...actor, aiSessionId: session.id }
  if (!decision.ok) {
    audit(ctx, asAi, 'ai.tool_refused', { type: session.targetType, id: session.targetId }, { tool, reason: decision.reason })
    return { ok: false, error: decision.reason }
  }
  try {
    const result = dispatch(ctx, asAi, session, tool, args)
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

function dispatch(ctx: ServiceCtx, actor: ActingAs, session: AiSession, tool: string, args: Record<string, unknown>): unknown {
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
      return (rules?.allowedBlocks ?? []).map((type) => ({ type, label: ctx.registry.get(type)?.label, schema: ctx.registry.jsonSchema(type), required: rules?.requiredBlocks.includes(type) ?? false }))
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
    case 'request_upload':
    case 'crop_media':
    case 'preview_screenshot':
    case 'create_draft':
      return { status: 'not_available_yet', message: 'This tool is not built yet.' }
    default:
      throw new AppError('validation_failed', `Unknown tool "${tool}".`)
  }
}

/** End of an AI turn: seal the AI's snapshot so it shows as one entry in History. */
export function endAiTurn(ctx: ServiceCtx, actor: ActingAs, sessionId: string) {
  const session = getAiSession(ctx, actor, sessionId)
  if (session.targetType === 'page') sealDraft(ctx, session.targetId, { ...actor, aiSessionId: session.id }, 'ai')
}

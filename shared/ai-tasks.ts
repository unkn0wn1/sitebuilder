// Task-scoped AI tools. Every AI session is one task bound to one target; each task type has its own
// small tool set, filtered by role. Admins can start every task type, but each session stays bound.
// See docs/12-ai-harness.md#task-scoped-tools and ADR 0012.
import { atLeast, type Role } from './roles'

export const TASK_TYPES = ['new_page', 'page_edit', 'template', 'brand_design'] as const
export type TaskType = (typeof TASK_TYPES)[number]

export type TargetType = 'page' | 'template' | 'brand'

const PAGE_TOOLS = [
  'list_blocks',
  'get_page',
  'add_block',
  'update_props',
  'move_block',
  'remove_block',
  'search_media',
  'request_upload',
  'crop_media',
  'list_embeds',
  'set_seo',
  'preview_screenshot',
  'run_checks',
  'submit_for_review',
  'remember',
] as const

export const TASKS: Record<TaskType, { targetType: TargetType; minRole: Role; tools: readonly string[] }> = {
  new_page: { targetType: 'page', minRole: 'editor', tools: [...PAGE_TOOLS, 'list_templates', 'create_draft', 'set_meta'] },
  page_edit: { targetType: 'page', minRole: 'editor', tools: [...PAGE_TOOLS, 'set_meta'] },
  template: { targetType: 'template', minRole: 'admin', tools: ['get_template', 'list_blocks', 'set_template_rules', 'preview_screenshot', 'submit_for_review', 'remember'] },
  brand_design: { targetType: 'brand', minRole: 'admin', tools: ['get_brand', 'set_brand_tokens', 'list_themes', 'preview_screenshot', 'run_contrast_checks', 'submit_for_review', 'remember'] },
}

/** Tools that do not exist in any task, by design. Listed so tests can prove they are never granted. */
export const NEVER_TOOLS = ['publish', 'approve', 'run_code', 'fetch_url', 'send_email', 'write_html', 'write_css', 'edit_menu', 'edit_header', 'edit_footer']

export function canStartTask(role: Role, task: TaskType): boolean {
  return atLeast(role, TASKS[task].minRole)
}

export function toolsFor(role: Role, task: TaskType): readonly string[] {
  return canStartTask(role, task) ? TASKS[task].tools : []
}

export interface ToolCallCheck {
  role: Role
  session: { taskType: TaskType; targetType: TargetType; targetId: string; userId: string; state: 'active' | 'parked' | 'ended' }
  userId: string
  tool: string
  /** The target the call wants to act on, if it names one. Defaults to the session's target. */
  callTargetType?: TargetType
  callTargetId?: string
}

export type ToolCallDecision = { ok: true } | { ok: false; reason: string }

/** The one check every AI tool call goes through on the server: session owner, state, task, role and bound target. */
export function checkToolCall(c: ToolCallCheck): ToolCallDecision {
  if (c.session.userId !== c.userId) return { ok: false, reason: 'This assistant session belongs to someone else.' }
  if (c.session.state !== 'active') return { ok: false, reason: 'This assistant session has ended.' }
  if (!canStartTask(c.role, c.session.taskType)) return { ok: false, reason: 'Your role cannot use this kind of assistant task.' }
  if (!TASKS[c.session.taskType].tools.includes(c.tool)) {
    return { ok: false, reason: `The "${c.tool}" tool isn't available when ${describeTask(c.session.taskType)}.` }
  }
  const type = c.callTargetType ?? c.session.targetType
  const id = c.callTargetId ?? c.session.targetId
  if (type !== c.session.targetType || id !== c.session.targetId) {
    return { ok: false, reason: 'This assistant session can only change the one thing it was opened for.' }
  }
  return { ok: true }
}

function describeTask(task: TaskType): string {
  switch (task) {
    case 'new_page':
      return 'making a new page'
    case 'page_edit':
      return 'editing a page'
    case 'template':
      return 'editing a page type'
    case 'brand_design':
      return 'editing the brand and design'
  }
}

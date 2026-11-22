import { describe, expect, it } from 'vitest'
import { checkToolCall, NEVER_TOOLS, TASKS, toolsFor, type TaskType } from '../shared/ai-tasks'
import { can } from '../shared/roles'

const session = (taskType: TaskType, targetId = 'pg_1', userId = 'usr_1') => ({ taskType, targetType: TASKS[taskType].targetType, targetId, userId, state: 'active' as const })

describe('task-scoped AI tools', () => {
  it('editors only get page tasks; admins get every task type', () => {
    expect(toolsFor('editor', 'page_edit')).toContain('update_props')
    expect(toolsFor('editor', 'template')).toEqual([])
    expect(toolsFor('editor', 'brand_design')).toEqual([])
    expect(toolsFor('approver', 'template')).toEqual([])
    expect(toolsFor('admin', 'template')).toContain('set_template_rules')
  })

  it('a page edit session cannot touch menus, templates, brand or other pages, even for admins', () => {
    for (const role of ['editor', 'admin'] as const) {
      const base = { role, session: session('page_edit'), userId: 'usr_1' }
      expect(checkToolCall({ ...base, tool: 'update_props' }).ok).toBe(true)
      expect(checkToolCall({ ...base, tool: 'edit_menu' }).ok).toBe(false)
      expect(checkToolCall({ ...base, tool: 'set_template_rules' }).ok).toBe(false)
      expect(checkToolCall({ ...base, tool: 'set_brand_tokens' }).ok).toBe(false)
      expect(checkToolCall({ ...base, tool: 'update_props', callTargetType: 'page', callTargetId: 'pg_other' }).ok).toBe(false)
      expect(checkToolCall({ ...base, tool: 'update_props', callTargetType: 'template', callTargetId: 'pg_1' }).ok).toBe(false)
    }
  })

  it('never grants dangerous tools in any task', () => {
    for (const task of Object.keys(TASKS) as TaskType[]) for (const t of NEVER_TOOLS) expect(TASKS[task].tools).not.toContain(t)
  })

  it('only the owner can use an active session', () => {
    expect(checkToolCall({ role: 'admin', session: session('page_edit'), userId: 'usr_2', tool: 'get_page' }).ok).toBe(false)
    expect(checkToolCall({ role: 'editor', session: { ...session('page_edit'), state: 'ended' }, userId: 'usr_1', tool: 'get_page' }).ok).toBe(false)
  })

  it('a role downgrade takes effect on existing sessions', () => {
    expect(checkToolCall({ role: 'editor', session: session('template', 'tpl_1'), userId: 'usr_1', tool: 'get_template' }).ok).toBe(false)
  })
})

describe('roles', () => {
  it('maps actions to roles and operator rights', () => {
    expect(can({ role: 'editor', isOperator: false }, 'page.edit')).toBe(true)
    expect(can({ role: 'editor', isOperator: false }, 'review.decide')).toBe(false)
    expect(can({ role: 'approver', isOperator: false }, 'review.decide')).toBe(true)
    expect(can({ role: 'approver', isOperator: false }, 'site.rollback')).toBe(false)
    expect(can({ role: 'editor', isOperator: false }, 'design.css')).toBe(false)
    expect(can({ role: 'approver', isOperator: false }, 'design.css')).toBe(false)
    expect(can({ role: 'admin', isOperator: false }, 'design.css')).toBe(true)
    expect(can({ role: 'admin', isOperator: false }, 'site.rollback')).toBe(true)
    expect(can({ role: 'admin', isOperator: false }, 'system.read')).toBe(false)
    expect(can({ role: 'editor', isOperator: true }, 'system.read')).toBe(true)
    expect(can({ role: 'editor', isOperator: true }, 'review.decide')).toBe(false)
  })
})

// Roles and what each may do. Checked on the server for every route. See docs/04-gui.md#roles.

export const ROLES = ['editor', 'approver', 'admin'] as const
export type Role = (typeof ROLES)[number]

const RANK: Record<Role, number> = { editor: 1, approver: 2, admin: 3 }

export interface Actor {
  id: string
  role: Role
  isOperator: boolean
}

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min]
}

/** Minimum role per action. "operator" actions are allowed for operators (and listed admins). */
const ACTIONS = {
  'page.read': 'editor',
  'page.edit': 'editor',
  'page.submit': 'editor',
  'page.unpublish': 'approver',
  'page.restoreFromBin': 'approver',
  'media.upload': 'editor',
  'media.delete': 'approver',
  'review.read': 'approver',
  'review.decide': 'approver',
  'sitePart.edit': 'approver',
  'embed.read': 'editor',
  'embed.manage': 'approver',
  'redirect.manage': 'approver',
  'release.read': 'approver',
  'template.read': 'editor',
  'template.edit': 'admin',
  'brand.edit': 'admin',
  'users.manage': 'admin',
  'settings.manage': 'admin',
  'site.rollback': 'admin',
  'audit.read': 'admin',
  'memory.site': 'admin',
} as const satisfies Record<string, Role>

const OPERATOR_ACTIONS = {
  'system.read': { admin: false },
  'backups.manage': { admin: true },
  'secrets.write': { admin: true },
} as const

export type Action = keyof typeof ACTIONS | keyof typeof OPERATOR_ACTIONS

export function can(actor: Pick<Actor, 'role' | 'isOperator'>, action: Action): boolean {
  if (action in OPERATOR_ACTIONS) {
    const rule = OPERATOR_ACTIONS[action as keyof typeof OPERATOR_ACTIONS]
    return actor.isOperator || (rule.admin && actor.role === 'admin')
  }
  return atLeast(actor.role, ACTIONS[action as keyof typeof ACTIONS])
}

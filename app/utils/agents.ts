// Types and small helpers for Settings > Agents (the agent gateway, ADR 0018).
export type RuleResult = 'publish' | 'review' | 'deny'

export interface AgentRule {
  id: string
  label: string
  actions: '*' | string[]
  targets: { pageTemplates?: string[]; pagePaths?: string[]; siteParts?: string[] }
  result: RuleResult
  limits: { maxSections?: number; maxWords?: number; maxNewPages?: number; maxPerHour?: number; allowNewLinks?: boolean; allowedLinkDomains?: string[]; allowMoneyPages?: boolean; withinHours?: number }
}

export interface AgentTokenItem {
  id: string
  name: string
  prefix: string
  access: 'read' | 'draft'
  status: 'active' | 'paused' | 'revoked'
  pausedReason: string | null
  rules: AgentRule[]
  alwaysAllow: { permanent: boolean; until: string | null } | null
  limits: Record<string, number>
  ipAllow: string[] | null
  expiresAt: string | null
  createdAt: string
  lastUsedAt: string | null
  lastUsedIp: string | null
}

export interface AgentChangeItem {
  id: string
  title: string
  status: 'open' | 'review' | 'publishing' | 'published' | 'discarded' | 'undone' | 'failed'
  reason: string
  tokenId: string
  tokenName: string
  createdAt: string
  publishedAt: string | null
  undoOf: string | null
  targets: { type: 'page' | 'site_part'; id: string; label: string; path: string | null }[]
}

export interface AgentAuditItem {
  id: string
  at: string
  actorType: string
  actorId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  details: Record<string, unknown> | null
  tokenName: string | null
}

export interface RulePreset {
  key: string
  label: string
  access: 'read' | 'draft'
  description: string
  rules: Partial<AgentRule>[]
}

export interface ActionInfo {
  key: string
  label: string
}

export const SITE_PART_OPTIONS = [
  { key: 'header', label: 'Header' },
  { key: 'footer', label: 'Footer' },
  { key: 'menu', label: 'Menu' },
  { key: 'banner', label: 'Banner' },
]

export const RESULT_OPTIONS: { name: string; value: RuleResult }[] = [
  { name: 'Publish by itself', value: 'publish' },
  { name: 'Ask a person (review)', value: 'review' },
  { name: 'Refuse', value: 'deny' },
]

export const CHANGE_STATUS_LABELS: Record<AgentChangeItem['status'], string> = {
  open: 'Draft',
  review: 'Waiting for approval',
  publishing: 'Publishing',
  published: 'Live',
  discarded: 'Discarded',
  undone: 'Undone',
  failed: 'Failed to publish',
}

/** A rule as the editor holds it: every field a plain string or boolean so inputs bind directly. */
export interface RuleDraft {
  id?: string
  label: string
  allActions: boolean
  actions: string[]
  result: RuleResult
  pagePaths: string
  pageTemplates: string
  siteParts: string[]
  maxSections: string
  maxWords: string
  maxNewPages: string
  maxPerHour: string
  withinHours: string
  allowNewLinks: boolean
  allowedLinkDomains: string
  allowMoneyPages: boolean
}

const list = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
const num = (text: string) => (text.trim() === '' ? undefined : Number(text))

export function emptyRule(): RuleDraft {
  return { label: '', allActions: false, actions: [], result: 'publish', pagePaths: '', pageTemplates: '', siteParts: [], maxSections: '', maxWords: '', maxNewPages: '', maxPerHour: '', withinHours: '', allowNewLinks: false, allowedLinkDomains: '', allowMoneyPages: false }
}

export function draftFromRule(rule: Partial<AgentRule>): RuleDraft {
  const t = rule.targets ?? {}
  const l = rule.limits ?? {}
  const s = (n: number | undefined) => (n === undefined ? '' : String(n))
  return {
    id: rule.id,
    label: rule.label ?? '',
    allActions: rule.actions === '*',
    actions: Array.isArray(rule.actions) ? [...rule.actions] : [],
    result: rule.result ?? 'review',
    pagePaths: (t.pagePaths ?? []).join(', '),
    pageTemplates: (t.pageTemplates ?? []).join(', '),
    siteParts: [...(t.siteParts ?? [])],
    maxSections: s(l.maxSections),
    maxWords: s(l.maxWords),
    maxNewPages: s(l.maxNewPages),
    maxPerHour: s(l.maxPerHour),
    withinHours: s(l.withinHours),
    allowNewLinks: !!l.allowNewLinks,
    allowedLinkDomains: (l.allowedLinkDomains ?? []).join(', '),
    allowMoneyPages: !!l.allowMoneyPages,
  }
}

/** The rule object the API takes. Empty fields are left out so the defaults apply. */
export function ruleFromDraft(d: RuleDraft): Record<string, unknown> {
  const targets: Record<string, unknown> = {}
  if (list(d.pagePaths).length) targets.pagePaths = list(d.pagePaths)
  if (list(d.pageTemplates).length) targets.pageTemplates = list(d.pageTemplates)
  if (d.siteParts.length) targets.siteParts = d.siteParts
  const limits: Record<string, unknown> = {}
  for (const [key, value] of [['maxSections', num(d.maxSections)], ['maxWords', num(d.maxWords)], ['maxNewPages', num(d.maxNewPages)], ['maxPerHour', num(d.maxPerHour)], ['withinHours', num(d.withinHours)]] as const) if (value !== undefined) limits[key] = value
  if (d.allowNewLinks) limits.allowNewLinks = true
  if (list(d.allowedLinkDomains).length) limits.allowedLinkDomains = list(d.allowedLinkDomains)
  if (d.allowMoneyPages) limits.allowMoneyPages = true
  return { ...(d.id ? { id: d.id } : {}), label: d.label.trim(), actions: d.allActions ? '*' : d.actions, targets, result: d.result, limits }
}

/** One sentence a person can check, for a rule. */
export function describeRule(rule: AgentRule, actionLabels: Record<string, string> = {}): string {
  const what = rule.actions === '*' ? 'any kind of change' : rule.actions.map((a) => actionLabels[a]?.split(' (')[0]?.toLowerCase() ?? a).join(', ')
  const t = rule.targets
  const where = [t.pagePaths?.length ? `pages ${t.pagePaths.join(', ')}` : '', t.pageTemplates?.length ? `page types ${t.pageTemplates.join(', ')}` : '', t.siteParts?.length ? t.siteParts.join(', ') : ''].filter(Boolean).join(' and ') || 'anywhere'
  const l = rule.limits
  const caps = [l.maxSections !== undefined ? `up to ${l.maxSections} sections` : '', l.maxWords !== undefined ? `up to ${l.maxWords} words` : '', l.maxNewPages !== undefined ? `up to ${l.maxNewPages} new pages` : '', l.maxPerHour !== undefined ? `${l.maxPerHour} an hour` : '', l.withinHours !== undefined ? `within ${l.withinHours} hours` : '', l.allowNewLinks ? 'new links allowed' : ''].filter(Boolean).join(', ')
  const verb = rule.result === 'publish' ? 'May publish by itself' : rule.result === 'deny' ? 'Refused' : 'Needs a person'
  return `${verb}: ${what} on ${where}${caps ? ` (${caps})` : ''}.`
}

export function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'
}

/** Plain words for an audit action. Unknown actions are shown as they are. */
export const AUDIT_LABELS: Record<string, string> = {
  'agent.token.created': 'Token made',
  'agent.token.updated': 'Token changed',
  'agent.token.revoked': 'Token revoked',
  'agent.token.always_allow_on': 'Always-allow switched on',
  'agent.token.always_allow_off': 'Always-allow switched off',
  'agent.token.auto_paused': 'Token paused automatically',
  'agent.paused_all': 'All agents paused',
  'agent.resumed_all': 'All agents resumed',
  'agent.change.created': 'Agent started a change',
  'agent.call.blocked': 'Blocked attempt',
  'agent.change.edited': 'Agent made a draft',
  'agent.change.published': 'Agent published',
  'agent.change.review_requested': 'Agent asked for approval',
  'agent.change.discarded': 'Agent discarded a draft',
  'agent.change.undone': 'Change undone',
  'agent.webhook.updated': 'Alert settings changed',
  'agent.webhook.test': 'Test alert sent',
  'review.approved_by_rule': 'Approved by a rule',
  'review.approved_admin_undo': 'Undo approved by an admin',
}

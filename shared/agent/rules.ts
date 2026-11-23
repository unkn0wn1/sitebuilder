// Agent permission rules: the pure decision function behind "may this change go live by itself?".
// No database, no clock, no network: facts in, decision out. See ADR 0018 and docs/agent-gateway.md#rules.
//
// The order of the decision is fixed and is the contract the docs promise:
//   1. A matching deny rule stops the change.            (deny beats everything)
//   2. The floor: some facts force a human review.       (never auto-publishes, even with always-allow)
//      custom_css is set when CSS text was added, changed, cleared, or removed
//      with the section that held it. A section with no custom CSS is not that flag.
//   3. The action edit_css always needs a person.        (before always-allow and publish rules, including "*")
//   4. Always-allow, if switched on and not expired.     (publishes, no rule needed)
//   5. Every action in every part needs a publish rule whose limits hold. Anything else goes to review.
import { z } from 'zod'
import { SITE_PART_KINDS, type SitePartKind } from '../site-parts'

export const AGENT_ACTIONS = ['edit_text', 'remove_link', 'add_link', 'edit_sections', 'edit_css', 'edit_page_details', 'create_page', 'edit_menu', 'edit_banner', 'edit_footer', 'edit_header', 'undo_change'] as const
export type AgentAction = (typeof AGENT_ACTIONS)[number]

/** Plain words for each action, shown to the owner and to the AI (docs, rule errors, `get_site`). */
export const ACTION_LABELS: Record<AgentAction, string> = {
  edit_text: 'Change words in existing text (no links added or removed, no sections added or removed)',
  remove_link: 'Take links out (the words stay, or the button or menu item goes)',
  add_link: 'Add a link, or point an existing link somewhere new',
  edit_sections: 'Add, remove, move or change sections (anything beyond plain text)',
  edit_css: 'Change custom CSS on a section. Always needs a person.',
  edit_page_details: 'Change a page title, address or search settings',
  create_page: 'Create a new page',
  edit_menu: 'Add, remove or rename menu items',
  edit_banner: 'Change the site-wide banner',
  edit_footer: 'Change the footer: its words, contact details, social links, tagline, layout, links menu, legal menu and charity number (not its colours or logo)',
  edit_header: 'Change the header: the small utility link, whether it sits see-through over the hero, and the heart on the existing Donate button (not that button\'s words or target, and not colours or the logo)',
  undo_change: 'Undo a change this token made earlier',
}

/** Sections an agent may never add, change, move or remove, even as a draft. They hold donation forms. */
export const NEVER_BLOCK_TYPES = ['DonationEmbed', 'Embed'] as const
/** Props that bind a section to a form, an embed, a data source, or badge HTML. Agents may not set or change them. */
export const NEVER_PROP_KEYS = ['embed', 'source', 'campaignId', 'badgeHtml'] as const
/** Sections that show or ask for money. Agents may draft changes to them, but they never publish without a person. */
export const MONEY_BLOCK_TYPES = ['ImpactTiers', 'DonationProgress', 'MatchBanner', 'MatchThermometer'] as const

export const isNeverBlockType = (type: string) => (NEVER_BLOCK_TYPES as readonly string[]).includes(type)
export const isMoneyBlockType = (type: string) => (MONEY_BLOCK_TYPES as readonly string[]).includes(type)

export const RULE_RESULTS = ['publish', 'review', 'deny'] as const
export type RuleResult = (typeof RULE_RESULTS)[number]

const globs = z
  .array(z.string().trim().min(1).max(200).regex(/^\/[A-Za-z0-9\-._~/]*\*?$/, { message: 'Start with / and end with * for "everything under", for example /legal/*.' }))
  .max(50)

export const ruleTargetsSchema = z
  .object({
    pageTemplates: z.array(z.string().trim().min(1).max(60)).max(50).optional().meta({ description: 'Page type keys (for example "standard" or "legal"). Leave out for any page type.' }),
    pagePaths: globs.optional().meta({ description: 'Page addresses. "/privacy" matches that page. "/legal/*" matches everything under /legal. Leave out for any address.' }),
    siteParts: z.array(z.enum(SITE_PART_KINDS)).max(4).optional().meta({ description: 'Site-wide parts: header, footer, menu, banner.' }),
  })
  .strict()

export const ruleLimitsSchema = z
  .object({
    maxSections: z.number().int().min(0).max(100).optional().meta({ description: 'Most sections (or site parts) one change may touch.' }),
    maxWords: z.number().int().min(0).max(100000).optional().meta({ description: 'Most words one change may add or remove.' }),
    allowNewLinks: z.boolean().optional().meta({ description: 'Default false: a change that adds a link goes to review. Set true to allow links to be added.' }),
    allowedLinkDomains: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(50).optional().meta({ description: 'If set, new links must go to one of these domains (or to this site).' }),
    maxPerHour: z.number().int().min(1).max(1000).optional().meta({ description: 'Most auto-publishes under this rule per hour (counted per token).' }),
    allowMoneyPages: z.boolean().optional().meta({ description: 'Default false: a page that holds money sections never auto-publishes under this rule.' }),
    maxNewPages: z.number().int().min(1).max(12).optional().meta({ description: 'Most new pages one change may create and still publish by itself under this rule. Default 1, so building several pages at once always goes to a person unless a rule says otherwise.' }),
    withinHours: z.number().int().min(1).max(24 * 365).optional().meta({ description: 'For undo_change: only within this many hours of the original change.' }),
  })
  .strict()

export const agentRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
    label: z.string().trim().min(1).max(80),
    actions: z.union([z.literal('*'), z.array(z.enum(AGENT_ACTIONS)).min(1)]),
    targets: ruleTargetsSchema.default({}),
    result: z.enum(RULE_RESULTS),
    limits: ruleLimitsSchema.default({}),
  })
  .strict()

export type AgentRule = z.infer<typeof agentRuleSchema> & { id: string }
export type AgentRuleInput = z.input<typeof agentRuleSchema>

/** Validate and number a list of rules. Ids are kept if given, otherwise r1, r2, ... */
export function normaliseRules(input: unknown): { ok: true; rules: AgentRule[] } | { ok: false; message: string } {
  const parsed = z.array(agentRuleSchema).max(50).safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid rules.' }
  const seen = new Set<string>()
  const rules = parsed.data.map((r, i) => ({ ...r, id: r.id ?? `r${i + 1}` }))
  for (const r of rules) {
    if (seen.has(r.id)) return { ok: false, message: `Two rules share the id "${r.id}".` }
    seen.add(r.id)
  }
  return { ok: true, rules }
}

export type PartTarget =
  | { type: 'page'; id: string; path: string; template: string; label: string; holdsMoney: boolean }
  | { type: 'site_part'; id: string; partKind: SitePartKind; label: string }

export type FloorFlag = 'money_section_touched' | 'foreign_draft' | 'checks_failing' | 'custom_css'

/** Same sentence for the edit_css action and the custom_css floor flag. */
const CSS_REVIEW_REASON = 'Custom CSS always needs a person to review it.'

export const FLOOR_MESSAGES: Record<FloorFlag, string> = {
  money_section_touched: 'It touches a money section (gift amounts, progress, match or countdown). Those always need a person.',
  foreign_draft: 'The page or part has unpublished changes that are not from this change (a person is working on it, it has never been published, or it changed since the agent edited it). Publishing would publish that too.',
  checks_failing: 'The checks that every submission must pass are failing.',
  custom_css: CSS_REVIEW_REASON,
}

export interface PartStats {
  sectionsTouched: number
  wordsChanged: number
  linksAdded: number
  linksRemoved: number
  /** Where added links go: a domain, "(this site)", "mailto" or "tel". */
  newLinkDomains: string[]
}

export interface PartFacts {
  target: PartTarget
  actions: AgentAction[]
  stats: PartStats
  floor: FloorFlag[]
  /** For undo_change: hours since the change being undone was published. */
  changeAgeHours?: number
}

export interface DecideInput {
  rules: AgentRule[]
  /** True only when always-allow is switched on and has not expired. */
  alwaysAllow: boolean
  /** Auto-publishes by this token in the last hour, per rule id (for maxPerHour). */
  publishesLastHourByRule: Record<string, number>
}

export interface PartDecision {
  target: PartTarget
  outcome: RuleResult
  reasons: string[]
  ruleIds: string[]
}

export interface ChangeDecision {
  outcome: RuleResult
  parts: PartDecision[]
  /** Short sentences for the AI and the owner. */
  reasons: string[]
  /** Rules (by id) that allowed the publish, for the audit log. */
  ruleIds: string[]
  viaAlwaysAllow: boolean
}

export function globMatches(glob: string, path: string): boolean {
  if (glob.endsWith('*')) return path.startsWith(glob.slice(0, -1))
  return path === glob
}

export function ruleCoversAction(rule: Pick<AgentRule, 'actions'>, action: AgentAction): boolean {
  return rule.actions === '*' || rule.actions.includes(action)
}

export function ruleMatchesTarget(rule: Pick<AgentRule, 'targets'>, target: PartTarget): boolean {
  const { pageTemplates, pagePaths, siteParts } = rule.targets
  const hasPage = !!(pageTemplates?.length || pagePaths?.length)
  const hasPart = !!siteParts?.length
  if (!hasPage && !hasPart) return true
  if (target.type === 'page') {
    if (!hasPage) return false
    if (pageTemplates?.length && !pageTemplates.includes(target.template)) return false
    if (pagePaths?.length && !pagePaths.some((g) => globMatches(g, target.path))) return false
    return true
  }
  return hasPart && !!siteParts?.includes(target.partKind)
}

const targetName = (t: PartTarget) => (t.type === 'page' ? `the page "${t.label}" (${t.path})` : `the ${t.partKind}`)

/** Why a publish rule's limits do not hold for these facts. Empty when they hold. */
export function limitProblems(rule: AgentRule, part: PartFacts, publishesLastHour: number, pagesCreated = 0): string[] {
  const l = rule.limits
  const out: string[] = []
  if (l.maxSections !== undefined && part.stats.sectionsTouched > l.maxSections) out.push(`touches ${part.stats.sectionsTouched} sections, over the limit of ${l.maxSections}`)
  if (l.maxWords !== undefined && part.stats.wordsChanged > l.maxWords) out.push(`changes ${part.stats.wordsChanged} words, over the limit of ${l.maxWords}`)
  if (part.stats.linksAdded > 0 && !l.allowNewLinks) out.push('adds a link (rule does not allow new links)')
  if (part.stats.linksAdded > 0 && l.allowNewLinks && l.allowedLinkDomains?.length) {
    const bad = part.stats.newLinkDomains.filter((d) => d !== '(this site)' && !l.allowedLinkDomains!.some((a) => d === a || d.endsWith(`.${a}`)))
    if (bad.length) out.push(`links to ${bad.join(', ')}, which is not an allowed domain`)
  }
  if (part.actions.includes('create_page') && pagesCreated > (l.maxNewPages ?? 1)) out.push(`creates ${pagesCreated} new pages, over the limit of ${l.maxNewPages ?? 1} new page${(l.maxNewPages ?? 1) === 1 ? '' : 's'} in one change`)
  if (part.target.type === 'page' && part.target.holdsMoney && !l.allowMoneyPages) out.push('the page holds money sections')
  if (l.maxPerHour !== undefined && publishesLastHour >= l.maxPerHour) out.push(`the limit of ${l.maxPerHour} auto-publishes an hour has been reached`)
  if (part.changeAgeHours !== undefined && l.withinHours !== undefined && part.changeAgeHours > l.withinHours) out.push(`the change is older than ${l.withinHours} hours`)
  return out
}

function decidePart(part: PartFacts, input: DecideInput & { pagesCreated: number }): PartDecision {
  const name = targetName(part.target)
  const matching = (action: AgentAction) => input.rules.filter((r) => ruleCoversAction(r, action) && ruleMatchesTarget(r, part.target))

  const denied = part.actions.flatMap((a) => matching(a).filter((r) => r.result === 'deny').map((r) => ({ a, r })))
  if (denied.length) {
    const first = denied[0]!
    return { target: part.target, outcome: 'deny', reasons: [`Rule "${first.r.label}" does not allow "${first.a}" on ${name}.`], ruleIds: [...new Set(denied.map((d) => d.r.id))] }
  }

  if (part.floor.length) {
    return { target: part.target, outcome: 'review', reasons: part.floor.map((f) => `${FLOOR_MESSAGES[f]} (${name})`), ruleIds: [] }
  }

  // After deny and the floor, before always-allow and publish rules. A deny rule already returned.
  // A publish rule and always-allow cannot auto-publish this, including actions "*".
  if (part.actions.includes('edit_css')) {
    return { target: part.target, outcome: 'review', reasons: [CSS_REVIEW_REASON], ruleIds: [] }
  }

  if (!part.actions.length) return { target: part.target, outcome: 'review', reasons: [`Nothing in ${name} has changed.`], ruleIds: [] }

  const multiBuild = part.actions.includes('create_page') && input.pagesCreated > 1
  if (input.alwaysAllow && !multiBuild) {
    return { target: part.target, outcome: 'publish', reasons: [`Always-allow is on, and ${name} is not on the never-list.`], ruleIds: [] }
  }

  const reasons: string[] = []
  const ruleIds = new Set<string>()
  for (const action of part.actions) {
    const publishRules = matching(action).filter((r) => r.result === 'publish')
    if (!publishRules.length) {
      reasons.push(multiBuild && action === 'create_page' && input.alwaysAllow ? `This change creates ${input.pagesCreated} new pages. Building several pages at once needs a person unless a rule with a high enough "maxNewPages" covers it. Always-allow does not.` : `No rule lets this token publish "${action}" on ${name} by itself.`)
      continue
    }
    const attempts = publishRules.map((r) => ({ r, problems: limitProblems(r, part, input.publishesLastHourByRule[r.id] ?? 0, input.pagesCreated) }))
    const ok = attempts.find((x) => x.problems.length === 0)
    if (ok) ruleIds.add(ok.r.id)
    else reasons.push(`Rule "${attempts[0]!.r.label}" covers "${action}" on ${name}, but this change ${attempts[0]!.problems.join(' and ')}.`)
  }
  if (reasons.length) return { target: part.target, outcome: 'review', reasons, ruleIds: [] }
  return { target: part.target, outcome: 'publish', reasons: [`Allowed by ${[...ruleIds].map((id) => `rule "${input.rules.find((r) => r.id === id)?.label ?? id}"`).join(', ')}.`], ruleIds: [...ruleIds] }
}

/** Decide a whole change. One part that is not allowed sends the whole change to review: no partial publishing. */
export function decideChange(parts: PartFacts[], input: DecideInput): ChangeDecision {
  const pagesCreated = parts.filter((p) => p.actions.includes('create_page')).length
  const decisions = parts.map((p) => decidePart(p, { ...input, pagesCreated }))
  const deny = decisions.find((d) => d.outcome === 'deny')
  const review = decisions.filter((d) => d.outcome === 'review')
  const outcome: RuleResult = deny ? 'deny' : review.length || decisions.length === 0 ? 'review' : 'publish'
  const reasons = deny ? deny.reasons : review.length ? review.flatMap((d) => d.reasons) : decisions.length === 0 ? ['The change has no parts yet.'] : decisions.flatMap((d) => d.reasons)
  const viaAlwaysAllow = outcome === 'publish' && input.alwaysAllow && decisions.every((d) => d.ruleIds.length === 0)
  return { outcome, parts: decisions, reasons: [...new Set(reasons)], ruleIds: [...new Set(decisions.flatMap((d) => d.ruleIds))], viaAlwaysAllow }
}

/** Can this action be staged at all? A deny rule stops it before any draft is written. */
export function stagingDenial(rules: AgentRule[], action: AgentAction, target: PartTarget): AgentRule | null {
  return rules.find((r) => r.result === 'deny' && ruleCoversAction(r, action) && ruleMatchesTarget(r, target)) ?? null
}

export const alwaysAllowSchema = z.object({ until: z.iso.datetime() }).strict()
export const ALWAYS_ALLOW_MAX_DAYS = 7

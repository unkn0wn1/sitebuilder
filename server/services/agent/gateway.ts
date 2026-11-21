// The agent gateway's service layer: what each operation actually does. REST routes and MCP tools both call these
// functions (through operations.ts), so the two doors cannot behave differently. See ADR 0018.
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { NEVER_BLOCK_TYPES, NEVER_PROP_KEYS, ACTION_LABELS, isMoneyBlockType, isNeverBlockType, type AgentAction } from '../../../shared/agent/rules'
import {
  domainOfHref,
  findLinks,
  getAt,
  hrefMatches,
  insertRichText,
  isRichTextValue,
  markdownToRichText,
  pathString,
  previewProps,
  removeLinks,
  replaceLinks,
  replaceText,
  richTextToMarkdown,
  searchText,
  type LinkHit,
  type Path,
} from '../../../shared/agent/content'
import { listBlockAiSummaries } from '../../../shared/ai/block-guide'
import { newId } from '../../../shared/ids'
import { blockUsesMockData } from '../../../shared/data-sources'
import type { InternalOp } from '../../../shared/ops'
import type { PageDoc } from '../../../shared/page'
import { isSafeHref } from '../../../shared/richtext'
import type { FieldIssue } from '../../../shared/issues'
import { validateSitePartDoc, type MenuDoc, type SitePartDoc, type SitePartKind, type BannerDoc, type FooterDoc } from '../../../shared/site-parts'
import { agentChanges, pages, sites, siteParts } from '../../db/schema'
import type { ServiceCtx } from '../context'
import { AppError, notFound } from '../errors'
import { createPage, getPage, listPages, readDoc, requirePage } from '../pages'
import { getTemplateRules, listTemplates } from '../templates'
import { getSitePart, readSitePartDoc } from '../site-parts'
import {
  changeTargets,
  discardChange,
  evaluateChange,
  refreshChange,
  requireOwnChange,
  runInChange,
  sendChange,
  undoChange,
  listChanges,
  type ChangeEvaluation,
  type ChangeHandle,
  type ChangeRow,
} from './changes'
import { DEFAULT_LIMITS, alwaysAllowActive, alwaysAllowView, effectiveLimits, tokenRules, type SignedInAgent } from './tokens'

type In<S extends z.ZodType> = z.infer<S>
import type * as S from './schemas'

const GATEWAY_VERSION = '1'

// ---------------------------------------------------------------------------------------------------------------------
// Shared helpers

const NEVER_PROP_SET = new Set<string>(NEVER_PROP_KEYS)

function neverList(message: string): AppError {
  return new AppError('never_list', `${message} Agents can never do this. Tell the person it needs doing by hand in the builder.`)
}

function checkBlockType(type: string) {
  if (isNeverBlockType(type)) throw neverList(`"${type}" sections hold donation forms and embeds.`)
}

function checkProps(props: Record<string, unknown>, unset: string[] = []) {
  for (const key of [...Object.keys(props), ...unset]) {
    if (NEVER_PROP_SET.has(key)) throw neverList(`The prop "${key}" binds a section to a form, an embed or a data source.`)
  }
}

const accessOf = (type: string) => (isNeverBlockType(type) ? 'never' : isMoneyBlockType(type) ? 'draft_only' : 'ok')

function origin(ctx: ServiceCtx): string | null {
  const domain = ctx.db.select({ d: sites.primaryDomain }).from(sites).where(eq(sites.id, ctx.siteId)).get()?.d
  return domain ? `https://${domain}` : null
}

function resolvePage(ctx: ServiceCtx, ref: { page_id?: string; path?: string }) {
  if (ref.page_id) return requirePage(ctx, ref.page_id)
  if (ref.path) {
    const path = ref.path.length > 1 ? ref.path.replace(/\/+$/, '') : ref.path
    const row = ctx.db.select().from(pages).where(and(eq(pages.siteId, ctx.siteId), eq(pages.path, path), isNull(pages.deletedAt))).get()
    if (!row) throw new AppError('not_found', `No page has the address ${ref.path}. Use list_pages or search_content to find the right one.`)
    return row
  }
  throw new AppError('validation_failed', 'Give page_id or path.', [{ path: 'page_id', message: 'Give page_id or path.' }])
}

function allPages(ctx: ServiceCtx) {
  return ctx.db.select().from(pages).where(and(eq(pages.siteId, ctx.siteId), isNull(pages.deletedAt))).all()
}

function allParts(ctx: ServiceCtx) {
  return ctx.db.select().from(siteParts).where(eq(siteParts.siteId, ctx.siteId)).all()
}

function findPart(ctx: ServiceCtx, kind: SitePartKind, key?: string) {
  const parts = allParts(ctx).filter((p) => p.kind === kind && (!key || p.key === key))
  const part = parts.sort((a, b) => (a.key === 'main' ? -1 : b.key === 'main' ? 1 : a.key.localeCompare(b.key)))[0]
  if (!part) {
    const any = allParts(ctx).some((p) => p.kind === kind)
    if (!any) throw new AppError('not_found', `This site has no ${kind} at all yet. Agents cannot create one. Tell the person an admin must add a ${kind} in Site parts first.`)
    throw new AppError('not_found', `This site has no ${kind} called "${key}". Use get_site_part with kind "${kind}" without a key for the main one.`)
  }
  return part
}

const linkSummary = (h: LinkHit, ctx: ServiceCtx, pathOf: Map<string, string>) => ({
  kind: h.kind,
  href: h.pageId ? (pathOf.get(h.pageId) ?? h.href) : h.href,
  page_id: h.pageId ?? null,
  label: h.label,
  where: pathString(h.path),
  domain: domainOfHref(h.pageId ? (pathOf.get(h.pageId) ?? '/') : h.href, origin(ctx)),
  removable: h.removal.type !== 'unremovable',
  ...(h.removal.type === 'unremovable' ? { why_not_removable: h.removal.reason } : {}),
})

function pathMap(ctx: ServiceCtx): Map<string, string> {
  return new Map(allPages(ctx).map((p) => [p.id, p.path]))
}

// ---------------------------------------------------------------------------------------------------------------------
// Change views

function nextSteps(row: ChangeRow, ev: ChangeEvaluation | null): string[] {
  const id = row.id
  if (row.status === 'open') {
    if (!ev || !ev.targets.length) return ['This change has no edits yet. Make an edit with one of the edit tools, passing change_id so it lands here.']
    if (ev.blocking.length) return [`Fix these problems first: ${ev.blocking.slice(0, 3).map((b) => b.message).join(' | ')}. Then call preview_change again.`, `Or call discard_change with change_id "${id}" to throw it away.`]
    if (ev.targets.every((t) => t.unchanged)) return [`Nothing differs from what is live. Call discard_change with change_id "${id}" to close it.`]
    const o = ev.decision.outcome
    if (o === 'deny') return [`A rule refuses this change: ${ev.decision.reasons[0]}. Call discard_change with change_id "${id}" and tell the person.`]
    if (o === 'publish') return [`Show the person what will change (preview_change). If they agree, call publish_change with change_id "${id}": a rule on this token lets it go live now (${ev.decision.reasons[0]}).`, `Or call request_publish with change_id "${id}" to ask a person to approve it instead.`]
    return [`publish_change would NOT make this live: ${ev.decision.reasons[0]}`, `Call request_publish with change_id "${id}" to send it to a person for approval, and tell the person it is waiting.`, 'Or keep editing (pass change_id) or call discard_change.']
  }
  if (row.status === 'review') return ['Waiting for a person to approve it in the builder. Nothing is live yet. Tell the person. Call get_change later to see whether it was approved.']
  if (row.status === 'publishing') return ['Going live now (usually within a few seconds). Call get_change to confirm the status is "published".']
  if (row.status === 'published') return [`It is live. To take it back, call undo_change with change_id "${id}".`]
  if (row.status === 'failed') return ['Publishing failed. A person can retry in the builder. Tell the person and give them the change id.']
  if (row.status === 'undone') return ['This change was undone. The site is back to how it was before it.']
  return []
}

const OUTCOME_LABEL = { publish: 'goes_live', review: 'goes_to_review', deny: 'refused' } as const

/** Where a person can see the draft pages of a change, rendered, in the builder. Needs their builder sign-in. */
export function previewLink(row: Pick<ChangeRow, 'id' | 'status'>) {
  if (row.status === 'discarded') return {}
  const path = `/settings/agents/changes/${row.id}`
  const origin = (process.env.SITEBUILDER_ORIGIN ?? '').replace(/\/+$/, '')
  return { draft_preview_path: path, ...(origin ? { draft_preview_url: `${origin}${path}` } : {}), draft_preview_note: 'Give this link to the person. It shows the changed pages as they will look, the differences, and an Undo button. It needs their builder sign-in; you cannot open it.' }
}

/** The agent-facing picture of a change. Open changes include what publish_change would do right now. */
export function changeView(ctx: ServiceCtx, agent: SignedInAgent, row0: ChangeRow, evaluation?: ChangeEvaluation) {
  const row = refreshChange(ctx, row0)
  const ev = evaluation ?? (row.status === 'open' && changeTargets(row).length ? evaluateChange(ctx, agent, row) : null)
  const stored = row.decision as { outcome?: string; reasons?: string[]; ruleIds?: string[]; viaAlwaysAllow?: boolean; feedback?: string; failure?: string } | null
  return {
    change: {
      id: row.id,
      title: row.title,
      status: row.status,
      reason: row.reason,
      created_at: row.createdAt,
      applied_at: row.appliedAt,
      published_at: row.publishedAt,
      undo_of: row.undoOf,
      ...previewLink(row),
      targets: (ev?.targets ?? changeTargets(row).map((t) => ({ target: t, summary: '', textChanges: [], facts: null, blocks: undefined, unchanged: false, blocking: [], warnings: [] }))).map((t) => ({
        type: t.target.type,
        id: t.target.id,
        label: t.target.label,
        path: t.target.path ?? null,
        actions: t.target.actions,
        review_id: t.target.reviewId ?? null,
        ...(ev ? { summary: t.summary, unchanged: t.unchanged, stats: t.facts?.stats, text_changes: t.textChanges, section_changes: t.blocks, warnings: t.warnings.map((w) => w.message) } : {}),
      })),
    },
    ...(ev
      ? {
          if_you_publish: {
            outcome: OUTCOME_LABEL[ev.decision.outcome],
            reasons: ev.decision.reasons,
            rules_that_allow: ev.decision.ruleIds,
            always_allow: ev.decision.viaAlwaysAllow,
          },
          problems_to_fix: ev.blocking.map((b) => ({ where: b.path, message: b.message })),
        }
      : {}),
    ...(stored && row.status !== 'open' ? { decision: { outcome: stored.outcome, reasons: stored.reasons, rules: stored.ruleIds, always_allow: stored.viaAlwaysAllow, ...(stored.failure ? { failure: stored.failure } : {}) } } : {}),
    ...(row.status === 'open' && stored?.feedback ? { feedback_from_reviewer: stored.feedback } : {}),
    next_steps: nextSteps(row, ev),
  }
}

/**
 * What an edit tool returns: the change in brief (one line per page or part), not the whole diff again, so a long
 * build does not repeat every earlier edit in every reply (Spencer, 21 Nov 2026). get_change and preview_change show
 * the full diff. `result` (added by each tool) says what this call did.
 */
export function editView(ctx: ServiceCtx, agent: SignedInAgent, row: ChangeRow) {
  const full = changeView(ctx, agent, row)
  const c = full.change
  const { draft_preview_note: _note, ...link } = previewLink(row) as Record<string, string>
  return {
    change: {
      id: c.id,
      title: c.title,
      status: c.status,
      ...link,
      targets: c.targets.map((t) => ({ type: t.type, id: t.id, label: t.label, path: t.path, actions: t.actions, ...('summary' in t ? { summary: t.summary, ...(t.warnings?.length ? { warnings: t.warnings } : {}) } : {}) })),
      full_diff: 'Call get_change or preview_change to see exactly what differs from the live site.',
    },
    ...(full.if_you_publish ? { if_you_publish: { outcome: full.if_you_publish.outcome, reasons: full.if_you_publish.reasons, always_allow: full.if_you_publish.always_allow } } : {}),
    ...(full.problems_to_fix?.length ? { problems_to_fix: full.problems_to_fix } : {}),
    next_steps: full.next_steps,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Read

export function getSite(ctx: ServiceCtx, agent: SignedInAgent) {
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const token = agent.token
  const rules = tokenRules(token)
  const always = alwaysAllowActive(token, ctx.now())
  return {
    site: { name: site.name, primary_domain: site.primaryDomain, default_locale: site.defaultLocale },
    you: {
      token_name: token.name,
      access: token.access,
      access_meaning: token.access === 'draft' ? 'You can read everything and make draft changes. Whether a change goes live is decided by the rules below.' : 'You can read only. You cannot change anything.',
      acting_for_user_id: agent.actor.id,
      expires_at: token.expiresAt,
      always_allow: alwaysAllowView(token, ctx.now()),
      always_allow_meaning: always
        ? alwaysAllowView(token, ctx.now())!.permanent
          ? 'Always-allow is ON with no end date. A change that no rule covers can still go live by itself. It never covers the never-list or the floor, and a deny rule still wins.'
          : 'Always-allow is ON until the time given. A change that no rule covers can still go live by itself until then. It never covers the never-list or the floor, and a deny rule still wins.'
        : 'Always-allow is off. Only a "publish" rule lets a change go live by itself.',
      rules: rules.map((r) => ({ id: r.id, label: r.label, result: r.result, actions: r.actions, targets: r.targets, limits: r.limits })),
      can_publish_by_yourself: always || rules.some((r) => r.result === 'publish'),
      rate_limits: effectiveLimits(token),
    },
    never_list: {
      meaning: 'Things no agent can do, whatever the token says. If asked, tell the person it has to be done by hand in the builder.',
      sections_that_cannot_be_touched: [...NEVER_BLOCK_TYPES],
      props_that_cannot_be_set: [...NEVER_PROP_KEYS],
      sections_that_never_publish_without_a_person: ['ImpactTiers', 'DonationProgress', 'MatchBanner', 'MatchThermometer'],
      also: ['Theme, colours, fonts, logo', 'Site settings, users, tokens, secrets', 'Raw HTML, CSS, scripts, tracking', 'Pages that show mock data can never go live'],
    },
    actions: Object.fromEntries((Object.keys(ACTION_LABELS) as AgentAction[]).map((a) => [a, ACTION_LABELS[a]])),
    default_rate_limits: DEFAULT_LIMITS,
    gateway_version: GATEWAY_VERSION,
    start_here: 'Read the sitebuilder://guide/overview resource, or use a prompt such as take_link_down. The usual order is: search_content or find_links, an edit tool, preview_change, then publish_change or request_publish.',
  }
}

export function listPagesFor(ctx: ServiceCtx, input: In<typeof S.listPagesInput>) {
  const r = listPages(ctx, { search: input.query, state: input.state, template: input.page_type, page: input.page, pageSize: input.page_size })
  return {
    pages: r.items.map((p) => ({ page_id: p.id, title: p.title, path: p.path, page_type: p.template, state: p.state, has_unpublished_changes: p.hasUnpublishedChanges, updated_at: p.updatedAt })),
    page: r.page,
    page_size: r.pageSize,
    total: r.total,
    has_more: r.page * r.pageSize < r.total,
  }
}

export function getPageFor(ctx: ServiceCtx, input: In<typeof S.getPageInput>) {
  const row = resolvePage(ctx, input)
  const { page, doc, revision, review, template } = getPage(ctx, row.id)
  const paths = pathMap(ctx)
  const blocks = doc.blocks.map((b, i) => {
    const richText: { prop: string; markdown: string }[] = []
    for (const [prop, value] of Object.entries(b.props)) if (isRichTextValue(value)) richText.push({ prop, markdown: richTextToMarkdown(value) })
    return {
      block_id: b.id,
      index: i,
      type: b.type,
      label: ctx.registry.get(b.type)?.label ?? b.type,
      agent_access: accessOf(b.type),
      uses_mock_data: blockUsesMockData(b),
      preview: previewProps(b.props),
      props: b.props,
      rich_text: richText,
      links: findLinks(b.props, 'block').map((l) => linkSummary(l, ctx, paths)),
    }
  })
  return {
    page: {
      page_id: page.id,
      title: doc.title,
      path: page.path,
      page_type: page.template,
      state: page.workflowState,
      is_live: !!page.publishedVersionId,
      has_unpublished_changes: !!page.publishedVersionId && page.draftVersionId !== page.publishedVersionId,
      waiting_for_approval: !!review,
      draft_revision: revision,
      seo: doc.seo,
      allowed_section_types: template.rules?.allowedBlocks ? agentAllowed(template.rules.allowedBlocks) : null,
    },
    sections: blocks,
    note: 'These are the DRAFT contents (what edits will change). If has_unpublished_changes is true, the live page differs from this.',
  }
}

export function getSitePartFor(ctx: ServiceCtx, input: In<typeof S.getSitePartInput>) {
  const part = findPart(ctx, input.kind, input.key)
  const { doc, revision, review } = getSitePart(ctx, part.id)
  const paths = pathMap(ctx)
  return {
    part: { part_id: part.id, kind: part.kind, key: part.key, label: part.label, state: part.workflowState, is_live: !!part.publishedVersionId, waiting_for_approval: !!review, draft_revision: revision },
    document: doc,
    links: findLinks(doc, 'sitepart').map((l) => linkSummary(l, ctx, paths)),
  }
}

export function listComponents(ctx: ServiceCtx) {
  const guides = new Map(listBlockAiSummaries().map((g) => [g.type, g]))
  return {
    components: ctx.registry.list().map((def) => {
      const g = guides.get(def.type)
      return {
        type: def.type,
        label: def.label,
        category: def.category,
        agent_access: accessOf(def.type),
        agent_access_meaning: { ok: 'You may add, edit, move and remove it.', draft_only: 'You may draft changes, but a person must approve them: it shows or asks for money.', never: 'You cannot add, change, move or remove it: it holds a donation form or embed.' }[accessOf(def.type)],
        purpose: g?.purpose ?? null,
        use_when: g?.useWhen ?? null,
        avoid_when: g?.avoidWhen ?? null,
        pairs_with: g?.pairsWith ?? [],
        fields_guidance: g?.fields ?? null,
        good_example_props: g?.good.props ?? def.sample,
        props_schema: ctx.registry.jsonSchema(def.type),
      }
    }),
  }
}

export function listPageTypes(ctx: ServiceCtx) {
  return {
    page_types: listTemplates(ctx)
      .filter((t) => t.live)
      .map((t) => {
        const rules = getTemplateRules(ctx, t.key)
        const required = rules?.requiredBlocks ?? []
        const blocked = required.filter((b) => isNeverBlockType(b))
        return {
          key: t.key,
          label: t.label,
          allowed_section_types: agentAllowed(rules?.allowedBlocks ?? []),
          required_section_types: required,
          starting_sections: rules?.startingBlocks.map((b) => b.type) ?? [],
          ...(blocked.length ? { agent_can_create: false, agent_note: `This page type needs ${blocked.join(' and ')}, which agents can never add. Do not create pages of this type; use another type, or ask a person to make it in the builder.` } : { agent_can_create: true }),
        }
      }),
    note: 'Required section types are checked when a change is sent for review or published, not while you are drafting.',
  }
}

interface SearchHit {
  target: { type: 'page' | 'site_part'; id: string; label: string; path: string | null }
  where: string
  block_id: string | null
  block_type: string | null
  snippet: string
  in_live: boolean
}

export function searchContent(ctx: ServiceCtx, input: In<typeof S.searchContentInput>) {
  const hits: SearchHit[] = []
  const add = (h: SearchHit) => hits.push(h)
  for (const p of allPages(ctx)) {
    const draft = readDoc(ctx, p.draftVersionId!)
    const live = p.publishedVersionId ? readDoc(ctx, p.publishedVersionId) : null
    const liveHas = (where: string) => !!live && searchText(live.blocks, input.query).some((h) => pathString(h.path) === where)
    draft.blocks.forEach((b, i) => {
      for (const h of searchText(b.props, input.query)) {
        add({ target: { type: 'page', id: p.id, label: p.title, path: p.path }, where: `blocks.${i}.props.${pathString(h.path)}`, block_id: b.id, block_type: b.type, snippet: h.snippet, in_live: liveHas(`${i}.props.${pathString(h.path)}`) })
      }
    })
    const titleHit = searchText({ title: draft.title }, input.query)[0]
    if (titleHit) add({ target: { type: 'page', id: p.id, label: p.title, path: p.path }, where: 'title', block_id: null, block_type: null, snippet: titleHit.snippet, in_live: live?.title === draft.title })
    const descHit = draft.seo.description ? searchText({ description: draft.seo.description }, input.query)[0] : null
    if (descHit) add({ target: { type: 'page', id: p.id, label: p.title, path: p.path }, where: 'seo.description', block_id: null, block_type: null, snippet: descHit.snippet, in_live: live?.seo.description === draft.seo.description })
  }
  for (const part of allParts(ctx)) {
    const draft = readSitePartDoc(ctx, part)
    const live = part.publishedVersionId ? readSitePartDoc(ctx, part, part.publishedVersionId) : null
    for (const h of searchText(draft, input.query)) {
      add({ target: { type: 'site_part', id: part.id, label: part.label, path: null }, where: pathString(h.path), block_id: null, block_type: null, snippet: h.snippet, in_live: !!live && searchText(live, input.query).some((x) => pathString(x.path) === pathString(h.path)) })
    }
  }
  return { query: input.query, total: hits.length, truncated: hits.length > input.limit, results: hits.slice(0, input.limit), note: 'Searched the draft of every page and site part (what edits will change). in_live says whether the live site has it too.' }
}

interface LinkResult {
  target: { type: 'page' | 'site_part'; id: string; label: string; path: string | null }
  block_id: string | null
  block_type: string | null
  link: ReturnType<typeof linkSummary>
  in_live: boolean
}

function matchingLinks(ctx: ServiceCtx, url: string, match: 'exact' | 'prefix' | 'domain') {
  const org = origin(ctx)
  const paths = pathMap(ctx)
  const matches = (h: LinkHit) => hrefMatches(h.pageId ? (paths.get(h.pageId) ?? '') : h.href, url, match, org)
  return { matches, paths }
}

export function findLinksFor(ctx: ServiceCtx, input: In<typeof S.findLinksInput>) {
  const { matches, paths } = matchingLinks(ctx, input.url, input.match)
  const results: LinkResult[] = []
  for (const p of allPages(ctx)) {
    const draft = readDoc(ctx, p.draftVersionId!)
    const live = p.publishedVersionId ? readDoc(ctx, p.publishedVersionId) : null
    const liveKeys = new Set(live ? live.blocks.flatMap((b) => findLinks(b.props, 'block').filter(matches).map((l) => `${b.id}|${pathString(l.path)}|${l.href}`)) : [])
    for (const b of draft.blocks) {
      for (const l of findLinks(b.props, 'block').filter(matches)) {
        results.push({ target: { type: 'page', id: p.id, label: p.title, path: p.path }, block_id: b.id, block_type: b.type, link: linkSummary(l, ctx, paths), in_live: liveKeys.has(`${b.id}|${pathString(l.path)}|${l.href}`) })
      }
    }
  }
  for (const part of allParts(ctx)) {
    const draft = readSitePartDoc(ctx, part)
    const live = part.publishedVersionId ? readSitePartDoc(ctx, part, part.publishedVersionId) : null
    const liveKeys = new Set(live ? findLinks(live, 'sitepart').filter(matches).map((l) => `${pathString(l.path)}|${l.href}`) : [])
    for (const l of findLinks(draft, 'sitepart').filter(matches)) {
      results.push({ target: { type: 'site_part', id: part.id, label: part.label, path: null }, block_id: null, block_type: null, link: linkSummary(l, ctx, paths), in_live: liveKeys.has(`${pathString(l.path)}|${l.href}`) })
    }
  }
  const not = results.filter((r) => !r.link.removable).length
  return {
    url: input.url,
    match: input.match,
    total: results.length,
    truncated: results.length > input.limit,
    pages_affected: new Set(results.filter((r) => r.target.type === 'page').map((r) => r.target.id)).size,
    site_parts_affected: [...new Set(results.filter((r) => r.target.type === 'site_part').map((r) => r.target.label))],
    cannot_be_removed_on_their_own: not,
    results: results.slice(0, input.limit),
    note: 'Searched the draft of every page and site part. Pass total as expected_matches to remove_link. in_live says whether the live site has the link too.',
  }
}

export function listChangesFor(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.listChangesInput>) {
  return {
    changes: listChanges(ctx, agent, { status: input.status, limit: input.limit }).map((r) => ({ change_id: r.id, title: r.title, status: r.status, reason: r.reason, created_at: r.createdAt, published_at: r.publishedAt, targets: changeTargets(r).map((t) => ({ type: t.type, label: t.label, path: t.path ?? null })) })),
  }
}

export function getChangeFor(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.getChangeInput>) {
  return changeView(ctx, agent, requireOwnChange(ctx, agent, input.change_id))
}

// ---------------------------------------------------------------------------------------------------------------------
// Edits: text, links

interface Candidate {
  id: string
  label: string
  path: string | null
  blocked: string | null
}

function blockedReason(state: string, label: string): string | null {
  if (state === 'in_review') return `${label} is waiting for approval`
  if (state === 'approved') return `${label} is being published`
  return null
}

function candidates(ctx: ServiceCtx, input: { page_id?: string; path?: string; everywhere?: boolean }): { pages: (typeof pages.$inferSelect & { blocked: string | null })[]; parts: (typeof siteParts.$inferSelect & { blocked: string | null })[] } {
  if (!input.everywhere) {
    const p = resolvePage(ctx, input)
    return { pages: [{ ...p, blocked: blockedReason(p.workflowState, `"${p.title}"`) }], parts: [] }
  }
  return {
    pages: allPages(ctx).map((p) => ({ ...p, blocked: blockedReason(p.workflowState, `"${p.title}"`) })),
    parts: allParts(ctx).map((p) => ({ ...p, blocked: blockedReason(p.workflowState, `the ${p.label.toLowerCase()}`) })),
  }
}

function assertNotBlocked(items: { blocked: string | null }[], skip: boolean | undefined): string[] {
  const blocked = items.filter((i) => i.blocked).map((i) => i.blocked!)
  if (blocked.length && !skip) {
    throw new AppError('invalid_state', `Cannot edit while ${blocked.join('; ')}. Wait for those to finish, or pass skip_blocked: true to leave them out (they will be listed in "skipped").`, undefined, { blocked })
  }
  return blocked
}

function propsDiff(before: Record<string, unknown>, after: Record<string, unknown>): { props: Record<string, unknown>; unset: string[] } | null {
  const props: Record<string, unknown> = {}
  const unset: string[] = []
  for (const k of Object.keys(after)) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) props[k] = after[k]
  for (const k of Object.keys(before)) if (!(k in after)) unset.push(k)
  return Object.keys(props).length || unset.length ? { props, unset } : null
}

function updateOps(blocks: PageDoc['blocks'], next: PageDoc['blocks']): InternalOp[] {
  const ops: InternalOp[] = []
  blocks.forEach((b, i) => {
    const d = propsDiff(b.props, next[i]!.props)
    if (d) ops.push({ op: 'update_props', blockId: b.id, props: d.props, ...(d.unset.length ? { unset: d.unset } : {}) })
  })
  return ops
}

function checkExpected(found: number, expected: number | undefined, detail: unknown) {
  if (expected !== undefined && found !== expected) {
    throw new AppError('match_count_mismatch', `You expected ${expected} match${expected === 1 ? '' : 'es'} but there are ${found}. Nothing was changed. Look at "found", tell the person if it surprises you, then call again with expected_matches ${found} if that is right.`, undefined, { found: detail, actual: found })
  }
}

function blockIssues(ctx: ServiceCtx, blocks: PageDoc['blocks']): Map<number, FieldIssue[]> {
  const out = new Map<number, FieldIssue[]>()
  blocks.forEach((b, i) => {
    const r = ctx.registry.validate(b, 'props')
    if (!r.ok) out.set(i, r.issues)
  })
  return out
}

export function editText(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.editTextInput>) {
  const c = candidates(ctx, input)
  const skipped = assertNotBlocked([...c.pages, ...c.parts], input.skip_blocked)
  const opts = { caseSensitive: input.case_sensitive, wholeWord: input.whole_word }

  interface PagePlan { page: typeof pages.$inferSelect; ops: InternalOp[]; count: number; samples: { where: string; before: string; after: string }[] }
  const pagePlans: PagePlan[] = []
  const partPlans: { part: typeof siteParts.$inferSelect; doc: SitePartDoc; count: number; samples: { where: string; before: string; after: string }[] }[] = []
  const skippedNever: { page: string; block_type: string; matches: number }[] = []
  let found = 0

  for (const p of c.pages.filter((x) => !x.blocked)) {
    const doc = readDoc(ctx, p.draftVersionId!)
    const blocks = doc.blocks
    let count = 0
    const samples: PagePlan['samples'] = []
    const next = blocks.map((b) => {
      const r = replaceText(b.props, input.find, input.replace, opts)
      const matches = r.replacements.reduce((s, x) => s + x.count, 0)
      if (!matches) return b
      found += matches
      if (isNeverBlockType(b.type)) {
        skippedNever.push({ page: p.title, block_type: b.type, matches })
        return b
      }
      count += matches
      for (const x of r.replacements.slice(0, 3)) samples.push({ where: `${b.id}.${pathString(x.path)}`, before: x.before, after: x.after })
      return { ...b, props: r.value }
    })
    if (count) pagePlans.push({ page: p, ops: updateOps(blocks, next), count, samples })
  }
  for (const part of c.parts.filter((x) => !x.blocked)) {
    const doc = readSitePartDoc(ctx, part)
    const r = replaceText(doc, input.find, input.replace, opts)
    const matches = r.replacements.reduce((s, x) => s + x.count, 0)
    if (!matches) continue
    found += matches
    const valid = validateSitePartDoc(part.kind, r.value)
    if (!valid.ok) throw new AppError('validation_failed', `The new text does not fit in the ${part.label.toLowerCase()}: ${valid.issues[0]!.message}`, valid.issues)
    partPlans.push({ part, doc: valid.doc, count: matches, samples: r.replacements.slice(0, 3).map((x) => ({ where: pathString(x.path), before: x.before, after: x.after })) })
  }
  const detail = [...pagePlans.map((p) => ({ page: p.page.title, path: p.page.path, matches: p.count })), ...partPlans.map((p) => ({ site_part: p.part.label, matches: p.count }))]
  if (found === 0) throw new AppError('no_matches', `"${input.find}" was not found in ${input.everywhere ? 'the draft of any page or site part' : `"${c.pages[0]!.title}"`}. Use search_content to see how the text is actually written. Text split by bold or a link must be edited run by run, or use insert_rich_text or edit_component.`)
  checkExpected(found, input.expected_matches, detail)
  const replaceable = pagePlans.reduce((s, p) => s + p.count, 0) + partPlans.reduce((s, p) => s + p.count, 0)
  if (replaceable === 0) throw neverList(`The only matches are inside protected sections (${skippedNever.map((s) => s.block_type).join(', ')}).`)

  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Change text: "${input.find.slice(0, 40)}" to "${input.replace.slice(0, 40)}"`, reason: input.reason }, (h) => {
    for (const p of pagePlans) h.editPage(p.page.id, 'edit_text', p.ops)
    for (const p of partPlans) h.editPart(p.part.id, 'edit_text', p.doc)
  })
  return {
    ...editView(ctx, agent, done.change),
    result: {
      replaced: replaceable,
      pages: pagePlans.map((p) => ({ page_id: p.page.id, title: p.page.title, path: p.page.path, replacements: p.count, examples: p.samples })),
      site_parts: partPlans.map((p) => ({ part_id: p.part.id, label: p.part.label, replacements: p.count, examples: p.samples })),
      skipped_protected_sections: skippedNever,
      skipped,
    },
  }
}

function linkPlan(ctx: ServiceCtx, input: { url: string; match: 'exact' | 'prefix' | 'domain'; page_id?: string; path?: string; everywhere?: boolean; skip_blocked?: boolean; expected_matches?: number }) {
  const c = candidates(ctx, input)
  const skipped = assertNotBlocked([...c.pages, ...c.parts], input.skip_blocked)
  const { matches } = matchingLinks(ctx, input.url, input.match)
  const pagePlans = c.pages
    .filter((p) => !p.blocked)
    .map((p) => {
      const doc = readDoc(ctx, p.draftVersionId!)
      const hits = findLinks(doc.blocks, 'block').filter(matches)
      return { page: p, doc, hits }
    })
    .filter((x) => x.hits.length)
  const partPlans = c.parts
    .filter((p) => !p.blocked)
    .map((p) => {
      const doc = readSitePartDoc(ctx, p)
      return { part: p, doc, hits: findLinks(doc, 'sitepart').filter(matches) }
    })
    .filter((x) => x.hits.length)
  const found = pagePlans.reduce((s, p) => s + p.hits.length, 0) + partPlans.reduce((s, p) => s + p.hits.length, 0)
  const detail = [...pagePlans.map((p) => ({ page: p.page.title, path: p.page.path, links: p.hits.length })), ...partPlans.map((p) => ({ site_part: p.part.label, links: p.hits.length }))]
  if (found === 0) throw new AppError('no_matches', `No link to "${input.url}" (match: ${input.match}) was found in ${input.everywhere ? 'the draft of any page or site part' : `"${c.pages[0]!.title}"`}. Use find_links to see the links that exist, and check the match mode.`)
  checkExpected(found, input.expected_matches, detail)
  return { pagePlans, partPlans, skipped, found }
}

const blockPath = (hit: LinkHit, blocks: PageDoc['blocks']) => `${blocks[hit.path[0] as number]?.id ?? '?'}.${pathString(hit.path.slice(2))}`

export function removeLink(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.removeLinkInput>) {
  const plan = linkPlan(ctx, input)
  const couldNot: { where: string; label: string | null; href: string; why: string }[] = []
  let removedCount = 0
  const pageOps = plan.pagePlans.map((pp) => {
    const blocks = pp.doc.blocks
    const r = removeLinks(blocks, pp.hits)
    for (const u of r.unremovable) couldNot.push({ where: `${pp.page.title}: ${blockPath({ path: u.path } as LinkHit, blocks)}`, label: u.label, href: u.href, why: u.reason })
    // A section must still be valid without the link. If not, leave that section as it was.
    const bad = blockIssues(ctx, r.value)
    const finalBlocks = r.value.map((b, i) => {
      if (!bad.has(i)) return b
      const lost = r.removed.filter((x) => x.path[0] === i)
      for (const x of lost) couldNot.push({ where: `${pp.page.title}: ${blockPath({ path: x.path } as LinkHit, blocks)}`, label: x.label, href: x.href, why: `The "${blocks[i]!.type}" section needs this link to be valid (${bad.get(i)![0]!.message}). Remove the section with remove_component, or point the link elsewhere with replace_link.` })
      return blocks[i]!
    })
    removedCount += r.removed.filter((x) => !bad.has(x.path[0] as number)).length
    return { pp, ops: updateOps(blocks, finalBlocks) }
  })
  const partDocs = plan.partPlans.map((pp) => {
    const r = removeLinks(pp.doc, pp.hits)
    for (const u of r.unremovable) couldNot.push({ where: `${pp.part.label}: ${pathString(u.path)}`, label: u.label, href: u.href, why: u.reason })
    const valid = validateSitePartDoc(pp.part.kind, r.value)
    if (!valid.ok) {
      for (const x of r.removed) couldNot.push({ where: `${pp.part.label}: ${pathString(x.path)}`, label: x.label, href: x.href, why: `The ${pp.part.label.toLowerCase()} would not be valid without it (${valid.issues[0]!.message}).` })
      return { pp, doc: null as SitePartDoc | null }
    }
    removedCount += r.removed.length
    return { pp, doc: r.value as SitePartDoc }
  })
  if (couldNot.length && !input.skip_unremovable) {
    throw new AppError('validation_failed', `${couldNot.length} link${couldNot.length === 1 ? '' : 's'} cannot be removed on their own, so nothing was changed. See "could_not_remove". Either fix those by hand (remove_component, remove_menu_item, replace_link), or call again with skip_unremovable: true to remove the rest and report these.`, couldNot.map((c) => ({ path: c.where, message: c.why })), { could_not_remove: couldNot })
  }
  if (removedCount === 0) throw new AppError('no_matches', 'None of the matching links could be removed.', undefined, { could_not_remove: couldNot })

  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Remove link to ${input.url.slice(0, 80)}`, reason: input.reason }, (h) => {
    for (const x of pageOps) if (x.ops.length) h.editPage(x.pp.page.id, 'remove_link', x.ops)
    for (const x of partDocs) if (x.doc) h.editPart(x.pp.part.id, 'remove_link', x.doc)
  })
  return {
    ...editView(ctx, agent, done.change),
    result: {
      links_removed: removedCount,
      complete: couldNot.length === 0,
      could_not_remove: couldNot,
      pages: plan.pagePlans.map((p) => ({ page_id: p.page.id, title: p.page.title, path: p.page.path, links: p.hits.length })),
      site_parts: plan.partPlans.map((p) => ({ part_id: p.part.id, label: p.part.label, links: p.hits.length })),
      skipped: plan.skipped,
    },
  }
}

export function replaceLink(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.replaceLinkInput>) {
  if (!isSafeHref(input.new_url)) throw new AppError('validation_failed', 'new_url must start with https://, http://, mailto:, tel:, / or #.', [{ path: 'new_url', message: 'Not a safe link.' }])
  const plan = linkPlan(ctx, input)
  const pageOps = plan.pagePlans.map((pp) => {
    const r = replaceLinks(pp.doc.blocks, pp.hits, input.new_url)
    return { pp, ops: updateOps(pp.doc.blocks, r.value), changed: r.changed.length }
  })
  const partDocs = plan.partPlans.map((pp) => {
    const r = replaceLinks(pp.doc, pp.hits, input.new_url)
    const valid = validateSitePartDoc(pp.part.kind, r.value)
    if (!valid.ok) throw new AppError('validation_failed', `The new link does not fit in the ${pp.part.label.toLowerCase()}: ${valid.issues[0]!.message}`, valid.issues)
    return { pp, doc: valid.doc, changed: r.changed.length }
  })
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Change link ${input.url.slice(0, 50)} to ${input.new_url.slice(0, 50)}`, reason: input.reason }, (h) => {
    for (const x of pageOps) h.editPage(x.pp.page.id, 'add_link', x.ops)
    for (const x of partDocs) h.editPart(x.pp.part.id, 'add_link', x.doc)
  })
  return {
    ...editView(ctx, agent, done.change),
    result: {
      links_changed: pageOps.reduce((s, x) => s + x.changed, 0) + partDocs.reduce((s, x) => s + x.changed, 0),
      new_url: input.new_url,
      pages: plan.pagePlans.map((p) => ({ page_id: p.page.id, title: p.page.title, path: p.page.path, links: p.hits.length })),
      site_parts: plan.partPlans.map((p) => ({ part_id: p.part.id, label: p.part.label, links: p.hits.length })),
      skipped: plan.skipped,
    },
  }
}

export function insertRichTextInto(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.insertRichTextInput>) {
  const page = resolvePage(ctx, input)
  const doc = readDoc(ctx, page.draftVersionId!)
  const block = doc.blocks.find((b) => b.id === input.block_id)
  if (!block) throw new AppError('not_found', `The page "${page.title}" has no section ${input.block_id}. Use get_page to see the section ids.`)
  checkBlockType(block.type)
  checkProps({ [input.prop]: 1 })
  const current = block.props[input.prop]
  if (!isRichTextValue(current)) throw new AppError('validation_failed', `The "${input.prop}" prop of this ${block.type} section is not rich text. get_page lists rich-text props under rich_text. For other props use edit_component.`, [{ path: 'prop', message: 'Not a rich-text prop.' }])
  const md = markdownToRichText(input.markdown)
  if (!md.ok) throw new AppError('validation_failed', md.message, [{ path: 'markdown', message: md.message }])
  const position = typeof input.position === 'string' ? input.position : { afterText: input.position.after_text }
  const next = insertRichText(current, md.doc, position)
  if (!next) throw new AppError('no_matches', `No paragraph, heading or list contains "${typeof input.position === 'object' ? input.position.after_text : ''}", so nothing was added. Use get_page to see the text, or use position "end".`)
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Add text to ${page.title}`, reason: input.reason }, (h) => {
    h.editPage(page.id, 'edit_text', [{ op: 'update_props', blockId: block.id, props: { [input.prop]: next } }])
  })
  return { ...editView(ctx, agent, done.change), result: { added_to: { page_id: page.id, block_id: block.id, prop: input.prop }, now_reads: richTextToMarkdown(next) } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Edits: sections and page details

function pageOf(ctx: ServiceCtx, input: { page_id?: string; path?: string }) {
  return resolvePage(ctx, input)
}

function requireBlock(ctx: ServiceCtx, pageId: string, blockId: string) {
  const page = requirePage(ctx, pageId)
  const doc = readDoc(ctx, page.draftVersionId!)
  const block = doc.blocks.find((b) => b.id === blockId)
  if (!block) throw new AppError('not_found', `The page "${page.title}" has no section ${blockId}. Use get_page to see the section ids.`)
  return { page, doc, block }
}

export function editComponent(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.editComponentInput>) {
  const page = pageOf(ctx, input)
  const { block } = requireBlock(ctx, page.id, input.block_id)
  checkBlockType(block.type)
  checkProps(input.props, input.unset)
  if (!Object.keys(input.props).length && !input.unset?.length) throw new AppError('validation_failed', 'Give props to set or unset.', [{ path: 'props', message: 'Nothing to change.' }])
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Edit ${block.type} on ${page.title}`, reason: input.reason }, (h) => {
    h.editPage(page.id, 'edit_sections', [{ op: 'update_props', blockId: block.id, props: input.props, ...(input.unset?.length ? { unset: input.unset } : {}) }])
  })
  return { ...editView(ctx, agent, done.change), result: { page_id: page.id, block_id: block.id } }
}

export function addComponent(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.addComponentInput>) {
  const page = pageOf(ctx, input)
  checkBlockType(input.type)
  checkProps(input.props)
  if (!ctx.registry.has(input.type)) throw new AppError('validation_failed', `"${input.type}" is not a section type. Use list_components for the types.`, [{ path: 'type', message: 'Unknown section type.' }])
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Add ${input.type} to ${page.title}`, reason: input.reason }, (h) => {
    return h.editPage(page.id, 'edit_sections', [{ op: 'add_block', block: { type: input.type, props: input.props }, ...(input.after_block_id ? { afterBlockId: input.after_block_id } : {}), ...(input.index !== undefined ? { index: input.index } : {}) }])
  })
  return { ...editView(ctx, agent, done.change), result: { page_id: page.id, sections_now: done.result.doc.blocks.map((b) => ({ block_id: b.id, type: b.type })) } }
}

export function removeComponent(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.removeComponentInput>) {
  const page = pageOf(ctx, input)
  const { block } = requireBlock(ctx, page.id, input.block_id)
  checkBlockType(block.type)
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Remove ${block.type} from ${page.title}`, reason: input.reason }, (h) => h.editPage(page.id, 'edit_sections', [{ op: 'remove_block', blockId: block.id }]))
  return { ...editView(ctx, agent, done.change), result: { page_id: page.id, removed_block_id: block.id, sections_now: done.result.doc.blocks.map((b) => ({ block_id: b.id, type: b.type })) } }
}

export function moveComponent(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.moveComponentInput>) {
  const page = pageOf(ctx, input)
  const { block } = requireBlock(ctx, page.id, input.block_id)
  checkBlockType(block.type)
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Move ${block.type} on ${page.title}`, reason: input.reason }, (h) => h.editPage(page.id, 'edit_sections', [{ op: 'move_block', blockId: block.id, toIndex: input.to_index }]))
  return { ...editView(ctx, agent, done.change), result: { page_id: page.id, sections_now: done.result.doc.blocks.map((b) => ({ block_id: b.id, type: b.type })) } }
}

export function setPageDetails(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.setPageDetailsInput>) {
  const page = pageOf(ctx, input)
  const ops: InternalOp[] = []
  if (input.title !== undefined || input.slug !== undefined) ops.push({ op: 'set_meta', ...(input.title !== undefined ? { title: input.title } : {}), ...(input.slug !== undefined ? { slug: input.slug } : {}) })
  if (input.seo_title !== undefined || input.seo_description !== undefined || input.noindex !== undefined) {
    ops.push({ op: 'set_seo', ...(input.seo_title !== undefined ? { title: input.seo_title } : {}), ...(input.seo_description !== undefined ? { description: input.seo_description } : {}), ...(input.noindex !== undefined ? { noindex: input.noindex } : {}) })
  }
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Change details of ${page.title}`, reason: input.reason }, (h) => h.editPage(page.id, 'edit_page_details', ops))
  return { ...editView(ctx, agent, done.change), result: { page_id: page.id, title: done.result.doc.title, path: done.result.meta.path, seo: done.result.doc.seo } }
}

export function createPageFor(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.createPageInput>) {
  for (const s of input.sections) {
    checkBlockType(s.type)
    checkProps(s.props)
  }
  const parent = input.parent_path ? resolvePage(ctx, { path: input.parent_path }) : null
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Create page: ${input.title}`, reason: input.reason }, (h) => {
    const { page } = createPage(ctx, h.actor, { title: input.title, template: input.page_type, slug: input.slug, parentId: parent?.id ?? null })
    h.addCreatedPage({ id: page.id, title: page.title, path: page.path, draftRevision: page.draftRevision, template: page.template }, 'create_page')
    if (input.sections.length) h.editPage(page.id, 'create_page', input.sections.map((s) => ({ op: 'add_block' as const, block: { type: s.type, props: s.props } })))
    return page.id
  })
  const page = requirePage(ctx, done.result)
  return { ...editView(ctx, agent, done.change), result: { page_id: page.id, path: page.path, page_type: page.template, note: 'The page exists as a draft only. It is not live until the change is published or approved.' } }
}

/** Section types a page type allows, minus the ones no agent may ever add (donation forms, embeds). */
const agentAllowed = (types: readonly string[]) => types.filter((t) => !isNeverBlockType(t))

/** Say which page in a create_pages call a validation error belongs to, with paths an agent can map to its input. */
function inPage<T>(index: number, title: string, blockOffset: number, fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'validation_failed') throw e
    const at = `pages.${index}`
    const fields = (e.fields ?? []).map((f) => ({ ...f, path: `${at}.${f.path.replace(/^blocks\.(\d+)/, (_m, n: string) => `sections.${Number(n) - blockOffset}`)}` }))
    const where = fields[0]?.path ? ` (${fields[0].path})` : ''
    throw new AppError('validation_failed', `Page ${index + 1} ("${title}")${where}: ${e.message} Nothing was created.`, fields)
  }
}

/** Build several pages in one change (phase 5). All or nothing: one bad page, section or menu item and nothing is created. */
export function createPagesFor(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.createPagesInput>) {
  const refs = new Set<string>()
  input.pages.forEach((p, i) => {
    const at = `pages.${i}`
    if (p.parent_path && p.parent_ref) throw new AppError('validation_failed', `Page ${i + 1} ("${p.title}") has both parent_path and parent_ref. Give one.`, [{ path: `${at}.parent_ref`, message: 'Give parent_path or parent_ref, not both.' }])
    if (p.parent_ref && !refs.has(p.parent_ref)) throw new AppError('validation_failed', `Page ${i + 1} ("${p.title}") says parent_ref "${p.parent_ref}", but no EARLIER page in this call has that ref. Parents must come first in the list.`, [{ path: `${at}.parent_ref`, message: 'No earlier page has this ref.' }])
    if (p.ref) {
      if (refs.has(p.ref)) throw new AppError('validation_failed', `Two pages share the ref "${p.ref}".`, [{ path: `${at}.ref`, message: 'Refs must be different.' }])
      refs.add(p.ref)
    }
    for (const sec of p.sections) {
      checkBlockType(sec.type)
      checkProps(sec.props)
    }
  })
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: input.pages.length === 1 ? `Create page: ${input.pages[0]!.title}` : `Build ${input.pages.length} pages: ${input.pages.map((p) => p.title).join(', ').slice(0, 80)}`, reason: input.reason }, (h) => {
    const byRef = new Map<string, string>()
    const made: { ref: string | null; page_id: string; path: string; title: string; page_type: string; menu?: { menu_key: string; label: string; under_label?: string } }[] = []
    for (const [i, p] of input.pages.entries()) {
      const parent = p.parent_ref ? requirePage(ctx, byRef.get(p.parent_ref)!) : p.parent_path ? resolvePage(ctx, { path: p.parent_path }) : null
      const { page } = inPage(i, p.title, 0, () => createPage(ctx, h.actor, { title: p.title, template: p.page_type, slug: p.slug, parentId: parent?.id ?? null }))
      h.addCreatedPage({ id: page.id, title: page.title, path: page.path, draftRevision: page.draftRevision, template: page.template }, 'create_page')
      const offset = p.sections.length ? readDoc(ctx, requirePage(ctx, page.id).draftVersionId!).blocks.length : 0
      if (p.sections.length) inPage(i, p.title, offset, () => h.editPage(page.id, 'create_page', p.sections.map((sec) => ({ op: 'add_block' as const, block: { type: sec.type, props: sec.props } }))))
      if (p.ref) byRef.set(p.ref, page.id)
      const row = requirePage(ctx, page.id)
      made.push({ ref: p.ref ?? null, page_id: page.id, path: row.path, title: page.title, page_type: page.template, ...(p.menu ? { menu: { menu_key: p.menu.menu_key, label: p.menu.label ?? p.title.slice(0, 40), under_label: p.menu.under_label } } : {}) })
    }
    const menuKeys = [...new Set(made.flatMap((m) => (m.menu ? [m.menu.menu_key] : [])))]
    const menus: string[] = []
    for (const key of menuKeys) {
      const part = findPart(ctx, 'menu', key)
      const menu = structuredClone(readSitePartDoc(ctx, part)) as MenuDoc
      for (const m of made.filter((x) => x.menu?.menu_key === key)) {
        const item = { id: newItemId(), label: m.menu!.label, target: { type: 'page' as const, pageId: m.page_id } }
        if (m.menu!.under_label) {
          const parent = menu.items.find((i) => i.label.toLowerCase() === m.menu!.under_label!.toLowerCase())
          if (!parent) throw new AppError('not_found', `No top-level item "${m.menu!.under_label}" in the "${key}" menu. Use get_site_part with kind "menu" to see the items.`)
          parent.children.push(item)
        } else menu.items.push({ ...item, children: [] })
      }
      const valid = validateSitePartDoc('menu', menu)
      if (!valid.ok) throw new AppError('validation_failed', `The menu "${key}" would become invalid: ${valid.issues[0]!.message}`, valid.issues)
      h.editPart(part.id, 'edit_menu', valid.doc)
      menus.push(key)
    }
    return { made, menus }
  })
  return {
    ...editView(ctx, agent, done.change),
    result: {
      pages_created: done.result.made.map((m) => ({ ref: m.ref, page_id: m.page_id, path: m.path, title: m.title, page_type: m.page_type, added_to_menu: m.menu ? m.menu.menu_key : null })),
      menus_edited: done.result.menus,
      note: 'The pages exist as drafts only. Nothing is live until the change is published or approved. Building more than one page at once is sent to a person unless a rule with a high enough maxNewPages allows it.',
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Edits: menus and banner

function newItemId() {
  return newId('block')
}

type MenuItem = MenuDoc['items'][number]
type MenuChild = MenuItem['children'][number]

function locateItem(menu: MenuDoc, ref: { item_id?: string; label?: string }): { item: MenuItem | MenuChild; parent: MenuItem | null; index: number } {
  const found: { item: MenuItem | MenuChild; parent: MenuItem | null; index: number }[] = []
  menu.items.forEach((it, i) => {
    if ((ref.item_id && it.id === ref.item_id) || (!ref.item_id && ref.label && it.label.toLowerCase() === ref.label.toLowerCase())) found.push({ item: it, parent: null, index: i })
    it.children.forEach((c, j) => {
      if ((ref.item_id && c.id === ref.item_id) || (!ref.item_id && ref.label && c.label.toLowerCase() === ref.label.toLowerCase())) found.push({ item: c, parent: it, index: j })
    })
  })
  if (!found.length) throw new AppError('not_found', `No menu item matches ${ref.item_id ? `id ${ref.item_id}` : `"${ref.label}"`}. Use get_site_part with kind "menu" to see the items.`)
  if (found.length > 1) throw new AppError('validation_failed', `"${ref.label}" matches ${found.length} menu items. Use item_id instead. Candidates: ${found.map((f) => `${f.item.id} ("${f.item.label}"${f.parent ? ` under "${f.parent.label}"` : ''})`).join(', ')}.`)
  return found[0]!
}

function menuTarget(input: { url?: string; page_id?: string }, ctx: ServiceCtx) {
  if (input.page_id) {
    requirePage(ctx, input.page_id)
    return { type: 'page' as const, pageId: input.page_id }
  }
  if (!input.url || !isSafeHref(input.url)) throw new AppError('validation_failed', 'url must start with https://, http://, mailto:, tel: or /.', [{ path: 'url', message: 'Not a safe link.' }])
  return { type: 'url' as const, url: input.url }
}

function editMenu(ctx: ServiceCtx, agent: SignedInAgent, base: { menu_key: string; change_id?: string; reason: string }, title: string, change: (menu: MenuDoc) => void) {
  const part = findPart(ctx, 'menu', base.menu_key)
  const menu = structuredClone(readSitePartDoc(ctx, part)) as MenuDoc
  change(menu)
  const valid = validateSitePartDoc('menu', menu)
  if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]!.message, valid.issues)
  const done = runInChange(ctx, agent, { changeId: base.change_id, title, reason: base.reason }, (h) => h.editPart(part.id, 'edit_menu', valid.doc))
  return { ...editView(ctx, agent, done.change), result: { menu_now: (valid.doc as MenuDoc).items.map((i) => ({ item_id: i.id, label: i.label, children: i.children.map((c) => ({ item_id: c.id, label: c.label })) })) } }
}

export function removeMenuItem(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.removeMenuItemInput>) {
  return editMenu(ctx, agent, input, 'Remove a menu item', (menu) => {
    const f = locateItem(menu, input)
    if (!f.parent && 'children' in f.item && f.item.children.length && !input.remove_children) {
      throw new AppError('validation_failed', `"${f.item.label}" has ${f.item.children.length} sub-item(s). Pass remove_children: true to remove them too, or remove the sub-items first.`, [{ path: 'remove_children', message: 'Item has sub-items.' }])
    }
    if (f.parent) f.parent.children.splice(f.index, 1)
    else menu.items.splice(f.index, 1)
  })
}

export function addMenuItem(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.addMenuItemInput>) {
  const target = menuTarget(input, ctx)
  return editMenu(ctx, agent, input, `Add menu item "${input.label}"`, (menu) => {
    if (input.parent_item_id) {
      const parent = menu.items.find((i) => i.id === input.parent_item_id)
      if (!parent) throw new AppError('not_found', `No top-level menu item has id ${input.parent_item_id}. Sub-items can only go under a top-level item.`)
      parent.children.splice(input.position ?? parent.children.length, 0, { id: newItemId(), label: input.label, target })
    } else menu.items.splice(input.position ?? menu.items.length, 0, { id: newItemId(), label: input.label, target, children: [] })
  })
}

export function renameMenuItem(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.renameMenuItemInput>) {
  return editMenu(ctx, agent, input, `Rename menu item to "${input.new_label}"`, (menu) => {
    locateItem(menu, input).item.label = input.new_label
  })
}

export function setBanner(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.setBannerInput>) {
  const part = findPart(ctx, 'banner')
  const banner = structuredClone(readSitePartDoc(ctx, part)) as BannerDoc
  if (input.message !== undefined) banner.message = input.message
  if (input.tone !== undefined) banner.tone = input.tone
  if (input.link !== undefined) {
    if (input.link === null) banner.link = null
    else {
      if (!!input.link.url === !!input.link.page_id) throw new AppError('validation_failed', 'The banner link needs url or page_id, not both and not neither.', [{ path: 'link', message: 'Give url or page_id.' }])
      banner.link = { label: input.link.label, target: menuTarget(input.link, ctx) }
    }
  }
  if (input.enabled !== undefined) banner.enabled = input.enabled
  const valid = validateSitePartDoc('banner', banner)
  if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]!.message, valid.issues)
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: 'Change the banner', reason: input.reason }, (h) => h.editPart(part.id, 'edit_banner', valid.doc))
  return { ...editView(ctx, agent, done.change), result: { banner_now: valid.doc } }
}

/** Change the footer's words and details (phase 5). Layout, look and which menus it shows stay with people. */
export function setFooter(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.setFooterInput>) {
  const part = findPart(ctx, 'footer')
  const footer = structuredClone(readSitePartDoc(ctx, part)) as FooterDoc
  const changed: string[] = []
  if (input.text_markdown !== undefined) {
    if (input.text_markdown === null || !input.text_markdown.trim()) footer.text = null
    else {
      const md = markdownToRichText(input.text_markdown)
      if (!md.ok) throw new AppError('validation_failed', md.message, [{ path: 'text_markdown', message: md.message }])
      footer.text = md.doc
    }
    changed.push('text')
  }
  if (input.contact) {
    for (const k of ['email', 'phone', 'address'] as const) if (input.contact[k] !== undefined) footer.contact[k] = input.contact[k] || null
    changed.push('contact')
  }
  if (input.social !== undefined) {
    footer.social = input.social
    changed.push('social')
  }
  if (input.tagline !== undefined) {
    footer.tagline = input.tagline ? { lead: input.tagline.lead, accent: input.tagline.accent ?? '' } : null
    changed.push('tagline')
  }
  const simple = { contact_title: 'contactTitle', links_title: 'linksTitle', legal_text: 'legalText', charity_number: 'charityNumber' } as const
  for (const [k, field] of Object.entries(simple) as [keyof typeof simple, (typeof simple)[keyof typeof simple]][]) {
    if (input[k] !== undefined) {
      footer[field] = input[k] || null
      changed.push(field)
    }
  }
  if (!changed.length) throw new AppError('validation_failed', 'Say what to change: text_markdown, contact, social, tagline, contact_title, links_title, legal_text or charity_number.', [{ path: '(input)', message: 'Nothing to change.' }])
  const valid = validateSitePartDoc('footer', footer)
  if (!valid.ok) throw new AppError('validation_failed', valid.issues[0]!.message, valid.issues)
  const done = runInChange(ctx, agent, { changeId: input.change_id, title: `Change the footer (${changed.join(', ')})`, reason: input.reason }, (h) => h.editPart(part.id, 'edit_footer', valid.doc))
  return { ...editView(ctx, agent, done.change), result: { changed, footer_now: valid.doc } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Decide

export function previewChange(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.previewChangeInput>) {
  const row = requireOwnChange(ctx, agent, input.change_id)
  if (row.status !== 'open') return changeView(ctx, agent, row)
  if (!changeTargets(row).length) return changeView(ctx, agent, row)
  return changeView(ctx, agent, row, evaluateChange(ctx, agent, row))
}

export function requestPublish(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.requestPublishInput>) {
  const row = requireOpenForSend(ctx, agent, input.change_id)
  const r = sendChange(ctx, agent, row, { mode: 'request_review', note: input.note })
  return { ...changeView(ctx, agent, r.change), result: { sent_for_review: true, published: false } }
}

export function publishChange(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.publishChangeInput>) {
  const row = requireOpenForSend(ctx, agent, input.change_id)
  const r = sendChange(ctx, agent, row, { mode: 'publish_if_allowed' })
  return { ...changeView(ctx, agent, r.change), result: { published: r.published, sent_for_review: !r.published, why: r.evaluation.decision.reasons } }
}

function requireOpenForSend(ctx: ServiceCtx, agent: SignedInAgent, id: string): ChangeRow {
  if (agent.token.access !== 'draft') throw new AppError('forbidden', 'This token is read-only.')
  const row = refreshChange(ctx, requireOwnChange(ctx, agent, id))
  if (row.status !== 'open') throw new AppError('invalid_state', `Change ${row.id} is "${row.status}", so it cannot be sent again.`, undefined, { status: row.status })
  return row
}

export function discardChangeFor(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.discardChangeInput>) {
  if (agent.token.access !== 'draft') throw new AppError('forbidden', 'This token is read-only.')
  const row = discardChange(ctx, agent, input.change_id)
  return { ...changeView(ctx, agent, row), result: { discarded: true } }
}

export function undoChangeFor(ctx: ServiceCtx, agent: SignedInAgent, input: In<typeof S.undoChangeInput>) {
  if (agent.token.access !== 'draft') throw new AppError('forbidden', 'This token is read-only.')
  const r = undoChange(ctx, agent, input.change_id, { reason: input.reason })
  // A change that only created pages needs no undo change: its pages are taken offline and the original is undone.
  return { ...changeView(ctx, agent, r.undo ?? r.original), result: { undone: r.published, undo_goes_live: r.published, undo_sent_for_review: !r.published, original_change_id: input.change_id, pages_taken_offline: r.pagesTakenOffline } }
}

export { agentChanges, notFound, getAt }
export type { Path, Candidate }

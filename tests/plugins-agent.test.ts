// Agent plugin proposals and writable plugin blocks. A proposal is not an install.
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { writeTarGz } from '../shared/plugins/archive'
import { agentCalls, auditEvents, notifications, pluginProposals, plugins } from '../server/db/schema'
import { toolList } from '../server/services/agent/mcp'
import { callOperation } from '../server/services/agent/operations'
import { authenticateAgent, enableAlwaysAllow } from '../server/services/agent/tokens'
import { AppError } from '../server/services/errors'
import { applyPageOps, readDoc, requirePage } from '../server/services/pages'
import { installPluginArchive } from '../server/services/plugins/install'
import { disablePlugin } from '../server/services/plugins/lifecycle'
import { clearPluginRuntimes } from '../server/services/plugins/runtime'
import { approveReview } from '../server/services/reviews'
import { editTemplate, getTemplate, getTemplateRules, listTemplates, submitTemplate } from '../server/services/templates'
import { setBlockRegistry } from '../server/utils/state'
import { PASSWORD_FOR_TESTS, PUBLISH_ALL, addToken, code, drain, world, type World } from './agent-helpers'

afterEach(() => {
  setBlockRegistry(createDefaultRegistry())
  clearPluginRuntimes()
})

const REASON = 'The owner asked for a short note section.'
const MARKER = 'Marker sentence for the note block only.'
const TEXT_ONLY = 'Upload this plugin from Settings, Plugins. The agent tool accepts text files only.'
const NEXT_STEPS = 'Nothing is installed until a person approves it on Settings, Plugins. Rules and always-allow cannot install it.'
const CLOSED = 'This plugin block is not open to agents.'
const FILE_MARKER = 'PACKAGE-MARKER-9'

const call = (w: World, name: string, input: Record<string, unknown>, agent = w.agent) => callOperation(w.ctx, agent, name, input) as any

async function raised(fn: () => unknown): Promise<AppError> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an error')
}

function noteBlock(over: Record<string, unknown> = {}) {
  return {
    type: 'Note',
    v: 1,
    label: 'Note',
    category: 'Text',
    props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
    template: 'note.html',
    example: { heading: 'Hello' },
    ...over,
  }
}

function manifest(id: string, blocks: unknown[]) {
  return {
    id,
    name: id,
    version: '1.0.0',
    sitebuilder: '>=0.1.0 <0.2.0',
    permissions: ['blocks'],
    csp: { img: [] as string[], frame: [] as string[], script: [] as string[], connect: [] as string[], font: [] as string[] },
    blocks,
  }
}

function textFiles(doc: ReturnType<typeof manifest>, html = `<section>${FILE_MARKER}</section>`) {
  const files: Record<string, string> = { 'plugin.json': JSON.stringify(doc) }
  for (const block of doc.blocks as { template: string }[]) files[block.template] = html
  return files
}

function pack(doc: ReturnType<typeof manifest>, html = '<section>Hello</section>') {
  const files = [{ path: 'plugin.json', bytes: Buffer.from(JSON.stringify(doc)) }]
  const seen = new Set<string>()
  for (const block of doc.blocks as { template: string }[]) {
    if (seen.has(block.template)) continue
    seen.add(block.template)
    files.push({ path: block.template, bytes: Buffer.from(html) })
  }
  return writeTarGz(files)
}

function kit() {
  return manifest('agent-kit', [
    noteBlock({
      props: {
        type: 'object',
        fields: {
          heading: { type: 'string', max: 80, required: true },
          accountRef: { type: 'string', max: 40 },
        },
      },
      agent: { writable: true, describe: MARKER },
      agentNever: ['accountRef'],
    }),
    {
      type: 'Gift',
      v: 1,
      label: 'Gift',
      category: 'Text',
      props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
      template: 'gift.html',
      example: { heading: 'Hello' },
      agent: { writable: true, describe: 'A gift total for this plugin only.' },
      money: true,
    },
  ])
}

function closedDoc() {
  return manifest('closed-note', [
    {
      type: 'Note',
      v: 1,
      label: 'Note',
      category: 'Text',
      props: {
        type: 'object',
        fields: {
          heading: { type: 'string', max: 80, required: true },
          cta: { type: 'link', required: true },
        },
      },
      template: 'note.html',
      example: { heading: 'Closedzebra', cta: { label: 'Go', href: 'https://closed.example/go' } },
      agent: { writable: false, describe: 'Closed to agents.' },
    },
  ])
}

async function allow(w: World, types: string[]) {
  const row = listTemplates(w.ctx).find((t) => t.key === 'standard')
  if (!row) throw new Error('missing standard template')
  const current = getTemplate(w.ctx, row.id)
  const extra = types.filter((type) => !current.doc.allowedBlocks.includes(type))
  if (!extra.length) return
  editTemplate(w.ctx, w.admin, row.id, current.revision, { ...current.doc, allowedBlocks: [...current.doc.allowedBlocks, ...extra] })
  const sub = submitTemplate(w.ctx, w.admin, row.id)
  approveReview(w.ctx, w.approver, sub.reviewId, { versionId: sub.versionId })
  await drain(w)
  const rules = getTemplateRules(w.ctx, 'standard')
  for (const type of types) expect(rules?.allowedBlocks, type).toContain(type)
}

function draftDoc(w: World) {
  const page = requirePage(w.ctx, w.pageId)
  if (!page.draftVersionId) throw new Error('missing draft')
  return readDoc(w.ctx, page.draftVersionId)
}

function addHuman(w: World, type: string, props: Record<string, unknown>) {
  const page = requirePage(w.ctx, w.pageId)
  applyPageOps(w.ctx, w.editor, page.id, page.draftRevision, [{ op: 'add_block', block: { type, props } }])
}

async function expectClosed(run: () => unknown) {
  const err = await raised(run)
  expect(err.code).toBe('never_list')
  expect(err.message).toContain(CLOSED)
  expect(err.message).not.toMatch(/donation forms/)
}

describe('propose_plugin', () => {
  it('stores a pending proposal and does not install', async () => {
    const w = await world()
    const notes = w.ctx.db.select().from(notifications).all().length
    const doc = manifest('agent-note', [noteBlock()])
    const r = await call(w, 'propose_plugin', { files: textFiles(doc), reason: REASON })
    expect(r).toMatchObject({ status: 'pending', plugin_id: 'agent-note', version: '1.0.0', trust: 'Self-installed', next_steps: NEXT_STEPS })
    expect(r.proposal_id).toMatch(/^prp_/)
    expect(JSON.stringify(r)).not.toContain(FILE_MARKER)
    expect(w.ctx.db.select().from(plugins).all()).toHaveLength(0)
    const row = w.ctx.db.select().from(pluginProposals).all()
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ id: r.proposal_id, status: 'pending', pluginId: 'agent-note', version: '1.0.0', tokenId: w.tokenId, signature: null, reason: REASON })
    expect(row[0]?.archive.length).toBeGreaterThan(0)
    const audit = w.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.proposal_created')).all()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorType: 'agent', actorId: w.admin.id, targetType: 'plugin_proposal', targetId: r.proposal_id })
    expect(audit[0]?.details).toMatchObject({
      tokenId: w.tokenId,
      proposalId: r.proposal_id,
      pluginId: 'agent-note',
      version: '1.0.0',
      reason: REASON,
      agent: { tokenId: w.tokenId, tokenName: 'Claude at 3am' },
    })
    expect(w.ctx.db.select().from(notifications).all()).toHaveLength(notes)
  })

  it('stays pending under always-allow and a publish-all rule', async () => {
    const w = await world(PUBLISH_ALL)
    enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 1, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    const agent = authenticateAgent(w.ctx, w.secret, null)
    const r = await call(w, 'propose_plugin', { files: textFiles(manifest('allow-note', [noteBlock()])), reason: REASON }, agent)
    expect(r.status).toBe('pending')
    expect(r.next_steps).toBe(NEXT_STEPS)
    expect(w.ctx.db.select().from(plugins).all()).toHaveLength(0)
    expect(w.ctx.db.select().from(pluginProposals).all()[0]?.status).toBe('pending')
  })

  it('refuses an unscoped deny of every action and stores nothing', async () => {
    const w = await world([{ label: 'Nothing', actions: '*', result: 'deny' }])
    const err = await raised(() => call(w, 'propose_plugin', { files: textFiles(manifest('denied-note', [noteBlock()])), reason: REASON }))
    expect(err.code).toBe('rule_denied')
    expect(err.message).toContain('Nothing')
    expect(w.ctx.db.select().from(pluginProposals).all()).toHaveLength(0)
    expect(w.ctx.db.select().from(plugins).all()).toHaveLength(0)
    expect(w.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.proposal_created')).all()).toHaveLength(0)
  })

  it('still stores a proposal when the deny rule is limited to one page', async () => {
    const w = await world([{ label: 'Not the events page', actions: '*', targets: { pagePaths: ['/events'] }, result: 'deny' }])
    const r = await call(w, 'propose_plugin', { files: textFiles(manifest('scoped-note', [noteBlock()])), reason: REASON })
    expect(r.status).toBe('pending')
    expect(w.ctx.db.select().from(pluginProposals).all()).toHaveLength(1)
    expect(w.ctx.db.select().from(plugins).all()).toHaveLength(0)
  })

  it('refuses a file that is not text, and a second pending proposal for the same plugin', async () => {
    const w = await world()
    const bad = await raised(() => call(w, 'propose_plugin', { files: { 'plugin.json': '{}', 'logo.png': 'not-a-picture' }, reason: REASON }))
    expect(bad.code).toBe('validation_failed')
    expect(bad.message).toBe(TEXT_ONLY)
    expect(w.ctx.db.select().from(pluginProposals).all()).toHaveLength(0)
    const files = textFiles(manifest('agent-note', [noteBlock()]))
    const first = await call(w, 'propose_plugin', { files, reason: REASON })
    const again = await raised(() => call(w, 'propose_plugin', { files, reason: REASON }))
    expect(again.code).toBe('conflict')
    expect(again.message).toContain('A proposal for this plugin is already waiting')
    const rows = w.ctx.db.select().from(pluginProposals).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(first.proposal_id)
    expect(rows[0]?.status).toBe('pending')
  })

  it('refuses a read-only token and stores nothing', async () => {
    const w = await world()
    const ro = addToken(w, { name: 'Reader', access: 'read' })
    const err = await raised(() => call(w, 'propose_plugin', { files: textFiles(manifest('agent-note', [noteBlock()])), reason: REASON }, ro.agent))
    expect(err.code).toBe('forbidden')
    expect(w.ctx.db.select().from(pluginProposals).all()).toHaveLength(0)
  })
})

describe('plugin blocks and the agent', () => {
  it('drafts a writable block, sets the money floor only for a money block, and keeps describe off the tool list', async () => {
    const w = await world(PUBLISH_ALL)
    await installPluginArchive(w.ctx, w.admin, pack(kit()), null)
    await allow(w, ['agent-kit/Note', 'agent-kit/Gift'])

    const comps = call(w, 'list_components', {}).components
    const note = comps.find((c: { type: string }) => c.type === 'agent-kit/Note')
    const gift = comps.find((c: { type: string }) => c.type === 'agent-kit/Gift')
    expect(note).toMatchObject({ purpose: MARKER, trust: 'Self-installed', agent_access: 'ok' })
    expect(JSON.stringify(note.props_schema)).toContain('accountRef')
    expect(JSON.stringify(note.props_schema)).toContain('heading')
    expect(gift).toMatchObject({ agent_access: 'draft_only', trust: 'Self-installed' })
    expect(comps.find((c: { type: string }) => c.type === 'Hero').trust).toBeUndefined()
    expect(JSON.stringify(toolList())).not.toContain(MARKER)

    const refused = await raised(() => call(w, 'add_component', { path: '/events', type: 'agent-kit/Note', props: { heading: 'Hello', accountRef: 'acct-1' }, reason: REASON }))
    expect(refused.code).toBe('never_list')
    expect(refused.message).toContain('The prop "accountRef" is closed on this plugin.')
    expect(refused.message).not.toMatch(/donation forms/)
    expect(refused.message).not.toMatch(/binds a section/)

    const hero = draftDoc(w).blocks.find((b) => b.type === 'Hero')
    if (!hero) throw new Error('missing hero')
    const edited = call(w, 'edit_component', { page_id: w.pageId, block_id: hero.id, props: { heading: 'Winter fair' }, reason: REASON })
    expect(draftDoc(w).blocks.find((b) => b.id === hero.id)?.props).toMatchObject({ heading: 'Winter fair' })
    expect(await code(() => call(w, 'edit_component', { page_id: w.pageId, block_id: hero.id, props: { accountRef: 'acct-1' }, reason: REASON }))).not.toBe('never_list')
    call(w, 'discard_change', { change_id: edited.change.id })

    enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { days: 1, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    const agent = authenticateAgent(w.ctx, w.secret, null)
    const plain = call(w, 'add_component', { path: '/events', type: 'agent-kit/Note', props: { heading: 'Hello' }, reason: REASON }, agent)
    expect(plain.if_you_publish.outcome, JSON.stringify(plain.if_you_publish)).toBe('goes_live')
    expect(plain.if_you_publish.reasons.join(' ')).not.toMatch(/money section/)
    call(w, 'discard_change', { change_id: plain.change.id }, agent)
    const money = call(w, 'add_component', { path: '/events', type: 'agent-kit/Gift', props: { heading: 'Hello' }, reason: REASON }, agent)
    expect(money.if_you_publish.outcome).toBe('goes_to_review')
    expect(money.if_you_publish.reasons.join(' ')).toMatch(/money section/)
  })

  it('refuses a block that is not open to agents, including one whose plugin is off', async () => {
    const w = await world(PUBLISH_ALL)
    await installPluginArchive(w.ctx, w.admin, pack(closedDoc()), null)
    const shelf = await installPluginArchive(w.ctx, w.admin, pack(manifest('shelf-note', [noteBlock({ agent: { writable: true, describe: 'A shelf note.' } })])), null)
    await allow(w, ['closed-note/Note', 'shelf-note/Note'])
    const listed = call(w, 'list_components', {}).components.find((c: { type: string }) => c.type === 'closed-note/Note')
    expect(listed).toMatchObject({ agent_access: 'not_for_agents', trust: 'Self-installed' })
    expect(listed.agent_access_meaning).toContain(CLOSED)

    addHuman(w, 'closed-note/Note', { heading: 'Closedzebra', cta: { label: 'Go', href: 'https://closed.example/go' } })
    addHuman(w, 'shelf-note/Note', { heading: 'Stay' })
    const closed = draftDoc(w).blocks.find((b) => b.type === 'closed-note/Note')
    const shelfBlock = draftDoc(w).blocks.find((b) => b.type === 'shelf-note/Note')
    if (!closed || !shelfBlock) throw new Error('missing plugin block')
    const before = JSON.stringify(draftDoc(w))
    const violations = w.ctx.db.select().from(agentCalls).all().filter((c) => c.kind === 'violation').length

    await expectClosed(() => call(w, 'add_component', { path: '/events', type: 'closed-note/Note', props: { heading: 'Nope', cta: { label: 'Go', href: 'https://closed.example/go' } }, reason: REASON }))
    expect(w.ctx.db.select().from(agentCalls).all().filter((c) => c.kind === 'violation').length).toBe(violations + 1)
    await expectClosed(() => call(w, 'create_page', { title: 'Nope', page_type: 'standard', sections: [{ type: 'closed-note/Note', props: { heading: 'Nope', cta: { label: 'Go', href: 'https://closed.example/go' } } }], reason: REASON }))
    await expectClosed(() => call(w, 'create_pages', { pages: [{ title: 'Nope', page_type: 'standard', sections: [{ type: 'closed-note/Note', props: { heading: 'Nope', cta: { label: 'Go', href: 'https://closed.example/go' } } }] }], reason: REASON }))
    await expectClosed(() => call(w, 'edit_component', { page_id: w.pageId, block_id: closed.id, props: { heading: 'Changed' }, reason: REASON }))
    await expectClosed(() => call(w, 'move_component', { page_id: w.pageId, block_id: closed.id, to_index: 0, reason: REASON }))
    await expectClosed(() => call(w, 'remove_component', { page_id: w.pageId, block_id: closed.id, reason: REASON }))
    await expectClosed(() => call(w, 'set_block_css', { page_id: w.pageId, block_id: closed.id, css: 'a { color: inherit; }', reason: REASON }))
    await expectClosed(() => call(w, 'insert_rich_text', { page_id: w.pageId, block_id: closed.id, markdown: 'More words here.', reason: REASON }))
    await expectClosed(() => call(w, 'edit_text', { path: '/events', find: 'Closedzebra', replace: 'Openzebra', reason: REASON }))
    await expectClosed(() => call(w, 'remove_link', { url: 'https://closed.example/go', path: '/events', reason: REASON }))
    await expectClosed(() => call(w, 'replace_link', { url: 'https://closed.example/go', new_url: 'https://closed.example/next', path: '/events', reason: REASON }))
    expect(JSON.stringify(draftDoc(w))).toBe(before)

    await disablePlugin(w.ctx, w.admin, shelf.id)
    expect(w.ctx.registry.has('shelf-note/Note')).toBe(false)
    expect(call(w, 'list_components', {}).components.some((c: { type: string }) => c.type === 'shelf-note/Note')).toBe(false)
    const parked = JSON.stringify(draftDoc(w))
    await expectClosed(() => call(w, 'edit_component', { page_id: w.pageId, block_id: shelfBlock.id, props: { heading: 'Changed' }, reason: REASON }))
    await expectClosed(() => call(w, 'move_component', { page_id: w.pageId, block_id: shelfBlock.id, to_index: 0, reason: REASON }))
    await expectClosed(() => call(w, 'remove_component', { page_id: w.pageId, block_id: shelfBlock.id, reason: REASON }))
    await expectClosed(() => call(w, 'add_component', { path: '/events', type: 'shelf-note/Note', props: { heading: 'Nope' }, reason: REASON }))
    expect(JSON.stringify(draftDoc(w))).toBe(parked)
  })
})

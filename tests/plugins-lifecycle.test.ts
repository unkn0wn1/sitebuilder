import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../shared/ids'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { writeTarGz } from '../shared/plugins/archive'
import { contentHash } from '../shared/plugins/hash'
import { BUNDLE_ID } from '../shared/theme-css'
import { auditEvents, jobs, pages, pluginFiles, pluginProposals, pluginSettings, plugins, releases, versions } from '../server/db/schema'
import { AppError } from '../server/services/errors'
import { createAgentToken } from '../server/services/agent/tokens'
import { createPage, getPage } from '../server/services/pages'
import { installPluginArchive } from '../server/services/plugins/install'
import {
  approvePlugin,
  disablePlugin,
  enablePlugin,
  listPlugins,
  rejectPluginProposal,
  removePluginData,
  savePluginSettings,
  uninstallPlugin,
} from '../server/services/plugins/lifecycle'
import { clearPluginRuntimes } from '../server/services/plugins/runtime'
import { EMPTY_MANIFEST, syncPluginBundleId } from '../server/services/publish'
import { setBlockRegistry } from '../server/utils/state'
import { setup } from './helpers'
import type { ServiceCtx } from '../server/services/context'
import type { ActingAs } from '../server/services/context'

afterEach(() => {
  setBlockRegistry(createDefaultRegistry())
  clearPluginRuntimes()
})

const SCRIPT = 'This plugin asks to load scripts. Version 1 plugins cannot add scripts.'

function manifest(over: Record<string, unknown> = {}) {
  return {
    id: 'hello-note',
    name: 'Hello note',
    version: '1.0.0',
    sitebuilder: '>=0.1.0 <0.2.0',
    permissions: ['blocks'],
    csp: { img: [] as string[], frame: [] as string[], script: [] as string[], connect: [] as string[], font: [] as string[] },
    blocks: [{
      type: 'Note',
      v: 1,
      label: 'Note',
      category: 'Text',
      props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
      template: 'note.html',
      example: { heading: 'Hello' },
    }],
    ...over,
  }
}

function settingsDoc(over: Record<string, unknown> = {}) {
  return manifest({
    permissions: ['blocks', 'settings'],
    settings: {
      type: 'object',
      fields: {
        headline: { type: 'string', max: 40, default: 'Hi' },
        tone: { type: 'string', max: 20, default: 'calm' },
        count: { type: 'number', integer: true, min: 0, max: 10, default: 1 },
        loud: { type: 'boolean', default: false },
        size: { type: 'enum', options: ['s', 'm'], default: 's' },
      },
    },
    ...over,
  })
}

function packed(doc: unknown, html = '<section>Hello</section>') {
  const files = [
    { path: 'plugin.json', bytes: Buffer.from(JSON.stringify(doc)) },
    { path: 'note.html', bytes: Buffer.from(html) },
  ]
  return { archive: writeTarGz(files), hash: contentHash(files).hex }
}

function pack(doc: unknown, html = '<section>Hello</section>') {
  return packed(doc, html).archive
}

async function catchError(run: () => unknown): Promise<AppError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError')
}

function pluginJobs(ctx: ServiceCtx) {
  return ctx.db
    .select()
    .from(jobs)
    .all()
    .filter((job) => job.kind === 'publish' && (job.payload as { rebuild?: string }).rebuild === 'plugins')
}

function pageIdsOf(job: { payload: unknown }): string[] {
  const ids = (job.payload as { pageIds?: unknown }).pageIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

function putBlock(ctx: ServiceCtx, versionId: string) {
  const stored = ctx.db.select().from(versions).where(eq(versions.id, versionId)).get()
  if (!stored) throw new Error('missing version')
  const doc = structuredClone(stored.doc) as { blocks: unknown[] }
  doc.blocks.push({ id: 'b_plugnote1', type: 'hello-note/Note', v: 1, props: { heading: 'Stay' } })
  ctx.db.update(versions).set({ doc: doc as Record<string, unknown> }).where(eq(versions.id, stored.id)).run()
}

describe('plugin lifecycle', () => {
  it('installs a no-origin package, enables and disables it, and queues live pages only', async () => {
    const { ctx, admin } = setup()
    expect(BUNDLE_ID).toBe('theme-default-5')
    const live = createPage(ctx, admin, { title: 'Live note', template: 'standard' })
    const draft = createPage(ctx, admin, { title: 'Draft note', template: 'standard' })
    const hidden = createPage(ctx, admin, { title: 'Hidden note', template: 'standard' })
    const liveVersion = live.page.draftVersionId
    if (!liveVersion || !hidden.page.draftVersionId) throw new Error('missing draft')
    putBlock(ctx, liveVersion)
    ctx.db.update(pages).set({ publishedVersionId: liveVersion, publishedPath: live.page.path, workflowState: 'published' }).where(eq(pages.id, live.page.id)).run()
    ctx.db.update(pages).set({ publishedVersionId: hidden.page.draftVersionId, publishedPath: hidden.page.path, workflowState: 'unpublished' }).where(eq(pages.id, hidden.page.id)).run()

    const installed = await installPluginArchive(ctx, admin, pack(manifest()), null)
    expect(installed).toMatchObject({ status: 'enabled', pluginId: 'hello-note', version: '1.0.0', trust: 'self' })
    expect(ctx.registry.has('hello-note/Note')).toBe(true)
    const auditRow = ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.installed')).all()
    expect(auditRow).toHaveLength(1)
    expect(auditRow[0]?.details).toMatchObject({ pluginId: 'hello-note', version: '1.0.0', trust: 'self', status: 'enabled' })
    const listed = listPlugins(ctx, admin)
    expect(listed.plugins[0]).toMatchObject({ pluginId: 'hello-note', trust: 'Self-installed', status: 'enabled', origins: [] })

    const manifestCopy = structuredClone(EMPTY_MANIFEST)
    expect(syncPluginBundleId(ctx, manifestCopy)).toBe(true)
    expect(manifestCopy.pluginBundleId).toMatch(/^theme-default-5-[0-9a-f]{12}$/)
    expect(manifestCopy.pluginBundleId).not.toBe(BUNDLE_ID)
    expect(manifestCopy.bundleId).toBe('dev')
    expect(syncPluginBundleId(ctx, manifestCopy)).toBe(false)

    const disabled = await disablePlugin(ctx, admin, installed.id)
    expect(disabled.pageIds).toEqual([live.page.id])
    expect(ctx.registry.has('hello-note/Note')).toBe(false)
    const loaded = getPage(ctx, live.page.id)
    expect(loaded.doc.blocks.find((block) => block.type === 'hello-note/Note')?.props).toMatchObject({ heading: 'Stay' })
    expect(syncPluginBundleId(ctx, manifestCopy)).toBe(true)
    expect(manifestCopy.pluginBundleId).toBeUndefined()

    const enabled = await enablePlugin(ctx, admin, installed.id)
    expect(enabled.pageIds).toEqual([live.page.id])
    expect(enabled.pageIds).not.toContain(draft.page.id)
    expect(enabled.pageIds).not.toContain(hidden.page.id)
    expect(ctx.registry.has('hello-note/Note')).toBe(true)
    const queued = pluginJobs(ctx)
    expect(queued.length).toBeGreaterThanOrEqual(3)
    for (const job of queued) {
      expect(job.state).toBe('queued')
      expect(pageIdsOf(job)).toEqual([live.page.id])
    }
    expect(ctx.db.select().from(jobs).where(eq(jobs.kind, 'purge_cache')).all()).toHaveLength(0)
    expect(ctx.db.select().from(releases).all()).toHaveLength(0)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.disabled')).all()).toHaveLength(1)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.enabled')).all()).toHaveLength(1)
  })

  it('holds an image origin for the owner and forbids a plain admin from approving it', async () => {
    const { ctx, admin } = setup()
    const waiting = manifest({
      id: 'origin-note',
      csp: { img: ['https://images.example'], frame: [], script: [], connect: [], font: [] },
    })
    const pending = await installPluginArchive(ctx, admin, pack(waiting), null)
    expect(pending.status).toBe('needs_owner')
    expect(ctx.registry.has('origin-note/Note')).toBe(false)
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'origin-note')).get()?.status).toBe('pending_owner')
    expect(pluginJobs(ctx)).toHaveLength(0)
    const listed = listPlugins(ctx, admin)
    expect(listed.plugins[0]?.origins).toEqual([{ directive: 'img', origin: 'https://images.example' }])
    expect(listed.plugins[0]?.trust).toBe('Self-installed')

    const enableDenied = await catchError(() => enablePlugin(ctx, admin, pending.id))
    expect(enableDenied.code).toBe('forbidden')
    const approveDenied = await catchError(() => approvePlugin(ctx, admin, pending.id))
    expect(approveDenied.code).toBe('forbidden')
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'origin-note')).get()?.status).toBe('pending_owner')
    expect(ctx.registry.has('origin-note/Note')).toBe(false)

    const owner: ActingAs = { ...admin, isOperator: true }
    const approved = await approvePlugin(ctx, owner, pending.id)
    expect(approved).toMatchObject({ status: 'enabled', pluginId: 'origin-note' })
    expect(ctx.registry.has('origin-note/Note')).toBe(true)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.approved')).all()).toHaveLength(1)
    const queued = pluginJobs(ctx)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.state).toBe('queued')
    expect(ctx.db.select().from(releases).all()).toHaveLength(0)
  })

  it('refuses a script origin before a row is stored', async () => {
    const { ctx, admin } = setup()
    const doc = manifest({ csp: { img: [], frame: [], script: ['https://cdn.example'], connect: [], font: [] } })
    const err = await catchError(() => installPluginArchive(ctx, admin, pack(doc), null))
    expect(err.message).toBe(SCRIPT)
    expect(err.fields?.some((field) => field.message === SCRIPT)).toBe(true)
    expect(ctx.db.select().from(plugins).all()).toHaveLength(0)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.installed')).all()).toHaveLength(0)
  })

  it('runs a rename migration when a patch upgrade raises the block version', async () => {
    const { ctx, admin } = setup()
    await installPluginArchive(ctx, admin, pack(manifest()), null)
    const next = manifest({
      version: '1.0.1',
      blocks: [{
        type: 'Note',
        v: 2,
        label: 'Note',
        category: 'Text',
        props: { type: 'object', fields: { title: { type: 'string', max: 80, required: true } } },
        template: 'note.html',
        example: { title: 'Hello' },
      }],
      migrations: { Note: { '1->2': 'rename:heading->title' } },
    })
    const upgraded = await installPluginArchive(ctx, admin, pack(next), null)
    expect(upgraded).toMatchObject({ status: 'enabled', version: '1.0.1' })
    const migrated = ctx.registry.migrate({ id: 'b_old00001', type: 'hello-note/Note', v: 1, props: { heading: 'Stay' } })
    expect(migrated).toMatchObject({ v: 2, props: { title: 'Stay' } })
    expect(migrated.props.heading).toBeUndefined()
    expect(ctx.registry.get('hello-note/Note')?.version).toBe(2)
  })

  it('refuses a block downgrade when a stored section is newer', async () => {
    const { ctx, admin } = setup()
    await installPluginArchive(ctx, admin, pack(manifest()), null)
    ctx.db.insert(versions).values({
      id: 'ver_plugdowngrade000000000001',
      siteId: ctx.siteId,
      targetType: 'page',
      targetId: 'pg_plugdowngrade',
      number: 1,
      doc: { blocks: [{ type: 'hello-note/Note', v: 9, props: { heading: 'stored-heading-token' } }] },
      schemaVersion: 1,
      kind: 'published',
      actorKey: `user:${admin.id}`,
      authorId: admin.id,
      sealed: true,
      createdAt: ctx.now().toISOString(),
      updatedAt: ctx.now().toISOString(),
    }).run()
    const err = await catchError(() => installPluginArchive(ctx, admin, pack(manifest({ version: '1.0.1' })), null))
    expect(err.message).toBe('Stored sections use a newer version of this block.')
    expect(JSON.stringify(err.toBody())).not.toContain('stored-heading-token')
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'hello-note')).get()?.version).toBe('1.0.0')
  })

  it('rejects a settings value without echoing it', async () => {
    const { ctx, admin } = setup()
    const installed = await installPluginArchive(ctx, admin, pack(settingsDoc()), null)
    const secret = 'rejected-secret-value-do-not-echo-this-back'
    const err = await catchError(() => savePluginSettings(ctx, admin, installed.id, { headline: secret, [secret]: secret }))
    expect(err.code).toBe('validation_failed')
    expect(JSON.stringify(err.toBody())).not.toContain(secret)
    expect(err.message).not.toContain(secret)
    expect(ctx.db.select().from(pluginSettings).all()).toHaveLength(0)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.settings')).all()).toHaveLength(0)
  })

  it('uninstalls files, keeps the section, and removes settings only with the confirm phrase', async () => {
    const { ctx, admin } = setup()
    const installed = await installPluginArchive(ctx, admin, pack(settingsDoc()), null)
    const saved = await savePluginSettings(ctx, admin, installed.id, { headline: 'Keep me' })
    expect(saved.pluginId).toBe('hello-note')
    expect(ctx.db.select().from(pluginSettings).where(eq(pluginSettings.pluginId, 'hello-note')).get()?.doc).toEqual({
      headline: 'Keep me',
      tone: 'calm',
      count: 1,
      loud: false,
      size: 's',
    })
    const page = createPage(ctx, admin, { title: 'Keeps the note', template: 'standard' })
    if (!page.page.draftVersionId) throw new Error('missing draft')
    putBlock(ctx, page.page.draftVersionId)

    await uninstallPlugin(ctx, admin, installed.id)
    expect(ctx.db.select().from(plugins).all()).toHaveLength(0)
    expect(ctx.db.select().from(pluginFiles).where(eq(pluginFiles.pluginId, 'hello-note')).all()).toHaveLength(0)
    expect(ctx.db.select().from(pluginSettings).where(eq(pluginSettings.pluginId, 'hello-note')).get()?.doc).toMatchObject({ headline: 'Keep me' })
    expect(ctx.registry.has('hello-note/Note')).toBe(false)
    const still = getPage(ctx, page.page.id)
    expect(still.doc.blocks.some((block) => block.type === 'hello-note/Note' && block.props.heading === 'Stay')).toBe(true)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.uninstalled')).all()).toHaveLength(1)

    const secret = 'rejected-secret-value-do-not-echo-this-back'
    const wrong = await catchError(() => removePluginData(ctx, admin, 'hello-note', secret))
    expect(wrong.code).toBe('validation_failed')
    expect(JSON.stringify(wrong.toBody())).not.toContain(secret)
    expect(ctx.db.select().from(pluginSettings).all()).toHaveLength(1)

    removePluginData(ctx, admin, 'hello-note', 'remove plugin data')
    expect(ctx.db.select().from(pluginSettings).all()).toHaveLength(0)
    const removed = ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.data_removed')).all()
    expect(removed).toHaveLength(1)
    expect(removed[0]?.details).toMatchObject({ pluginId: 'hello-note', doc: { headline: 'Keep me', tone: 'calm' } })
    expect(ctx.db.select().from(jobs).where(eq(jobs.kind, 'backup')).all()).toHaveLength(0)
    expect(getPage(ctx, page.page.id).doc.blocks.some((block) => block.type === 'hello-note/Note')).toBe(true)
  })

  it('lists proposals and lets a person approve or reject them', async () => {
    const { ctx, admin, editor } = setup()
    const { token } = createAgentToken(ctx, admin, { name: 'Night editor', access: 'draft' })
    const note = packed(manifest({ id: 'proposed-note' }))
    const img = packed(manifest({
      id: 'proposed-img',
      csp: { img: ['https://images.example'], frame: [], script: [], connect: [], font: [] },
    }))
    const rejectedPack = packed(manifest({ id: 'proposed-no' }))
    const ids = [note, img, rejectedPack].map((item, index) => {
      const id = newId('pluginProposal', ctx.now().getTime() + index)
      const pluginId = index === 0 ? 'proposed-note' : index === 1 ? 'proposed-img' : 'proposed-no'
      ctx.db.insert(pluginProposals).values({
        id,
        siteId: ctx.siteId,
        tokenId: token.id,
        agentLabel: 'Night editor',
        status: 'pending',
        archive: item.archive,
        signature: null,
        contentHash: item.hash,
        pluginId,
        version: '1.0.0',
        reason: 'Please review this package.',
        createdAt: ctx.now().toISOString(),
      }).run()
      return id
    })
    const noteId = ids[0]
    const imgId = ids[1]
    const noId = ids[2]
    if (!noteId || !imgId || !noId) throw new Error('missing proposal id')

    const listed = listPlugins(ctx, admin)
    expect(listed.proposals.map((item) => item.pluginId).sort()).toEqual(['proposed-img', 'proposed-no', 'proposed-note'])
    expect(listed.proposals.every((item) => item.trust === 'Self-installed' && item.agentLabel === 'Night editor')).toBe(true)

    const denied = await catchError(() => approvePlugin(ctx, editor, noteId))
    expect(denied.code).toBe('forbidden')
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'proposed-note')).get()).toBeUndefined()

    const approved = await approvePlugin(ctx, admin, noteId)
    expect(approved).toMatchObject({ status: 'enabled', pluginId: 'proposed-note', trust: 'self' })
    expect(ctx.registry.has('proposed-note/Note')).toBe(true)
    expect(ctx.db.select().from(pluginProposals).where(eq(pluginProposals.id, noteId)).get()?.status).toBe('approved')

    const held = await approvePlugin(ctx, admin, imgId)
    expect(held.status).toBe('needs_owner')
    expect(ctx.registry.has('proposed-img/Note')).toBe(false)
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'proposed-img')).get()?.status).toBe('pending_owner')

    const rejectDenied = await catchError(() => rejectPluginProposal(ctx, editor, noId))
    expect(rejectDenied.code).toBe('forbidden')
    rejectPluginProposal(ctx, admin, noId)
    expect(ctx.db.select().from(pluginProposals).where(eq(pluginProposals.id, noId)).get()?.status).toBe('rejected')
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'proposed-no')).get()).toBeUndefined()
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.proposal_rejected')).all()).toHaveLength(1)
    expect(ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.proposal_created')).all()).toHaveLength(0)
    expect(listPlugins(ctx, admin).proposals).toHaveLength(0)
  })

  it('keeps the settings copy and the catalog route in the words the screen uses', () => {
    const page = readFileSync(new URL('../app/pages/settings/plugins/index.vue', import.meta.url), 'utf8')
    expect(page).toContain('An owner has to approve this plugin before it can load those addresses.')
    expect(page).toContain('No external origins')
    expect(page).toContain('Remove plugin data')
    expect(page).toContain('remove plugin data')
    expect(page).toContain('plugin.trust')
    expect(page).toContain('proposal.trust')
    expect(page).toContain('SettingsNav')
    expect(page).toContain('sb-page')
    expect(page).not.toContain('\u2014')
    const areas = readFileSync(new URL('../app/utils/settings-areas.ts', import.meta.url), 'utf8')
    expect(areas).toContain("{ to: '/settings/plugins', label: 'Plugins', note: 'Install a declarative plugin, turn it on, and set its options.', need: 'settings.manage', icon: 'strip' }")
    const theming = readFileSync(new URL('../docs/11-theming.md', import.meta.url), 'utf8')
    expect(theming).toContain("the site CSS, plugin CSS, then each section's CSS.")
    expect(theming).toContain('89,143')
    expect(theming).toContain('**29751 bytes**')
    const catalog = readFileSync(new URL('../server/api/v1/plugins/catalog.get.ts', import.meta.url), 'utf8')
    expect(catalog).toContain('requireActor(event)')
    expect(catalog).not.toContain('requireCan')
    const approve = readFileSync(new URL('../server/api/v1/plugins/[id]/approve.post.ts', import.meta.url), 'utf8')
    expect(approve).toContain('requireActor(event)')
    expect(approve).not.toMatch(/requireCan\(/)
    const list = readFileSync(new URL('../server/api/v1/plugins/index.get.ts', import.meta.url), 'utf8')
    expect(list).toContain("requireCan(event, 'settings.manage')")
  })
})

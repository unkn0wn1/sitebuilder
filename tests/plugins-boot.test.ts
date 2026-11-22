import { generateKeyPairSync } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { auditEvents, pluginFiles, pluginSettings, plugins, versions } from '../server/db/schema'
import { installPluginArchive } from '../server/services/plugins/install'
import { bootPlugins, effectiveBundleId } from '../server/services/plugins/load'
import { AppError } from '../server/services/errors'
import { getBlockRegistry, setBlockRegistry } from '../server/utils/state'
import { createDefaultRegistry, BlockMigrationError } from '../shared/blocks/registry'
import { encodeRawTar } from '../shared/plugins/archive'
import { contentHash } from '../shared/plugins/hash'
import { writeTarGz } from '../shared/plugins/archive'
import { migratePageDoc, validatePageDoc } from '../shared/page'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature } from '../shared/plugins/signature'
import { BUNDLE_ID } from '../shared/theme-css'
import { setup } from './helpers'

afterEach(() => {
  setBlockRegistry(createDefaultRegistry())
})

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

function pack(doc: unknown, html = '<section>Hello</section>') {
  return writeTarGz([
    { path: 'plugin.json', bytes: Buffer.from(JSON.stringify(doc)) },
    { path: 'note.html', bytes: Buffer.from(html) },
  ])
}

function catchError(run: () => void): AppError {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected an AppError')
}

describe('plugin install and boot', () => {
  it('installs an unsigned package for an admin and keeps a slash page that has no plugin', () => {
    const { ctx, admin, editor } = setup()
    const denied = catchError(() => installPluginArchive(ctx, editor, pack(manifest()), null))
    expect(denied.code).toBe('forbidden')

    const slipped = gzipSync(encodeRawTar([{ name: Buffer.from('../x'), typeflag: 48, data: Buffer.from('x') }]))
    const rejected = catchError(() => installPluginArchive(ctx, admin, slipped, null))
    expect(rejected.code).toBe('validation_failed')
    expect(rejected.fields).toEqual([{ path: '(archive)', message: 'A file path in the archive is not allowed.' }])
    expect(rejected.message.includes('..')).toBe(false)

    const badJson = writeTarGz([
      { path: 'plugin.json', bytes: Buffer.from('not-json {') },
      { path: 'note.html', bytes: Buffer.from('<section>Hello</section>') },
    ])
    const unreadable = catchError(() => installPluginArchive(ctx, admin, badJson, null))
    expect(unreadable.fields).toEqual([{ path: 'plugin.json', message: 'plugin.json is not valid JSON.' }])
    expect(unreadable.message.includes('not-json')).toBe(false)

    const result = installPluginArchive(ctx, admin, pack(manifest()), null)
    expect(result).toMatchObject({ status: 'enabled', pluginId: 'hello-note', version: '1.0.0', trust: 'self' })
    expect(ctx.registry.has('hello-note/Note')).toBe(true)
    expect(getBlockRegistry().has('Hero')).toBe(true)
    expect(getBlockRegistry().get('hello-note/Note')?.plugin).toMatchObject({ id: 'hello-note', trust: 'self', writable: false, money: false })

    const events = ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.installed')).all()
    expect(events).toHaveLength(1)
    expect(events[0]?.details).toMatchObject({ pluginId: 'hello-note', version: '1.0.0', trust: 'self', status: 'enabled' })
    expect(JSON.stringify(events[0]?.details).includes('<section>')).toBe(false)

    const again = catchError(() => installPluginArchive(ctx, admin, pack(manifest()), null))
    expect(again.code).toBe('conflict')
    expect(again.message).toBe('This plugin is already installed at this version.')

    const registry = createDefaultRegistry()
    const raw = {
      schemaVersion: 1,
      title: 'Stay',
      seo: {},
      blocks: [{ id: 'b_plug0001', type: 'missing/Widget', v: 1, props: { heading: 'Stay' } }],
    }
    const doc = migratePageDoc(raw, registry)
    expect(doc.blocks[0]).toMatchObject({ type: 'missing/Widget', v: 1, props: { heading: 'Stay' } })
    const checked = validatePageDoc(doc, registry, {
      schemaVersion: 1,
      label: 'Landing',
      allowedBlocks: ['missing/Widget'],
      requiredBlocks: [],
      startingBlocks: [],
    })
    expect(checked.ok).toBe(true)
    expect(() => registry.migrate({ id: 'b_hero0001', type: 'Herro', v: 1, props: {} })).toThrow(BlockMigrationError)
    expect(() => registry.migrate({ id: 'b_hero0001', type: 'Herro', v: 1, props: {} })).toThrow(/Unknown section type "Herro"/)
  })

  it('keeps settings on upgrade, refuses a newer install and a block downgrade', () => {
    const { ctx, admin, clock } = setup()
    const settings = {
      type: 'object',
      fields: {
        headline: { type: 'string', max: 40, default: 'Hi' },
        tone: { type: 'string', max: 20, default: 'calm' },
      },
    }
    const first = installPluginArchive(ctx, admin, pack(manifest({ permissions: ['blocks', 'settings'], settings })), null)
    expect(first.status).toBe('enabled')
    const installedAt = ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'hello-note')).get()?.installedAt
    ctx.db.insert(pluginSettings).values({
      siteId: ctx.siteId,
      pluginId: 'hello-note',
      doc: { extra: 'drop-me', headline: 'Keep' },
      updatedAt: ctx.now().toISOString(),
      updatedBy: admin.id,
    }).run()
    clock.advance(1000)
    const upgraded = installPluginArchive(ctx, admin, pack(manifest({ version: '1.0.1', permissions: ['blocks', 'settings'], settings })), null)
    expect(upgraded).toMatchObject({ status: 'enabled', version: '1.0.1' })
    const row = ctx.db.select().from(pluginSettings).where(eq(pluginSettings.pluginId, 'hello-note')).get()
    expect(row?.doc).toEqual({ headline: 'Keep', tone: 'calm' })
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'hello-note')).get()?.installedAt).toBe(installedAt)

    const older = catchError(() => installPluginArchive(ctx, admin, pack(manifest({ version: '1.0.0', permissions: ['blocks', 'settings'], settings })), null))
    expect(older.message).toBe('A newer version is already installed.')

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
    const downgrade = catchError(() => installPluginArchive(ctx, admin, pack(manifest({
      version: '1.0.2',
      permissions: ['blocks', 'settings'],
      settings,
      blocks: [{
        type: 'Note',
        v: 1,
        label: 'Note',
        category: 'Text',
        props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
        template: 'note.html',
        example: { heading: 'Hello' },
      }],
    })), null))
    expect(downgrade.message).toBe('Stored sections use a newer version of this block.')
    expect(downgrade.message.includes('stored-heading-token')).toBe(false)
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'hello-note')).get()?.version).toBe('1.0.1')
  })

  it('holds a package that needs an origin until the owner installs one', () => {
    const { ctx, admin } = setup()
    const waiting = manifest({
      id: 'origin-note',
      csp: { img: ['https://images.example'], frame: [], script: [], connect: [], font: [] },
    })
    const pending = installPluginArchive(ctx, admin, pack(waiting), null)
    expect(pending.status).toBe('needs_owner')
    if (pending.status !== 'needs_owner') throw new Error('expected owner review')
    expect(pending.origins).toEqual([{ directive: 'img', origin: 'https://images.example' }])
    expect(pending.trust).toBe('self')
    expect(getBlockRegistry().has('origin-note/Note')).toBe(false)
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'origin-note')).get()?.status).toBe('pending_owner')
    expect(ctx.db.select().from(pluginFiles).where(eq(pluginFiles.pluginId, 'origin-note')).all().length).toBeGreaterThan(0)

    const owned = manifest({ id: 'owner-note', csp: { img: ['https://images.example'], frame: [], script: [], connect: [], font: [] } })
    const enabled = installPluginArchive(ctx, { ...admin, isOperator: true }, pack(owned), null)
    expect(enabled).toMatchObject({ status: 'enabled', pluginId: 'owner-note', trust: 'self' })
    expect(getBlockRegistry().has('owner-note/Note')).toBe(true)
    expect(getBlockRegistry().has('origin-note/Note')).toBe(false)
    expect(getBlockRegistry().has('Hero')).toBe(true)
  })

  it('renames stored props and still refuses a stored block from a newer version', () => {
    const { ctx, admin } = setup()
    const doc = manifest({
      blocks: [{
        type: 'Note',
        v: 2,
        label: 'Note',
        category: 'Text',
        props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
        template: 'note.html',
        example: { heading: 'Hello' },
        migrations: undefined,
      }],
      migrations: { Note: { '1->2': 'rename:title->heading' } },
    })
    installPluginArchive(ctx, admin, pack(doc), null)
    const migrated = getBlockRegistry().migrate({ id: 'b_old00001', type: 'hello-note/Note', v: 1, props: { title: 'Stay' } })
    expect(migrated).toMatchObject({ v: 2, props: { heading: 'Stay' } })
    expect(migrated.props.title).toBeUndefined()
    expect(() => getBlockRegistry().migrate({ id: 'b_new00001', type: 'hello-note/Note', v: 3, props: { heading: 'Hello' } })).toThrow(/newer version/)
  })

  it('disables one corrupt plugin on boot and keeps the healthy one', () => {
    const { ctx, admin } = setup()
    installPluginArchive(ctx, admin, pack(manifest({ id: 'alpha-note' })), null)
    installPluginArchive(ctx, admin, pack(manifest({ id: 'beta-note' })), null)
    ctx.db.update(plugins).set({ contentHash: '0'.repeat(64) }).where(eq(plugins.pluginId, 'alpha-note')).run()
    const lines: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
      lines.push(String(line))
    })
    bootPlugins(ctx.db, ctx.now())
    spy.mockRestore()
    const alpha = ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'alpha-note')).get()
    const beta = ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'beta-note')).get()
    expect(alpha?.status).toBe('disabled')
    expect(alpha?.statusMessage).toBe('The stored files do not match this plugin.')
    expect(beta?.status).toBe('enabled')
    expect(getBlockRegistry().has('Hero')).toBe(true)
    expect(getBlockRegistry().has('beta-note/Note')).toBe(true)
    expect(getBlockRegistry().has('alpha-note/Note')).toBe(false)
    expect(ctx.db.select().from(pluginFiles).where(eq(pluginFiles.pluginId, 'alpha-note')).all().length).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('plugin disabled on boot') && line.includes('alpha-note'))).toBe(true)
    expect(lines.join('\n').includes('<section>')).toBe(false)
  })

  it('builds a bundle id from enabled plugins without changing the theme id', () => {
    expect(BUNDLE_ID).toBe('theme-default-5')
    expect(effectiveBundleId([])).toBe(BUNDLE_ID)
    const alpha = { pluginId: 'beta-note', version: '1.0.0', contentHash: 'ab'.repeat(32) }
    const beta = { pluginId: 'alpha-note', version: '1.0.0', contentHash: 'cd'.repeat(32) }
    expect(effectiveBundleId([alpha, beta])).toBe(effectiveBundleId([beta, alpha]))
    expect(effectiveBundleId([alpha])).toMatch(/^theme-default-5-[0-9a-f]{12}$/)
  })

  it('stores a signed unknown key as self-installed and refuses an unreadable stored version', () => {
    const { ctx, admin } = setup()
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const raw = rawEd25519PublicKey(publicKey)
    const archive = pack(manifest())
    const hashed = contentHash([{ path: 'plugin.json', bytes: Buffer.from(JSON.stringify(manifest())) }, { path: 'note.html', bytes: Buffer.from('<section>Hello</section>') }])
    const signature = signPluginSignature({
      privateKey,
      publicKey: raw,
      contentHash: hashed.raw,
      pluginId: 'hello-note',
      version: '1.0.0',
    })
    const installed = installPluginArchive(ctx, admin, archive, Buffer.from(signature))
    expect(installed.trust).toBe('self')
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'hello-note')).get()?.signingKeyId).toBe(officialKeyId(raw))

    ctx.db.update(plugins).set({ version: 'nope' }).where(eq(plugins.pluginId, 'hello-note')).run()
    const clash = catchError(() => installPluginArchive(ctx, admin, pack(manifest({ version: '1.0.1' })), null))
    expect(clash.code).toBe('conflict')
    expect(clash.message).toBe('This plugin is already installed at this version.')
    expect(ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'hello-note')).get()?.version).toBe('nope')
  })
})

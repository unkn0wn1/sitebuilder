// Install a plugin archive. Human review stays in front of enable when origins are involved.
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { newId } from '../../../shared/ids'
import type { FieldIssue } from '../../../shared/issues'
import { ArchiveError, readTarGz } from '../../../shared/plugins/archive'
import { contentHash } from '../../../shared/plugins/hash'
import { OFFICIAL_KEYS } from '../../../shared/plugins/keys'
import { parseManifest, type PluginManifest, type PluginOrigin } from '../../../shared/plugins/manifest'
import { compileObjectSchema } from '../../../shared/plugins/schema-subset'
import { compareSemver } from '../../../shared/plugins/semver'
import { SIGNATURE_UNREADABLE, decideTrust } from '../../../shared/plugins/signature'
import { can } from '../../../shared/roles'
import { pluginFiles, pluginSettings, plugins, versions } from '../../db/schema'
import { audit } from '../audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from '../context'
import { AppError, forbidden } from '../errors'
import { applyPluginRegistry } from './load'
import { testRenderPlugin } from './render-check'

export type PluginTrust = 'official' | 'self'

export type InstallResult =
  | { status: 'enabled'; id: string; pluginId: string; version: string; trust: PluginTrust }
  | {
      status: 'needs_owner'
      id: string
      pluginId: string
      version: string
      trust: PluginTrust
      origins: PluginOrigin[]
      permissions: string[]
    }

function reject(issues: FieldIssue[]): never {
  throw new AppError('validation_failed', issues[0]?.message ?? 'The plugin was rejected.', issues)
}

function readManifestBytes(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    reject([{ path: 'plugin.json', message: 'plugin.json is not valid JSON.' }])
  }
}

function signatureText(signature: Buffer | null): string | null {
  if (signature === null) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(signature)
  } catch {
    return ''
  }
}

function storedBlockVersions(doc: unknown): { type: string; v: number }[] {
  if (!doc || typeof doc !== 'object') return []
  const blocks = (doc as { blocks?: unknown }).blocks
  if (!Array.isArray(blocks)) return []
  const out: { type: string; v: number }[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const type = (block as { type?: unknown }).type
    const version = (block as { v?: unknown }).v
    if (typeof type === 'string' && typeof version === 'number') out.push({ type, v: version })
  }
  return out
}

function reconcileSettings(previous: unknown, manifest: PluginManifest): Record<string, unknown> {
  const prev = previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {}
  if (!manifest.settings) return {}
  const compiled = compileObjectSchema(manifest.settings, { path: 'settings', mode: 'settings' })
  if (!compiled.schema) return {}
  const next: Record<string, unknown> = {}
  for (const field of compiled.settingsFields) {
    if (Object.prototype.hasOwnProperty.call(prev, field.key)) {
      const parsed = field.schema.safeParse(prev[field.key])
      if (parsed.success) {
        next[field.key] = parsed.data
        continue
      }
    }
    if (field.hasDefault) next[field.key] = field.defaultValue
  }
  return next
}

export async function installPluginArchive(ctx: ServiceCtx, actor: ActingAs, archive: Buffer, signature: Buffer | null): Promise<InstallResult> {
  if (!can(actor, 'settings.manage')) throw forbidden()
  let files: { path: string; bytes: Buffer }[]
  try {
    files = readTarGz(archive).files
  } catch (error) {
    if (error instanceof ArchiveError) reject([{ path: error.path, message: error.message }])
    throw error
  }
  const hashed = contentHash(files)
  const manifestFile = files.find((file) => file.path === 'plugin.json')
  if (!manifestFile) reject([{ path: 'plugin.json', message: 'The archive must include plugin.json.' }])
  const raw = readManifestBytes(manifestFile.bytes)
  const parsed = parseManifest(raw, new Map(files.map((file) => [file.path, file.bytes])))
  if (!parsed.ok) reject(parsed.issues)
  const { manifest, origins } = parsed.value
  const verdict = decideTrust({
    signature: signatureText(signature),
    contentHash: hashed.raw,
    pluginId: manifest.id,
    version: manifest.version,
    keys: OFFICIAL_KEYS,
  })
  if (!verdict.ok) reject([{ path: 'signature', message: verdict.message || SIGNATURE_UNREADABLE }])
  const rendered = await testRenderPlugin({ manifest, files })
  if (!rendered.ok) reject([{ path: rendered.path, message: rendered.message }])

  const needsOwner = origins.length > 0 && !actor.isOperator
  const status: 'pending_owner' | 'enabled' = needsOwner ? 'pending_owner' : 'enabled'
  const existing = ctx.db
    .select()
    .from(plugins)
    .where(and(eq(plugins.siteId, ctx.siteId), eq(plugins.pluginId, manifest.id)))
    .get()
  if (existing) {
    const cmp = compareSemver(existing.version, manifest.version)
    if (cmp === null || cmp === 0) throw new AppError('conflict', 'This plugin is already installed at this version.')
    if (cmp > 0) throw new AppError('conflict', 'A newer version is already installed.')
  }
  const incoming = new Map(manifest.blocks.map((block) => [`${manifest.id}/${block.type}`, block.v]))
  const docs = ctx.db.select({ doc: versions.doc }).from(versions).where(eq(versions.siteId, ctx.siteId)).all()
  for (const doc of docs) {
    for (const block of storedBlockVersions(doc.doc)) {
      const cap = incoming.get(block.type)
      if (cap !== undefined && block.v > cap) reject([{ path: 'version', message: 'Stored sections use a newer version of this block.' }])
    }
  }

  const rowId = existing?.id ?? newId('plugin', ctx.now().getTime())
  const installedAt = existing?.installedAt ?? iso(ctx)
  inTx(ctx, () => {
    const values = {
      siteId: ctx.siteId,
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      coreRange: manifest.sitebuilder,
      contentHash: hashed.hex,
      trust: verdict.trust,
      signingKeyId: verdict.keyId,
      status,
      statusMessage: null,
      manifestJson: manifest as unknown as Record<string, unknown>,
      permissionsJson: manifest.permissions,
      cspJson: manifest.csp,
      installedBy: actor.id,
      installedAt,
      updatedAt: iso(ctx),
    }
    if (existing) ctx.db.update(plugins).set(values).where(eq(plugins.id, existing.id)).run()
    else ctx.db.insert(plugins).values({ id: rowId, ...values }).run()
    ctx.db.delete(pluginFiles).where(and(eq(pluginFiles.siteId, ctx.siteId), eq(pluginFiles.pluginId, manifest.id))).run()
    for (const file of files) {
      ctx.db
        .insert(pluginFiles)
        .values({
          id: newId('pluginFile', ctx.now().getTime()),
          siteId: ctx.siteId,
          pluginId: manifest.id,
          path: file.path,
          sha256: createHash('sha256').update(file.bytes).digest('hex'),
          size: file.bytes.length,
          bytes: file.bytes,
        })
        .run()
    }
    const settings = ctx.db
      .select()
      .from(pluginSettings)
      .where(and(eq(pluginSettings.siteId, ctx.siteId), eq(pluginSettings.pluginId, manifest.id)))
      .get()
    if (settings) {
      ctx.db
        .update(pluginSettings)
        .set({ doc: reconcileSettings(settings.doc, manifest), updatedAt: iso(ctx), updatedBy: actor.id })
        .where(and(eq(pluginSettings.siteId, ctx.siteId), eq(pluginSettings.pluginId, manifest.id)))
        .run()
    }
    audit(ctx, actor, 'plugin.installed', { type: 'plugin', id: rowId }, {
      pluginId: manifest.id,
      version: manifest.version,
      trust: verdict.trust,
      status,
      contentHash: hashed.hex,
    })
  })
  const registry = await applyPluginRegistry(ctx)
  const storedType = `${manifest.id}/${manifest.blocks[0]?.type ?? ''}`
  if (status === 'enabled' && !registry.has(storedType)) reject([{ path: '(plugin)', message: 'This plugin could not be loaded.' }])
  if (status === 'pending_owner') {
    return { status: 'needs_owner', id: rowId, pluginId: manifest.id, version: manifest.version, trust: verdict.trust, origins, permissions: manifest.permissions }
  }
  return { status: 'enabled', id: rowId, pluginId: manifest.id, version: manifest.version, trust: verdict.trust }
}

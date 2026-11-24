// Enable, disable, settings, uninstall, and proposal review. Install stays in install.ts.
import { and, eq } from 'drizzle-orm'
import type { BlockRegistry } from '../../../shared/blocks/registry'
import { hasPrefix } from '../../../shared/ids'
import { zodIssues, type FieldIssue } from '../../../shared/issues'
import type { PluginManifest, PluginOrigin } from '../../../shared/plugins/manifest'
import { compileObjectSchema } from '../../../shared/plugins/schema-subset'
import { decideTrust } from '../../../shared/plugins/signature'
import { can } from '../../../shared/roles'
import { pluginFiles, pluginProposals, pluginSettings, plugins } from '../../db/schema'
import { audit } from '../audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from '../context'
import { AppError, forbidden, notFound } from '../errors'
import { queuePluginRebuild } from '../publish'
import { installPluginArchive, type InstallResult } from './install'
import { officialKeys } from './official-keys'
import { applyPluginRegistry } from './load'

const SCRIPT_MESSAGE = 'This plugin asks to load scripts. Version 1 plugins cannot add scripts.'
const CONFIRM_PHRASE = 'remove plugin data'

export type TrustLabel = 'Official' | 'Self-installed'

export interface PluginSettingField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  options?: string[]
  value: unknown
}

export interface PluginListItem {
  id: string
  pluginId: string
  name: string
  version: string
  trust: TrustLabel
  permissions: string[]
  origins: PluginOrigin[]
  status: 'enabled' | 'disabled' | 'pending_owner'
  settings: PluginSettingField[]
}

export interface PluginProposalItem {
  id: string
  agentLabel: string
  pluginId: string
  version: string
  trust: TrustLabel
  reason: string
}

type PluginRow = typeof plugins.$inferSelect

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trustLabel(trust: 'official' | 'self'): TrustLabel {
  return trust === 'official' ? 'Official' : 'Self-installed'
}

function asManifest(row: PluginRow): PluginManifest {
  if (!isRecord(row.manifestJson)) {
    return {
      id: row.pluginId,
      name: row.name,
      version: row.version,
      sitebuilder: row.coreRange,
      permissions: row.permissionsJson as PluginManifest['permissions'],
      csp: { img: [], frame: [], script: [], connect: [], font: [] },
      blocks: [],
      head: [],
    }
  }
  return row.manifestJson as unknown as PluginManifest
}

function cspOf(manifest: PluginManifest): PluginManifest['csp'] {
  return {
    img: manifest.csp?.img ?? [],
    frame: manifest.csp?.frame ?? [],
    script: manifest.csp?.script ?? [],
    connect: manifest.csp?.connect ?? [],
    font: manifest.csp?.font ?? [],
  }
}

function originsOf(row: PluginRow): PluginOrigin[] {
  const manifest = asManifest(row)
  const csp = cspOf(manifest)
  const origins: PluginOrigin[] = []
  for (const directive of ['img', 'frame', 'connect', 'font'] as const) {
    for (const origin of csp[directive]) origins.push({ directive, origin })
  }
  for (const entry of manifest.head ?? []) {
    if (entry?.tag === 'link' && /^\{\{settings\.[A-Za-z][A-Za-z0-9]{0,31}\}\}$/.test(entry.href)) {
      origins.push({ directive: 'head', origin: entry.href })
    }
  }
  return origins
}

function assertNoScripts(row: PluginRow): void {
  if (cspOf(asManifest(row)).script.length) {
    throw new AppError('validation_failed', SCRIPT_MESSAGE, [{ path: 'csp.script', message: SCRIPT_MESSAGE }])
  }
}

function assertLoaded(registry: BlockRegistry, manifest: PluginManifest): void {
  for (const block of manifest.blocks ?? []) {
    if (!registry.has(`${manifest.id}/${block.type}`)) {
      throw new AppError('validation_failed', 'This plugin could not be loaded.', [{ path: '(plugin)', message: 'This plugin could not be loaded.' }])
    }
  }
}

function findPlugin(ctx: ServiceCtx, id: string): PluginRow | undefined {
  const byRow = ctx.db.select().from(plugins).where(and(eq(plugins.siteId, ctx.siteId), eq(plugins.id, id))).get()
  if (byRow) return byRow
  return ctx.db.select().from(plugins).where(and(eq(plugins.siteId, ctx.siteId), eq(plugins.pluginId, id))).get()
}

function requirePlugin(ctx: ServiceCtx, id: string): PluginRow {
  const row = findPlugin(ctx, id)
  if (!row) throw notFound('That plugin')
  return row
}

function bytesOf(value: Buffer | Uint8Array | null | undefined): Buffer | null {
  if (!value) return null
  return Buffer.isBuffer(value) ? value : Buffer.from(value)
}

function signatureText(signature: Buffer | null): string | null {
  if (!signature || signature.length === 0) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(signature)
  } catch {
    return ''
  }
}

function proposalTrust(row: typeof pluginProposals.$inferSelect): TrustLabel {
  const verdict = decideTrust({
    signature: signatureText(bytesOf(row.signature)),
    contentHash: Buffer.from(row.contentHash, 'hex'),
    pluginId: row.pluginId,
    version: row.version,
    keys: officialKeys(),
  })
  return verdict.ok ? trustLabel(verdict.trust) : 'Self-installed'
}

function settingFields(manifest: PluginManifest, doc: Record<string, unknown>): PluginSettingField[] {
  if (!manifest.settings) return []
  const compiled = compileObjectSchema(manifest.settings, { path: 'settings', mode: 'settings' })
  if (!compiled.schema) return []
  const rawFields = isRecord(manifest.settings) && isRecord(manifest.settings.fields) ? manifest.settings.fields : {}
  const fields: PluginSettingField[] = []
  for (const field of compiled.settingsFields) {
    const node = rawFields[field.key]
    if (!isRecord(node)) continue
    const type = node.type
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'enum') continue
    const options = type === 'enum' && Array.isArray(node.options) ? node.options.filter((item): item is string => typeof item === 'string') : undefined
    const value = Object.prototype.hasOwnProperty.call(doc, field.key) ? doc[field.key] : field.hasDefault ? (field.defaultValue ?? null) : null
    fields.push({ key: field.key, type, ...(options ? { options } : {}), value })
  }
  return fields
}

function stringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) stringValues(item, out)
  else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      out.push(key)
      stringValues(item, out)
    }
  }
  return out
}

/** Drop a submitted secret from a validation message. Field names stay when they are short. */
function scrubIssues(fields: FieldIssue[], submitted: unknown): FieldIssue[] {
  const needles = stringValues(submitted).filter((item) => item.length >= 12)
  return fields.map((field) => {
    const message = needles.some((item) => field.message.includes(item)) ? 'This value is not allowed.' : field.message
    const path = needles.some((item) => field.path.includes(item)) ? 'settings' : field.path
    return { path, message }
  })
}

function requireManager(actor: ActingAs): void {
  if (!can(actor, 'settings.manage')) throw forbidden()
}

export function listPlugins(ctx: ServiceCtx, actor: ActingAs): { plugins: PluginListItem[]; proposals: PluginProposalItem[]; leftovers: { pluginId: string }[] } {
  requireManager(actor)
  const rows = ctx.db.select().from(plugins).where(eq(plugins.siteId, ctx.siteId)).all()
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.pluginId.localeCompare(b.pluginId))
  const saved = ctx.db.select().from(pluginSettings).where(eq(pluginSettings.siteId, ctx.siteId)).all()
  const docs = new Map(saved.map((row) => [row.pluginId, isRecord(row.doc) ? row.doc : {}]))
  const installed = new Set(rows.map((row) => row.pluginId))
  const proposals = ctx.db
    .select()
    .from(pluginProposals)
    .where(and(eq(pluginProposals.siteId, ctx.siteId), eq(pluginProposals.status, 'pending')))
    .all()
  proposals.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  const leftovers = saved
    .filter((row) => !installed.has(row.pluginId))
    .map((row) => ({ pluginId: row.pluginId }))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
  return {
    plugins: rows.map((row) => ({
      id: row.id,
      pluginId: row.pluginId,
      name: row.name,
      version: row.version,
      trust: trustLabel(row.trust),
      permissions: row.permissionsJson,
      origins: originsOf(row),
      status: row.status,
      settings: settingFields(asManifest(row), docs.get(row.pluginId) ?? {}),
    })),
    proposals: proposals.map((row) => ({
      id: row.id,
      agentLabel: row.agentLabel,
      pluginId: row.pluginId,
      version: row.version,
      trust: proposalTrust(row),
      reason: row.reason,
    })),
    leftovers,
  }
}

async function turnOn(ctx: ServiceCtx, actor: ActingAs, row: PluginRow, action: 'plugin.enabled' | 'plugin.approved') {
  const manifest = asManifest(row)
  assertNoScripts(row)
  inTx(ctx, () => {
    ctx.db.update(plugins).set({ status: 'enabled', statusMessage: null, updatedAt: iso(ctx) }).where(eq(plugins.id, row.id)).run()
    audit(ctx, actor, action, { type: 'plugin', id: row.id }, { pluginId: row.pluginId, version: row.version })
  })
  const registry = await applyPluginRegistry(ctx)
  assertLoaded(registry, manifest)
  const pageIds = queuePluginRebuild(ctx, actor)
  return { status: 'enabled' as const, id: row.id, pluginId: row.pluginId, version: row.version, pageIds }
}

export async function enablePlugin(ctx: ServiceCtx, actor: ActingAs, id: string) {
  requireManager(actor)
  const row = requirePlugin(ctx, id)
  if (row.status === 'enabled') throw new AppError('invalid_state', 'This plugin is already on.')
  if ((row.status === 'pending_owner' || originsOf(row).length > 0) && !actor.isOperator) throw forbidden()
  return turnOn(ctx, actor, row, 'plugin.enabled')
}

export async function disablePlugin(ctx: ServiceCtx, actor: ActingAs, id: string) {
  requireManager(actor)
  const row = requirePlugin(ctx, id)
  if (row.status === 'disabled') throw new AppError('invalid_state', 'This plugin is already off.')
  inTx(ctx, () => {
    ctx.db.update(plugins).set({ status: 'disabled', statusMessage: null, updatedAt: iso(ctx) }).where(eq(plugins.id, row.id)).run()
    audit(ctx, actor, 'plugin.disabled', { type: 'plugin', id: row.id }, { pluginId: row.pluginId, version: row.version })
  })
  await applyPluginRegistry(ctx)
  const pageIds = queuePluginRebuild(ctx, actor)
  return { status: 'disabled' as const, id: row.id, pluginId: row.pluginId, pageIds }
}

export async function uninstallPlugin(ctx: ServiceCtx, actor: ActingAs, id: string) {
  requireManager(actor)
  const row = requirePlugin(ctx, id)
  inTx(ctx, () => {
    ctx.db.delete(pluginFiles).where(and(eq(pluginFiles.siteId, ctx.siteId), eq(pluginFiles.pluginId, row.pluginId))).run()
    ctx.db.delete(plugins).where(eq(plugins.id, row.id)).run()
    audit(ctx, actor, 'plugin.uninstalled', { type: 'plugin', id: row.id }, { pluginId: row.pluginId, version: row.version })
  })
  await applyPluginRegistry(ctx)
  const pageIds = queuePluginRebuild(ctx, actor)
  return { pluginId: row.pluginId, pageIds }
}

export async function savePluginSettings(ctx: ServiceCtx, actor: ActingAs, id: string, doc: unknown) {
  requireManager(actor)
  const row = requirePlugin(ctx, id)
  const manifest = asManifest(row)
  if (!manifest.settings) throw new AppError('validation_failed', 'This plugin has no settings.', [{ path: 'settings', message: 'This plugin has no settings.' }])
  const compiled = compileObjectSchema(manifest.settings, { path: 'settings', mode: 'settings' })
  if (!compiled.schema) throw new AppError('validation_failed', 'This plugin has no settings.', [{ path: 'settings', message: 'This plugin has no settings.' }])
  const parsed = compiled.schema.safeParse(doc)
  if (!parsed.success) {
    const fields = scrubIssues(zodIssues(parsed.error), doc)
    throw new AppError('validation_failed', fields[0]?.message ?? 'These settings were rejected.', fields)
  }
  const saved: Record<string, unknown> = isRecord(parsed.data) ? { ...parsed.data } : {}
  for (const field of compiled.settingsFields) {
    if (!Object.prototype.hasOwnProperty.call(saved, field.key) && field.hasDefault) saved[field.key] = field.defaultValue
  }
  inTx(ctx, () => {
    const existing = ctx.db
      .select()
      .from(pluginSettings)
      .where(and(eq(pluginSettings.siteId, ctx.siteId), eq(pluginSettings.pluginId, row.pluginId)))
      .get()
    if (existing) {
      ctx.db
        .update(pluginSettings)
        .set({ doc: saved, updatedAt: iso(ctx), updatedBy: actor.id })
        .where(and(eq(pluginSettings.siteId, ctx.siteId), eq(pluginSettings.pluginId, row.pluginId)))
        .run()
    } else {
      ctx.db.insert(pluginSettings).values({ siteId: ctx.siteId, pluginId: row.pluginId, doc: saved, updatedAt: iso(ctx), updatedBy: actor.id }).run()
    }
    audit(ctx, actor, 'plugin.settings', { type: 'plugin', id: row.id }, { pluginId: row.pluginId })
  })
  await applyPluginRegistry(ctx)
  const pageIds = queuePluginRebuild(ctx, actor)
  return { pluginId: row.pluginId, pageIds }
}

export function removePluginData(ctx: ServiceCtx, actor: ActingAs, id: string, confirm: string) {
  requireManager(actor)
  if (confirm !== CONFIRM_PHRASE) {
    throw new AppError('validation_failed', 'Type the confirm phrase to remove plugin data.', [{ path: 'confirm', message: 'Type the confirm phrase to remove plugin data.' }])
  }
  const row = findPlugin(ctx, id)
  const pluginId = row?.pluginId ?? id
  const settings = ctx.db
    .select()
    .from(pluginSettings)
    .where(and(eq(pluginSettings.siteId, ctx.siteId), eq(pluginSettings.pluginId, pluginId)))
    .get()
  if (!settings) throw notFound('Plugin data')
  const doc = settings.doc
  inTx(ctx, () => {
    ctx.db.delete(pluginSettings).where(and(eq(pluginSettings.siteId, ctx.siteId), eq(pluginSettings.pluginId, pluginId))).run()
    // The audit row is the copy of this small document. Do not enqueue a database backup.
    audit(ctx, actor, 'plugin.data_removed', { type: 'plugin', id: pluginId }, { pluginId, doc })
  })
  return { pluginId }
}

async function approveInstalled(ctx: ServiceCtx, actor: ActingAs, id: string) {
  if (!actor.isOperator) throw forbidden()
  const row = requirePlugin(ctx, id)
  if (row.status !== 'pending_owner') throw new AppError('invalid_state', 'This plugin is not waiting for an owner.')
  return turnOn(ctx, actor, row, 'plugin.approved')
}

async function approveProposal(ctx: ServiceCtx, actor: ActingAs, id: string): Promise<InstallResult> {
  requireManager(actor)
  const row = ctx.db.select().from(pluginProposals).where(and(eq(pluginProposals.siteId, ctx.siteId), eq(pluginProposals.id, id))).get()
  if (!row) throw notFound('That proposal')
  if (row.status !== 'pending') throw new AppError('invalid_state', 'This proposal is not waiting for a decision.')
  const archive = bytesOf(row.archive)
  if (!archive) throw new AppError('validation_failed', 'This proposal has no archive.', [{ path: 'archive', message: 'This proposal has no archive.' }])
  const result = await installPluginArchive(ctx, actor, archive, bytesOf(row.signature))
  ctx.db
    .update(pluginProposals)
    .set({ status: 'approved', decidedBy: actor.id, decidedAt: iso(ctx) })
    .where(eq(pluginProposals.id, row.id))
    .run()
  audit(ctx, actor, 'plugin.approved', { type: 'plugin_proposal', id: row.id }, { pluginId: row.pluginId, version: row.version, via: 'proposal', installStatus: result.status })
  return result
}

export async function approvePlugin(ctx: ServiceCtx, actor: ActingAs, id: string) {
  if (hasPrefix(id, 'pluginProposal')) return approveProposal(ctx, actor, id)
  return approveInstalled(ctx, actor, id)
}

export function rejectPluginProposal(ctx: ServiceCtx, actor: ActingAs, id: string) {
  requireManager(actor)
  const row = ctx.db.select().from(pluginProposals).where(and(eq(pluginProposals.siteId, ctx.siteId), eq(pluginProposals.id, id))).get()
  if (!row) throw notFound('That proposal')
  if (row.status !== 'pending') throw new AppError('invalid_state', 'This proposal is not waiting for a decision.')
  ctx.db
    .update(pluginProposals)
    .set({ status: 'rejected', decidedBy: actor.id, decidedAt: iso(ctx) })
    .where(eq(pluginProposals.id, row.id))
    .run()
  audit(ctx, actor, 'plugin.proposal_rejected', { type: 'plugin_proposal', id: row.id }, { pluginId: row.pluginId, version: row.version })
  return { id: row.id, status: 'rejected' as const }
}

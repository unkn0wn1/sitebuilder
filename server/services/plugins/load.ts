// Load enabled plugins into the process block registry. A bad row is disabled, not fatal.
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { BlockDefinition } from '../../../shared/blocks/define'
import { createDefaultRegistry, type BlockRegistry } from '../../../shared/blocks/registry'
import { contentHash } from '../../../shared/plugins/hash'
import { blockDefinitions, parseManifest } from '../../../shared/plugins/manifest'
import { BUNDLE_ID } from '../../../shared/theme-css'
import type { Db } from '../../db/client'
import { pluginFiles, pluginSettings, plugins } from '../../db/schema'
import { getOnlySite } from '../site'
import type { ServiceCtx } from '../context'
import { setBlockRegistry } from '../../utils/state'
import { testRenderPlugin } from './render-check'
import { clearPluginRuntimes, replacePluginRuntimes, type PluginBlockRuntime } from './runtime'

const FILE_MISMATCH = 'The stored files do not match this plugin.'
const MANIFEST_INVALID = 'The plugin manifest is not valid.'
const LOAD_FAILED = 'This plugin could not be loaded.'

export interface EnabledPluginLine {
  pluginId: string
  version: string
  contentHash: string
}

/**
 * BUNDLE_ID when nothing is enabled. Otherwise BUNDLE_ID, a hyphen, and the first 12 hex
 * chars of SHA-256 over the sorted lines `pluginId@version contentHash`, joined by a newline
 * with no trailing newline.
 */
export function effectiveBundleId(enabled: readonly EnabledPluginLine[]): string {
  if (!enabled.length) return BUNDLE_ID
  const lines = enabled.map((row) => `${row.pluginId}@${row.version} ${row.contentHash}`).sort()
  const hex = createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12)
  return `${BUNDLE_ID}-${hex}`
}

function bytesOf(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value)
}

async function loadOne(db: Db, row: typeof plugins.$inferSelect): Promise<{ ok: true; defs: BlockDefinition[]; blocks: PluginBlockRuntime[] } | { ok: false; message: string }> {
  try {
    if (row.trust !== 'official' && row.trust !== 'self') return { ok: false, message: MANIFEST_INVALID }
    const stored = db
      .select()
      .from(pluginFiles)
      .where(and(eq(pluginFiles.siteId, row.siteId), eq(pluginFiles.pluginId, row.pluginId)))
      .all()
    const files = stored.map((file) => ({ path: file.path, bytes: bytesOf(file.bytes) }))
    const hashed = contentHash(files)
    if (hashed.hex !== row.contentHash) return { ok: false, message: FILE_MISMATCH }
    for (const file of stored) {
      const digest = createHash('sha256').update(bytesOf(file.bytes)).digest('hex')
      if (digest !== file.sha256) return { ok: false, message: FILE_MISMATCH }
    }
    const manifestFile = files.find((file) => file.path === 'plugin.json')
    if (!manifestFile) return { ok: false, message: MANIFEST_INVALID }
    let raw: unknown
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes))
    } catch {
      return { ok: false, message: MANIFEST_INVALID }
    }
    const parsed = parseManifest(raw, new Map(files.map((file) => [file.path, file.bytes])))
    if (!parsed.ok) return { ok: false, message: parsed.issues[0]?.message ?? MANIFEST_INVALID }
    if (parsed.value.manifest.id !== row.pluginId || parsed.value.manifest.version !== row.version) return { ok: false, message: MANIFEST_INVALID }
    const rendered = await testRenderPlugin({ manifest: parsed.value.manifest, files })
    if (!rendered.ok) return { ok: false, message: rendered.message }
    return { ok: true, defs: blockDefinitions(parsed.value.manifest, row.trust), blocks: rendered.blocks }
  } catch {
    return { ok: false, message: LOAD_FAILED }
  }
}

/** Re-check enabled rows, disable the ones that fail, and build a registry of the rest. */
export async function syncEnabledPlugins(db: Db, siteId: string, now: Date): Promise<BlockRegistry> {
  const rows = db.select().from(plugins).where(and(eq(plugins.siteId, siteId), eq(plugins.status, 'enabled'))).all()
  rows.sort((a, b) => (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0))
  const defs: BlockDefinition[] = []
  const runtimes: PluginBlockRuntime[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const loaded = await loadOne(db, row)
    if (!loaded.ok) {
      const message = loaded.message.slice(0, 300)
      db.update(plugins)
        .set({ status: 'disabled', statusMessage: message, updatedAt: now.toISOString() })
        .where(eq(plugins.id, row.id))
        .run()
      console.error(JSON.stringify({ level: 'error', msg: 'plugin disabled on boot', pluginId: String(row.pluginId).slice(0, 64) }))
      continue
    }
    const fresh = loaded.defs.filter((def) => !seen.has(def.type))
    if (fresh.length !== loaded.defs.length) {
      db.update(plugins)
        .set({ status: 'disabled', statusMessage: 'This block type is already registered.', updatedAt: now.toISOString() })
        .where(eq(plugins.id, row.id))
        .run()
      console.error(JSON.stringify({ level: 'error', msg: 'plugin disabled on boot', pluginId: String(row.pluginId).slice(0, 64) }))
      continue
    }
    for (const def of fresh) seen.add(def.type)
    defs.push(...fresh)
    const saved = db
      .select()
      .from(pluginSettings)
      .where(and(eq(pluginSettings.siteId, row.siteId), eq(pluginSettings.pluginId, row.pluginId)))
      .get()
    const savedDoc = saved?.doc && typeof saved.doc === 'object' && !Array.isArray(saved.doc) ? saved.doc : {}
    for (const block of loaded.blocks) {
      block.settings = { ...block.settings, ...savedDoc }
      runtimes.push(block)
    }
  }
  replacePluginRuntimes(runtimes)
  return createDefaultRegistry(defs)
}

export async function applyPluginRegistry(ctx: ServiceCtx): Promise<BlockRegistry> {
  const registry = await syncEnabledPlugins(ctx.db, ctx.siteId, ctx.now())
  setBlockRegistry(registry)
  ctx.registry = registry
  return registry
}

/** Boot hook. No site yet: leave the core registry in place and drop plugin runtimes. */
export async function bootPlugins(db: Db, now: Date = new Date()): Promise<void> {
  const site = getOnlySite(db)
  if (!site) {
    clearPluginRuntimes()
    setBlockRegistry(createDefaultRegistry())
    return
  }
  setBlockRegistry(await syncEnabledPlugins(db, site.id, now))
}

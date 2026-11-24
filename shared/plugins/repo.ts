// Official repository index. The signature covers the canonical index bytes, not a file-record hash.
import { createHash, type KeyObject } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { writeTarGz, type ArchiveFile } from './archive'
import { contentHash, type ContentHash } from './hash'
import { parseManifest, type PluginManifest } from './manifest'
import { parseSemver } from './semver'
import { decideTrust, officialKeyId, signPluginSignature, type OfficialKey } from './signature'

export const INDEX_PLUGIN_ID = 'repository-index'
export const INDEX_VERSION = '1.0.0'

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/
const HASH_RE = /^[0-9a-f]{64}$/
const KEY_RE = /^[0-9a-f]{16}$/
const SOURCE_EXT = new Set(['.html', '.css', '.svg', '.png', '.webp', '.avif', '.gif'])

export interface IndexEntry {
  id: string
  version: string
  contentHash: string
  archive: string
  signature: string
  keyId: string
  core: string
}

export interface PackedSource {
  files: ArchiveFile[]
  archive: Buffer
  hash: ContentHash
  manifest: PluginManifest
}

export type IndexParse =
  | { ok: true; plugins: IndexEntry[]; canonical: Buffer }
  | { ok: false; reason: 'invalid' | 'path' }

export type IndexVerify =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'unsigned' | 'invalid' | 'unknown-key' }

export function expectedArchivePath(id: string, version: string): string {
  return `packages/${id}/${version}/${id}-${version}.tar.gz`
}

export function expectedSignaturePath(id: string, version: string): string {
  return `${expectedArchivePath(id, version)}.sig`
}

function compareText(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** UTF-8, LF, two-space JSON, plugins sorted by id then version, one trailing newline. */
export function canonicalIndex(plugins: readonly IndexEntry[]): string {
  const sorted = [...plugins].sort((a, b) => compareText(a.id, b.id) || compareText(a.version, b.version))
  const body = {
    schema: 1 as const,
    plugins: sorted.map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      contentHash: plugin.contentHash,
      archive: plugin.archive,
      signature: plugin.signature,
      keyId: plugin.keyId,
      core: plugin.core,
    })),
  }
  return `${JSON.stringify(body, null, 2)}\n`
}

export function indexDigest(canonical: Buffer | string): Buffer {
  return createHash('sha256').update(canonical).digest()
}

export function signIndex(input: { privateKey: KeyObject; publicKey: Buffer; canonical: Buffer }): string {
  return signPluginSignature({
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    contentHash: indexDigest(input.canonical),
    pluginId: INDEX_PLUGIN_ID,
    version: INDEX_VERSION,
  })
}

/**
 * Missing signature: unsigned.
 * Known key that fails, a comment mismatch, or an unreadable file: invalid.
 * A signature that parses but names an unknown key: unknown-key. Never Self-installed.
 */
export function verifyIndexSignature(signature: string | null, canonical: Buffer, keys: readonly OfficialKey[]): IndexVerify {
  if (signature === null) return { ok: false, reason: 'unsigned' }
  const verdict = decideTrust({
    signature,
    contentHash: indexDigest(canonical),
    pluginId: INDEX_PLUGIN_ID,
    version: INDEX_VERSION,
    keys,
  })
  if (!verdict.ok) return { ok: false, reason: 'invalid' }
  if (verdict.trust !== 'official' || !verdict.keyId) return { ok: false, reason: 'unknown-key' }
  return { ok: true, keyId: verdict.keyId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeRelative(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

function readEntry(raw: unknown): IndexEntry | 'path' | null {
  if (!isRecord(raw)) return null
  const keys = Object.keys(raw)
  const allowed = ['id', 'version', 'contentHash', 'archive', 'signature', 'keyId', 'core']
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) return null
  const id = raw.id
  const version = raw.version
  const contentHashHex = raw.contentHash
  const archive = raw.archive
  const signature = raw.signature
  const keyId = raw.keyId
  const core = raw.core
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  if (typeof version !== 'string' || !parseSemver(version)) return null
  if (typeof contentHashHex !== 'string' || !HASH_RE.test(contentHashHex)) return null
  if (typeof keyId !== 'string' || !KEY_RE.test(keyId)) return null
  if (typeof core !== 'string' || core.length < 1 || core.length > 80) return null
  if (typeof archive !== 'string' || typeof signature !== 'string') return null
  if (!safeRelative(archive) || !safeRelative(signature)) return 'path'
  if (archive !== expectedArchivePath(id, version) || signature !== expectedSignaturePath(id, version)) return 'path'
  return { id, version, contentHash: contentHashHex, archive, signature, keyId, core }
}

/** Accept only the canonical bytes. A bad path is reported on its own so the client can refuse the fetch. */
export function parseCanonicalIndex(bytes: Buffer): IndexParse {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!isRecord(raw) || raw.schema !== 1 || !Array.isArray(raw.plugins)) return { ok: false, reason: 'invalid' }
  if (Object.keys(raw).some((key) => key !== 'schema' && key !== 'plugins')) return { ok: false, reason: 'invalid' }
  const plugins: IndexEntry[] = []
  const seen = new Set<string>()
  for (const item of raw.plugins) {
    const entry = readEntry(item)
    if (entry === 'path') return { ok: false, reason: 'path' }
    if (!entry) return { ok: false, reason: 'invalid' }
    const key = `${entry.id}\0${entry.version}`
    if (seen.has(key)) return { ok: false, reason: 'invalid' }
    seen.add(key)
    plugins.push(entry)
  }
  const canonical = Buffer.from(canonicalIndex(plugins), 'utf8')
  if (!canonical.equals(Buffer.from(text, 'utf8'))) return { ok: false, reason: 'invalid' }
  return { ok: true, plugins, canonical }
}

function walkSource(dir: string, current: string, out: ArchiveFile[]) {
  for (const name of readdirSync(current).sort()) {
    const abs = join(current, name)
    const rel = relative(dir, abs).split(sep).join('/')
    const info = statSync(abs)
    if (info.isDirectory()) {
      walkSource(dir, abs, out)
      continue
    }
    if (!info.isFile()) throw new Error(`The source has a file this pack will not read: ${rel}`)
    const ext = extname(name).toLowerCase()
    if (name !== 'plugin.json' && !SOURCE_EXT.has(ext)) throw new Error(`The source has a file this pack will not read: ${rel}`)
    out.push({ path: rel, bytes: readFileSync(abs) })
  }
}

/** Read a plugin source directory. No signing. */
export function packSource(dir: string): PackedSource {
  const files: ArchiveFile[] = []
  walkSource(dir, dir, files)
  if (!files.some((file) => file.path === 'plugin.json')) throw new Error('The source needs plugin.json.')
  const manifestFile = files.find((file) => file.path === 'plugin.json')
  if (!manifestFile) throw new Error('The source needs plugin.json.')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes))
  } catch {
    throw new Error('plugin.json is not valid JSON.')
  }
  const parsed = parseManifest(raw, new Map(files.map((file) => [file.path, file.bytes])))
  if (!parsed.ok) throw new Error(parsed.issues[0]?.message ?? 'The manifest is not valid.')
  return { files, archive: writeTarGz(files), hash: contentHash(files), manifest: parsed.value.manifest }
}

export interface BuiltPackage {
  id: string
  name: string
  version: string
  core: string
  contentHash: string
  keyId: string
  archive: Buffer
  signature: string
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderIndexHtml(packages: readonly BuiltPackage[]): string {
  const cards = [...packages]
    .sort((a, b) => compareText(a.id, b.id) || compareText(a.version, b.version))
    .map((plugin) => {
      const archive = expectedArchivePath(plugin.id, plugin.version)
      return [
        '<article class="card">',
        `<h2>${escapeHtml(plugin.name)}</h2>`,
        `<p>${escapeHtml(plugin.id)}, version ${escapeHtml(plugin.version)}</p>`,
        `<p>Core ${escapeHtml(plugin.core)}</p>`,
        `<p>Content hash ${escapeHtml(plugin.contentHash)}</p>`,
        `<p><a href="${escapeHtml(archive)}">Download the package</a></p>`,
        '</article>',
      ].join('\n')
    })
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Skewstone plugins</title>
<style>
  body { margin: 0; background: #ffffff; color: #111827; font-family: system-ui, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
  .lead { color: #4b5563; margin: 0 0 1.5rem; }
  .card { border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem 1.25rem; margin: 0 0 1rem; }
  h2 { font-size: 1.125rem; margin: 0 0 0.5rem; }
  p { margin: 0.25rem 0; color: #4b5563; }
  a { color: #1d4ed8; }
</style>
</head>
<body>
<main>
<h1>Skewstone plugins</h1>
<p class="lead">Official packages. Each archive has a detached signature, and index.json is signed.</p>
${cards}
</main>
</body>
</html>
`
}

export interface RepositoryFile {
  path: string
  bytes: Buffer
}

/** index.json, index.json.sig, index.html, and the package tree. */
export function buildRepositoryFiles(input: { packages: readonly BuiltPackage[]; privateKey: KeyObject; publicKey: Buffer }): RepositoryFile[] {
  const entries: IndexEntry[] = input.packages.map((plugin) => ({
    id: plugin.id,
    version: plugin.version,
    contentHash: plugin.contentHash,
    archive: expectedArchivePath(plugin.id, plugin.version),
    signature: expectedSignaturePath(plugin.id, plugin.version),
    keyId: plugin.keyId,
    core: plugin.core,
  }))
  const canonical = Buffer.from(canonicalIndex(entries), 'utf8')
  const signature = signIndex({ privateKey: input.privateKey, publicKey: input.publicKey, canonical })
  const files: RepositoryFile[] = [
    { path: 'index.json', bytes: canonical },
    { path: 'index.json.sig', bytes: Buffer.from(signature, 'utf8') },
    { path: 'index.html', bytes: Buffer.from(renderIndexHtml(input.packages), 'utf8') },
  ]
  for (const plugin of input.packages) {
    files.push({ path: expectedArchivePath(plugin.id, plugin.version), bytes: plugin.archive })
    files.push({ path: expectedSignaturePath(plugin.id, plugin.version), bytes: Buffer.from(plugin.signature, 'utf8') })
  }
  return files
}

export function packageKeyId(publicKey: Buffer): string {
  return officialKeyId(publicKey)
}

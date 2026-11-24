// Fetch a signed plugin index and install one package through the existing installer.
import { isIP } from 'node:net'
import { PLUGIN_ARCHIVE_MAX_BYTES } from '../../../shared/plugins/limits'
import { ArchiveError, readTarGz } from '../../../shared/plugins/archive'
import { contentHash } from '../../../shared/plugins/hash'
import { parseCanonicalIndex, verifyIndexSignature, type IndexEntry } from '../../../shared/plugins/repo'
import { satisfiesCore } from '../../../shared/plugins/semver'
import { decideTrust } from '../../../shared/plugins/signature'
import { can } from '../../../shared/roles'
import { audit } from '../audit'
import type { ActingAs, ServiceCtx } from '../context'
import { AppError, forbidden, notFound } from '../errors'
import { assertPublicDestination, BlockedDestination, checkPublicUrl, defaultResolver, isPrivateAddress, readCapped, type Resolver } from '../net-guard'
import { installPluginArchive, type InstallResult } from './install'
import { officialKeys } from './official-keys'

export const MSG_UNSIGNED = 'The repository index is not signed.'
export const MSG_INVALID = 'The repository index signature is not valid.'
export const MSG_UNKNOWN = 'The repository index is not signed by a known official key.'
export const MSG_HASH = 'The archive does not match the repository index.'
export const MSG_CORE = 'This plugin needs a different Skewstone version.'
export const MSG_TIMEOUT = 'The repository did not respond in time.'
export const MSG_OVERSIZE = 'The repository file is too big.'
export const MSG_PATH = 'The repository index points at a file this install will not fetch.'
export const MSG_HTTPS = 'The plugin repository must use https.'
export const MSG_FETCH = 'The repository could not be fetched.'

const INDEX_MAX_BYTES = 256 * 1024
const SIG_MAX_BYTES = 8 * 1024
const DEFAULT_REPO = 'https://plugins.skewstone.com'

export type RepoReason = 'unsigned' | 'invalid' | 'unknown-key' | 'hash' | 'core' | 'fetch'

export class RepoError extends Error {
  constructor(
    readonly reason: RepoReason,
    message: string,
  ) {
    super(message)
  }
}

export interface FetchDeps {
  fetch: typeof fetch
  resolve: Resolver
}

export interface ListedPlugin {
  id: string
  version: string
  contentHash: string
  core: string
  compatible: boolean
  keyId: string
}

const defaultDeps = (): FetchDeps => ({ fetch: globalThis.fetch, resolve: defaultResolver })

function fail(reason: RepoReason, message: string): never {
  throw new RepoError(reason, message)
}

/** The catalogue base. An override is ignored unless the test-key flag is on. */
export function repositoryBase(override?: string): string {
  const allowOverride = process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS === '1'
  const chosen = allowOverride && override?.trim() ? override.trim() : process.env.SITEBUILDER_PLUGIN_REPO_URL?.trim() || DEFAULT_REPO
  return chosen.replace(/\/+$/, '')
}

function httpPinned(hostname: string): boolean {
  const pin = process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST
  if (!pin || hostname !== pin) return false
  if (hostname === 'localhost') return true
  return isIP(hostname) !== 0 && isPrivateAddress(hostname)
}

/** HTTPS on a public host, or HTTP only when the host is the configured loopback or private pin. */
export function assertRepoUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail('fetch', MSG_HTTPS)
  }
  url.hash = ''
  if (url.username || url.password) fail('fetch', MSG_HTTPS)
  if (url.protocol === 'https:') {
    try {
      return checkPublicUrl(url.toString(), { field: 'repo' })
    } catch {
      fail('fetch', MSG_FETCH)
    }
  }
  if (url.protocol === 'http:') {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!httpPinned(host)) fail('fetch', MSG_HTTPS)
    return url.toString()
  }
  fail('fetch', MSG_HTTPS)
}

function resolveUnder(base: string, rel: string): string {
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(rel)) fail('fetch', MSG_PATH)
  let baseUrl: URL
  try {
    baseUrl = new URL(base.endsWith('/') ? base : `${base}/`)
  } catch {
    fail('fetch', MSG_HTTPS)
  }
  const resolved = new URL(rel, baseUrl)
  if (resolved.origin !== baseUrl.origin || resolved.username || resolved.password) fail('fetch', MSG_PATH)
  const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`
  if (!resolved.pathname.startsWith(basePath)) fail('fetch', MSG_PATH)
  return assertRepoUrl(resolved.toString())
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}

async function fetchFile(start: string, maxBytes: number, deps: FetchDeps): Promise<{ status: number; body: Buffer | null }> {
  let current = start
  for (let hop = 0; hop <= 2; hop++) {
    const checked = assertRepoUrl(current)
    if (new URL(checked).protocol === 'https:') {
      try {
        await assertPublicDestination(checked, deps.resolve, false)
      } catch (error) {
        if (error instanceof BlockedDestination) fail('fetch', MSG_FETCH)
        throw error
      }
    }
    let res: Response
    try {
      res = await deps.fetch(checked, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      if (isTimeout(error)) fail('fetch', MSG_TIMEOUT)
      fail('fetch', MSG_FETCH)
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {})
      const loc = res.headers.get('location')
      if (!loc || hop === 2) fail('fetch', MSG_FETCH)
      current = new URL(loc, checked).toString()
      continue
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {})
      return { status: 404, body: null }
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => {})
      fail('fetch', MSG_FETCH)
    }
    try {
      return { status: res.status, body: await readCapped(res, maxBytes) }
    } catch (error) {
      if (error instanceof Error && /too big/i.test(error.message)) fail('fetch', MSG_OVERSIZE)
      fail('fetch', MSG_FETCH)
    }
  }
  fail('fetch', MSG_FETCH)
}

function signatureText(body: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return ''
  }
}

interface LoadedIndex {
  base: string
  origin: string
  plugins: IndexEntry[]
}

async function loadIndex(base: string, deps: FetchDeps): Promise<LoadedIndex> {
  const index = await fetchFile(resolveUnder(base, 'index.json'), INDEX_MAX_BYTES, deps)
  if (index.status === 404 || !index.body) fail('fetch', MSG_FETCH)
  const sig = await fetchFile(resolveUnder(base, 'index.json.sig'), SIG_MAX_BYTES, deps)
  if (sig.status === 404 || !sig.body) fail('unsigned', MSG_UNSIGNED)
  const parsed = parseCanonicalIndex(index.body)
  if (!parsed.ok) fail(parsed.reason === 'path' ? 'fetch' : 'invalid', parsed.reason === 'path' ? MSG_PATH : MSG_INVALID)
  const verdict = verifyIndexSignature(signatureText(sig.body), parsed.canonical, officialKeys())
  if (!verdict.ok) {
    if (verdict.reason === 'unknown-key') fail('unknown-key', MSG_UNKNOWN)
    if (verdict.reason === 'unsigned') fail('unsigned', MSG_UNSIGNED)
    fail('invalid', MSG_INVALID)
  }
  let origin = base
  try {
    origin = new URL(base).origin
  } catch {
    fail('fetch', MSG_HTTPS)
  }
  return { base, origin, plugins: parsed.plugins }
}

function toApp(error: RepoError): AppError {
  return new AppError('validation_failed', error.message, [{ path: 'repository', message: error.message }])
}

export async function listRepository(override?: string, deps: FetchDeps = defaultDeps()): Promise<{ repo: string; plugins: ListedPlugin[] }> {
  const base = repositoryBase(override)
  const loaded = await loadIndex(base, deps)
  return {
    repo: base,
    plugins: loaded.plugins.map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      contentHash: plugin.contentHash,
      core: plugin.core,
      compatible: satisfiesCore(plugin.core),
      keyId: plugin.keyId,
    })),
  }
}

function rejectRepo(ctx: ServiceCtx, actor: ActingAs, pluginId: string, version: string | undefined, error: RepoError): never {
  audit(ctx, actor, 'plugin.repo_rejected', { type: 'plugin', id: pluginId }, {
    pluginId,
    ...(version ? { version } : {}),
    reason: error.reason,
  })
  throw toApp(error)
}

export async function installFromRepository(
  ctx: ServiceCtx,
  actor: ActingAs,
  input: { id: string; version: string; repoUrl?: string },
  deps: FetchDeps = defaultDeps(),
): Promise<InstallResult> {
  if (!can(actor, 'settings.manage')) throw forbidden()
  const base = repositoryBase(input.repoUrl)
  let loaded: LoadedIndex
  try {
    loaded = await loadIndex(base, deps)
  } catch (error) {
    if (error instanceof RepoError) rejectRepo(ctx, actor, input.id, input.version, error)
    throw error
  }
  const entry = loaded.plugins.find((plugin) => plugin.id === input.id && plugin.version === input.version)
  if (!entry) throw notFound('That plugin')
  if (!satisfiesCore(entry.core)) rejectRepo(ctx, actor, entry.id, entry.version, new RepoError('core', MSG_CORE))
  let archive: Buffer
  let signature: string
  try {
    const archiveRes = await fetchFile(resolveUnder(base, entry.archive), PLUGIN_ARCHIVE_MAX_BYTES, deps)
    if (archiveRes.status === 404 || !archiveRes.body) fail('fetch', MSG_FETCH)
    const sigRes = await fetchFile(resolveUnder(base, entry.signature), SIG_MAX_BYTES, deps)
    if (sigRes.status === 404 || !sigRes.body) fail('invalid', MSG_INVALID)
    archive = archiveRes.body
    signature = signatureText(sigRes.body)
  } catch (error) {
    if (error instanceof RepoError) rejectRepo(ctx, actor, entry.id, entry.version, error)
    throw error
  }
  let hashed: { raw: Buffer; hex: string }
  try {
    hashed = contentHash(readTarGz(archive).files)
  } catch (error) {
    if (error instanceof ArchiveError || error instanceof Error) rejectRepo(ctx, actor, entry.id, entry.version, new RepoError('hash', MSG_HASH))
    throw error
  }
  if (hashed.hex !== entry.contentHash) rejectRepo(ctx, actor, entry.id, entry.version, new RepoError('hash', MSG_HASH))
  const verdict = decideTrust({
    signature,
    contentHash: hashed.raw,
    pluginId: entry.id,
    version: entry.version,
    keys: officialKeys(),
  })
  if (!verdict.ok || verdict.trust !== 'official' || verdict.keyId !== entry.keyId) {
    rejectRepo(ctx, actor, entry.id, entry.version, new RepoError('invalid', MSG_INVALID))
  }
  return installPluginArchive(ctx, actor, archive, Buffer.from(signature, 'utf8'), { via: 'repository', repo: loaded.origin })
}

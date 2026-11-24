// Per-visitor demo sandboxes. Each one is a copy of the golden database, media, and published site.
// The golden tree is never opened for writing. This module does not import state.ts or auth.ts.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { DbHandle } from '../db/client'
import { openDb } from '../db/client'
import type { MigrationFile } from '../db/migrate'
import { loadMigrationsFromDir } from '../db/migrations-fs'
import { sites } from '../db/schema'
import { AppError } from './errors'

export const DEMO_COOKIE = 'sb_demo'
export const DEMO_IDLE_MS = 2 * 60 * 60 * 1000
const TOUCH_MIN_MS = 60_000
const LRU_PROTECT_MS = 10 * 60 * 1000
const LOGIN_LOCK_MS = 15 * 60 * 1000
const ID_RE = /^[a-f0-9]{32}$/

export interface SandboxMeta {
  id: string
  createdAt: string
  lastSeen: string
  expiresAt: string
  lastReset: string | null
  siteId: string
}

export interface Sandbox {
  id: string
  root: string
  dbPath: string
  mediaPath: string
  sitePath: string
  handle: DbHandle
  siteId: string
  meta: SandboxMeta
}

const als = new AsyncLocalStorage<Sandbox>()
const open = new Map<string, Sandbox>()
let migrations: MigrationFile[] | null = null
let reopened = false

export function currentSandbox(): Sandbox | undefined {
  return als.getStore()
}

export function runInSandbox<T>(sandbox: Sandbox, fn: () => T): T {
  return als.run(sandbox, fn)
}

export function setDemoMigrations(files: MigrationFile[]) {
  if (files.length) migrations = files
}

export function hasDemoMigrations(): boolean {
  return !!migrations?.length
}

export function demoRoot(): string {
  if (process.env.SITEBUILDER_DEMO_ROOT) return process.env.SITEBUILDER_DEMO_ROOT
  const db = process.env.SITEBUILDER_DB_PATH
  if (db && db !== ':memory:') return join(dirname(db), 'demo')
  return join('.data', 'demo')
}

export function goldenPath(): string {
  return join(demoRoot(), 'golden')
}

function sandboxesPath(): string {
  return join(demoRoot(), 'sandboxes')
}

function migrationsFiles(): MigrationFile[] {
  if (migrations?.length) return migrations
  return loadMigrationsFromDir()
}

function maxSandboxes(): number {
  const n = Number(process.env.SITEBUILDER_DEMO_MAX_SANDBOXES ?? '40')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40
}

export function assertGoldenReady() {
  const db = join(goldenPath(), 'sitebuilder.db')
  const sum = join(goldenPath(), 'checksum.txt')
  if (!existsSync(db) || !existsSync(sum)) {
    throw new AppError('not_set_up', 'Demo golden snapshot is missing. Run npm run demo:golden.')
  }
}

function readMeta(root: string): SandboxMeta {
  return JSON.parse(readFileSync(join(root, 'meta.json'), 'utf8')) as SandboxMeta
}

function writeMeta(root: string, meta: SandboxMeta) {
  writeFileSync(join(root, 'meta.json'), JSON.stringify(meta))
}

function metaOf(id: string): SandboxMeta | null {
  const file = join(sandboxesPath(), id, 'meta.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SandboxMeta
  } catch {
    return null
  }
}

export function isExpired(meta: SandboxMeta, now = Date.now()): boolean {
  const seen = Date.parse(meta.lastSeen)
  if (!Number.isFinite(seen)) return true
  return now - seen >= DEMO_IDLE_MS
}

function chmodTreeWritable(root: string) {
  const walk = (dir: string) => {
    chmodSync(dir, 0o755)
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isSymbolicLink()) continue
      const path = join(dir, name.name)
      if (name.isDirectory()) walk(path)
      else chmodSync(path, 0o644)
    }
  }
  walk(root)
}

export function assertCurrentLink(dest: string) {
  const current = join(dest, 'site', 'current')
  let linkStat: ReturnType<typeof lstatSync>
  try {
    linkStat = lstatSync(current)
  } catch {
    throw new AppError('not_set_up', 'Golden site/current must be a relative symlink.')
  }
  if (!linkStat.isSymbolicLink()) throw new AppError('not_set_up', 'Golden site/current must be a relative symlink.')
  const link = readlinkSync(current)
  if (link.startsWith('/') || link.split(/[/\\]/).includes('..')) {
    throw new AppError('not_set_up', 'Golden site/current must stay inside the sandbox.')
  }
  const resolved = realpathSync(current)
  const siteReal = realpathSync(join(dest, 'site'))
  if (resolved !== siteReal && !resolved.startsWith(siteReal + sep)) {
    throw new AppError('not_set_up', 'Golden site/current points outside the sandbox.')
  }
}

// Node's cpSync rewrites a relative symlink as an absolute path. Put the original
// target back so site/current stays inside the sandbox and is not followed.
function rehomeSymlinks(srcRoot: string, destRoot: string) {
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name)
      if (name.isSymbolicLink()) {
        const original = readlinkSync(join(srcRoot, relative(destRoot, path)))
        if (readlinkSync(path) !== original) {
          rmSync(path)
          symlinkSync(original, path)
        }
        continue
      }
      if (name.isDirectory()) walk(path)
    }
  }
  walk(destRoot)
}

function copyGolden(dest: string) {
  assertGoldenReady()
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(goldenPath(), dest, {
    recursive: true,
    filter: (src) => {
      const base = basename(src)
      return base !== 'checksum.txt' && !base.endsWith('-wal') && !base.endsWith('-shm')
    },
  })
  chmodTreeWritable(dest)
  rehomeSymlinks(goldenPath(), dest)
  assertCurrentLink(dest)
}

function closeHandle(sandbox: Sandbox) {
  try {
    sandbox.handle.sqlite.close()
  } catch {
    // Already closed.
  }
  open.delete(sandbox.id)
}

function openSandbox(id: string, root: string): Sandbox {
  const existing = open.get(id)
  if (existing) return existing
  const handle = openDb(join(root, 'sitebuilder.db'), migrationsFiles())
  const site = handle.db.select({ id: sites.id }).from(sites).get()
  if (!site) {
    handle.sqlite.close()
    throw new AppError('not_set_up', 'This demo sandbox has no site.')
  }
  const meta = readMeta(root)
  const sandbox: Sandbox = {
    id,
    root,
    dbPath: join(root, 'sitebuilder.db'),
    mediaPath: join(root, 'media'),
    sitePath: join(root, 'site'),
    handle,
    siteId: site.id,
    meta,
  }
  open.set(id, sandbox)
  return sandbox
}

function listIds(): string[] {
  const dir = sandboxesPath()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ID_RE.test(entry.name))
    .map((entry) => entry.name)
}

export function evictSandbox(id: string) {
  const sandbox = open.get(id)
  if (sandbox) closeHandle(sandbox)
  const root = join(sandboxesPath(), id)
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
}

export function evictIdle(now = Date.now()): string[] {
  const removed: string[] = []
  for (const id of listIds()) {
    const meta = metaOf(id)
    if (!meta || !isExpired(meta, now)) continue
    evictSandbox(id)
    removed.push(id)
  }
  return removed
}

function evictLru(now: number): boolean {
  let oldest: { id: string; seen: number } | null = null
  for (const id of listIds()) {
    const meta = metaOf(id)
    if (!meta) continue
    const seen = Date.parse(meta.lastSeen)
    if (!Number.isFinite(seen) || now - seen < LRU_PROTECT_MS) continue
    if (!oldest || seen < oldest.seen) oldest = { id, seen }
  }
  if (!oldest) return false
  evictSandbox(oldest.id)
  return true
}

export function touchSandbox(sandbox: Sandbox, now = Date.now()) {
  const last = Date.parse(sandbox.meta.lastSeen)
  if (Number.isFinite(last) && now - last < TOUCH_MIN_MS) return
  sandbox.meta.lastSeen = new Date(now).toISOString()
  sandbox.meta.expiresAt = new Date(now + DEMO_IDLE_MS).toISOString()
  writeMeta(sandbox.root, sandbox.meta)
}

function freshMeta(id: string, now: number, createdAt: string, lastReset: string | null): SandboxMeta {
  return {
    id,
    createdAt,
    lastSeen: new Date(now).toISOString(),
    expiresAt: new Date(now + DEMO_IDLE_MS).toISOString(),
    lastReset,
    siteId: '',
  }
}

export type MintResult = { ok: true; sandbox: Sandbox; minted: boolean } | { ok: false; full: true }

/** Open the sandbox a cookie already names. Does not copy the golden tree or mint. */
export function openExisting(cookieId: string | null): Sandbox | null {
  if (!cookieId || !ID_RE.test(cookieId)) return null
  const root = join(sandboxesPath(), cookieId)
  if (!existsSync(join(root, 'sitebuilder.db'))) return null
  return openSandbox(cookieId, root)
}

export function openOrMint(cookieId: string | null, now = Date.now()): MintResult {
  const existing = openExisting(cookieId)
  if (existing) return { ok: true, sandbox: existing, minted: false }
  assertGoldenReady()
  evictIdle(now)
  while (listIds().length >= maxSandboxes()) {
    if (!evictLru(now)) return { ok: false, full: true }
  }
  const id = randomBytes(16).toString('hex')
  const root = join(sandboxesPath(), id)
  copyGolden(root)
  const meta = freshMeta(id, now, new Date(now).toISOString(), null)
  writeMeta(root, meta)
  const sandbox = openSandbox(id, root)
  sandbox.meta.siteId = sandbox.siteId
  writeMeta(root, sandbox.meta)
  return { ok: true, sandbox, minted: true }
}

export function resetSandbox(id: string, now = Date.now()): Sandbox {
  if (!ID_RE.test(id)) throw new AppError('not_found', 'That demo was not found.')
  const root = join(sandboxesPath(), id)
  const prev = existsSync(join(root, 'meta.json')) ? readMeta(root) : null
  const createdAt = prev?.createdAt ?? new Date(now).toISOString()
  const existing = open.get(id)
  if (existing) closeHandle(existing)
  rmSync(root, { recursive: true, force: true })
  copyGolden(root)
  writeMeta(root, freshMeta(id, now, createdAt, new Date(now).toISOString()))
  const sandbox = openSandbox(id, root)
  sandbox.meta.siteId = sandbox.siteId
  writeMeta(root, sandbox.meta)
  return sandbox
}

export function recordDemoReset(entry: { clientIp: string; sessionSha256: string | null; sandboxId: string; at?: string }) {
  mkdirSync(demoRoot(), { recursive: true })
  const line = JSON.stringify({
    time: entry.at ?? new Date().toISOString(),
    clientIp: entry.clientIp,
    session: entry.sessionSha256,
    sandbox: entry.sandboxId,
    action: 'demo.reset',
  })
  appendFileSync(join(demoRoot(), 'audit.jsonl'), `${line}\n`)
}

export function resetDemoSandbox(id: string, audit: { clientIp: string; sessionSha256: string | null }, now = Date.now()): Sandbox {
  recordDemoReset({ clientIp: audit.clientIp, sessionSha256: audit.sessionSha256, sandboxId: id, at: new Date(now).toISOString() })
  return resetSandbox(id, now)
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'checksum.txt' || name.name.endsWith('-wal') || name.name.endsWith('-shm')) continue
    const path = join(dir, name.name)
    if (name.isSymbolicLink() || name.isFile()) out.push(path)
    else if (name.isDirectory()) out.push(...walkFiles(path))
  }
  return out
}

export function computeChecksum(root: string): string {
  const files = walkFiles(root).sort((a, b) => relative(root, a).localeCompare(relative(root, b)))
  return files
    .map((file) => {
      const rel = relative(root, file).split('\\').join('/')
      const data = lstatSync(file).isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file)
      return `${createHash('sha256').update(data).digest('hex')}  ${rel}\n`
    })
    .join('')
}

export function writeGoldenChecksum(root: string) {
  writeFileSync(join(root, 'checksum.txt'), computeChecksum(root))
}

export function verifyGoldenChecksum() {
  assertGoldenReady()
  const expected = readFileSync(join(goldenPath(), 'checksum.txt'), 'utf8')
  const actual = computeChecksum(goldenPath())
  if (expected !== actual) throw new Error('Golden checksum mismatch. Refusing to delete sandboxes.')
}

export function chmodGoldenReadOnly(root: string) {
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isSymbolicLink()) continue
      const path = join(dir, name.name)
      if (name.isDirectory()) {
        walk(path)
        chmodSync(path, 0o555)
      } else chmodSync(path, 0o444)
    }
  }
  walk(root)
  chmodSync(root, 0o555)
}

export function writeHeartbeat(now = Date.now()) {
  mkdirSync(demoRoot(), { recursive: true })
  writeFileSync(join(demoRoot(), 'server.json'), JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }))
}

export function heartbeatFresh(maxAgeMs = 30_000, now = Date.now()): boolean {
  const file = join(demoRoot(), 'server.json')
  if (!existsSync(file)) return false
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { at?: string }
    const at = Date.parse(data.at ?? '')
    return Number.isFinite(at) && now - at >= 0 && now - at < maxAgeMs
  } catch {
    return false
  }
}

export function applyEvictRequest(): boolean {
  const reqPath = join(demoRoot(), 'evict.request')
  if (!existsSync(reqPath)) return false
  const body = JSON.parse(readFileSync(reqPath, 'utf8')) as { id?: string; sandboxes?: string[] }
  for (const id of body.sandboxes ?? []) {
    if (ID_RE.test(id)) evictSandbox(id)
  }
  writeFileSync(join(demoRoot(), 'evict.done'), JSON.stringify({ id: body.id ?? '' }))
  rmSync(reqPath, { force: true })
  return true
}

export function reopenSandboxes(now = Date.now()) {
  if (reopened) return
  reopened = true
  for (const id of listIds()) {
    const meta = metaOf(id)
    if (!meta || isExpired(meta, now)) continue
    try {
      openSandbox(id, join(sandboxesPath(), id))
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'demo reopen', id, error: String(error) }))
    }
  }
}

export function openSandboxes(): Sandbox[] {
  return [...open.values()]
}

export function runDemoSweep(opts: { now?: number; onWait?: () => void; waitMs?: number } = {}): { deleted: string[] } {
  verifyGoldenChecksum()
  const now = opts.now ?? Date.now()
  const expired = listIds().filter((id) => {
    const meta = metaOf(id)
    return !!meta && isExpired(meta, now)
  })
  if (!expired.length) return { deleted: [] }
  if (heartbeatFresh(30_000, now)) {
    const requestId = randomBytes(8).toString('hex')
    mkdirSync(demoRoot(), { recursive: true })
    writeFileSync(join(demoRoot(), 'evict.request'), JSON.stringify({ id: requestId, sandboxes: expired }))
    const wait = opts.waitMs ?? 5_000
    const start = Date.now()
    const donePath = join(demoRoot(), 'evict.done')
    while (Date.now() - start < wait) {
      opts.onWait?.()
      if (existsSync(donePath)) {
        const body = JSON.parse(readFileSync(donePath, 'utf8')) as { id?: string }
        if (body.id === requestId) {
          rmSync(donePath, { force: true })
          return { deleted: expired.filter((id) => !existsSync(join(sandboxesPath(), id))) }
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
    throw new Error('Demo worker did not acknowledge eviction.')
  }
  for (const id of expired) evictSandbox(id)
  return { deleted: expired }
}

export function cookieDomain(hostHeader: string | undefined): string | undefined {
  const host = (hostHeader ?? '').split(':')[0]!.trim().toLowerCase()
  if (host === 'skewstone.com' || host.endsWith('.skewstone.com')) return '.skewstone.com'
  return undefined
}

const loginFails = new Map<string, { count: number; lockedUntil: number }>()

export function demoLoginMaxFails(): number {
  const n = Number(process.env.SITEBUILDER_DEMO_LOGIN_MAX_FAILS ?? '8')
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8
}

export function demoLoginLocked(ip: string, now = Date.now()): boolean {
  const row = loginFails.get(ip)
  if (!row) return false
  if (row.lockedUntil && row.lockedUntil <= now) {
    loginFails.delete(ip)
    return false
  }
  return row.count >= demoLoginMaxFails()
}

export function demoLoginFailed(ip: string, now = Date.now()) {
  const row = loginFails.get(ip) ?? { count: 0, lockedUntil: 0 }
  row.count += 1
  if (row.count >= demoLoginMaxFails()) row.lockedUntil = now + LOGIN_LOCK_MS
  loginFails.set(ip, row)
}

export function demoLoginSucceeded(ip: string) {
  loginFails.delete(ip)
}

export function closeDemoSandboxes() {
  for (const sandbox of [...open.values()]) closeHandle(sandbox)
  reopened = false
  loginFails.clear()
}

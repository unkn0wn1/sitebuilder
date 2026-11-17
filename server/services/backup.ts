// Nightly off-site backups and restore. The archive holds the SQLite database (online backup
// API) and media originals. Renditions and release folders are rebuilt. The secret key is not
// in the archive. See docs/16-operations.md#backups-and-restore.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { can } from '../../shared/roles'
import { jobs, media, sites, users } from '../db/schema'
import { decryptBytes, encryptBytes, secretKeyFromEnv } from './auth'
import { iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden } from './errors'
import { enqueueJob, type Job, type JobHandler } from './jobs'
import { mediaPaths } from './media'
import { notify } from './notify'
import { s3ConfigFromEnv, s3Delete, s3Get, s3List, s3Put, type S3Config, type S3Object } from './s3'

export const BACKUP_FORMAT = 1
export const BACKUP_FILE_SUFFIX = '.sbk'
export const NIGHTLY_KEEP = 14
export const WEEKLY_KEEP = 8

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  createdAt: string
  siteId: string
  siteName: string
  appVersion: string
  includes: Array<'database' | 'originals'>
  originalCount: number
}

export interface BackupStore {
  put(name: string, body: Buffer): Promise<void>
  get(name: string): Promise<Buffer>
  list(): Promise<Array<{ name: string; size: number; lastModified: Date }>>
  delete(name: string): Promise<void>
  kind: 'dir' | 's3'
  location: string
}

export function localBackupStore(dir: string): BackupStore {
  mkdirSync(dir, { recursive: true })
  return {
    kind: 'dir',
    location: dir,
    async put(name, body) {
      writeFileSync(join(dir, name), body)
    },
    async get(name) {
      const path = join(dir, name)
      if (!existsSync(path)) throw new Error(`Backup ${name} was not found.`)
      return readFileSync(path)
    },
    async list() {
      return readdirSync(dir)
        .filter((name) => name.endsWith(BACKUP_FILE_SUFFIX))
        .map((name) => {
          const st = statSync(join(dir, name))
          return { name, size: st.size, lastModified: st.mtime }
        })
    },
    async delete(name) {
      const path = join(dir, name)
      if (existsSync(path)) rmSync(path)
    },
  }
}

export function s3BackupStore(cfg: S3Config): BackupStore {
  return {
    kind: 's3',
    location: `${cfg.endpoint}/${cfg.bucket}${cfg.prefix ? `/${cfg.prefix}` : ''}`,
    put: (name, body) => s3Put(cfg, name, body),
    get: (name) => s3Get(cfg, name),
    list: () => s3List(cfg).then((items) => items.filter((i) => i.name.endsWith(BACKUP_FILE_SUFFIX))),
    delete: (name) => s3Delete(cfg, name),
  }
}

/** Prefer S3 when configured, otherwise a local folder (tests and a last-resort dev path). */
export function resolveBackupStore(env: NodeJS.ProcessEnv = process.env): BackupStore | null {
  const s3 = s3ConfigFromEnv(env)
  if (s3) return s3BackupStore(s3)
  if (env.SITEBUILDER_BACKUP_DIR) return localBackupStore(env.SITEBUILDER_BACKUP_DIR)
  return null
}

function sqliteOf(ctx: ServiceCtx): Database.Database {
  return (ctx.db as unknown as { $client: Database.Database }).$client
}

export function backupFileName(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `backup-${stamp}${BACKUP_FILE_SUFFIX}`
}

export async function sqliteOnlineBackup(ctx: ServiceCtx, destPath: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true })
  const sqlite = sqliteOf(ctx)
  await sqlite.backup(destPath)
}

function packTree(srcDir: string, destTar: string) {
  execFileSync('tar', ['-C', srcDir, '-czf', destTar, '.'], { stdio: 'pipe' })
}

function unpackTree(tarPath: string, destDir: string) {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-C', destDir, '-xzf', tarPath], { stdio: 'pipe' })
}

export interface CreateBackupInput {
  mediaDir: string
  appVersion?: string
  key?: Buffer
}

export async function createBackupArchive(ctx: ServiceCtx, input: CreateBackupInput): Promise<{ bytes: Buffer; manifest: BackupManifest; sha256: string }> {
  const key = input.key ?? secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY)
  const staging = mkdtempSync(join(tmpdir(), 'sitebuilder-backup-'))
  const parent = mkdtempSync(join(tmpdir(), 'sitebuilder-backup-out-'))
  try {
    const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
    const originals = mediaPaths(input.mediaDir).originals
    const originalDir = join(staging, 'originals')
    mkdirSync(originalDir, { recursive: true })
    mkdirSync(join(staging, 'database'), { recursive: true })
    let originalCount = 0
    if (existsSync(originals)) {
      for (const name of readdirSync(originals)) {
        const from = join(originals, name)
        if (!statSync(from).isFile()) continue
        cpSync(from, join(originalDir, name))
        originalCount++
      }
    }
    await sqliteOnlineBackup(ctx, join(staging, 'database', 'sitebuilder.db'))
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      createdAt: iso(ctx),
      siteId: ctx.siteId,
      siteName: site.name,
      appVersion: input.appVersion ?? '0.1.0',
      includes: ['database', 'originals'],
      originalCount,
    }
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    const tar = join(parent, 'payload.tar.gz')
    packTree(staging, tar)
    const bytes = encryptBytes(key, readFileSync(tar))
    return { bytes, manifest, sha256: createHash('sha256').update(bytes).digest('hex') }
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(parent, { recursive: true, force: true })
  }
}

export interface RestoreLayout {
  dbPath: string
  mediaDir: string
}

export function decryptBackupArchive(archive: Buffer, key: Buffer): { manifest: BackupManifest; extractDir: string; cleanup: () => void } {
  const plain = decryptBytes(key, archive)
  const parent = mkdtempSync(join(tmpdir(), 'sitebuilder-restore-'))
  const tar = join(parent, 'payload.tar.gz')
  const extractDir = join(parent, 'extracted')
  writeFileSync(tar, plain)
  unpackTree(tar, extractDir)
  const raw = readFileSync(join(extractDir, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(raw) as BackupManifest
  if (manifest.format !== BACKUP_FORMAT) throw new AppError('validation_failed', `Backup format ${manifest.format} is not supported by this builder.`)
  return {
    manifest,
    extractDir,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  }
}

/** Replace the database file and media originals with the contents of a decrypted archive. */
export function applyRestoredFiles(extracted: string, layout: RestoreLayout) {
  const dbSrc = join(extracted, 'database', 'sitebuilder.db')
  if (!existsSync(dbSrc)) throw new AppError('validation_failed', 'That backup does not contain a database.')
  mkdirSync(dirname(layout.dbPath), { recursive: true })
  // SQLite extras from a previous run would be stale.
  for (const extra of ['', '-wal', '-shm']) {
    const leftover = `${layout.dbPath}${extra}`
    if (existsSync(leftover)) rmSync(leftover)
  }
  cpSync(dbSrc, layout.dbPath)
  const originalsSrc = join(extracted, 'originals')
  const originalsDest = mediaPaths(layout.mediaDir).originals
  mkdirSync(originalsDest, { recursive: true })
  mkdirSync(mediaPaths(layout.mediaDir).renditions, { recursive: true })
  if (existsSync(originalsDest)) {
    for (const name of readdirSync(originalsDest)) rmSync(join(originalsDest, name), { force: true, recursive: true })
  }
  if (existsSync(originalsSrc)) {
    for (const name of readdirSync(originalsSrc)) cpSync(join(originalsSrc, name), join(originalsDest, name))
  }
}

export function backupsToDelete(names: string[], now = new Date()): string[] {
  const dated = names
    .map((name) => ({ name, at: dateFromBackupName(name) }))
    .filter((x): x is { name: string; at: Date } => !!x.at)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
  const keep = new Set<string>()
  const seenDays = new Set<string>()
  for (const item of dated) {
    const day = item.at.toISOString().slice(0, 10)
    if (seenDays.has(day)) continue
    if (seenDays.size >= NIGHTLY_KEEP) break
    seenDays.add(day)
    keep.add(item.name)
  }
  const seenWeeks = new Set<string>()
  for (const item of dated) {
    const week = isoWeek(item.at)
    if (seenWeeks.has(week)) continue
    if (seenWeeks.size >= WEEKLY_KEEP) break
    seenWeeks.add(week)
    keep.add(item.name)
  }
  void now
  return dated.map((d) => d.name).filter((name) => !keep.has(name))
}

export function dateFromBackupName(name: string): Date | null {
  const match = name.match(/^backup-(\d{8}T\d{6})Z\.sbk$/)
  if (!match) return null
  const s = match[1]!
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function pruneBackups(store: BackupStore, now = new Date()): Promise<string[]> {
  const names = (await store.list()).map((i) => i.name)
  const drop = backupsToDelete(names, now)
  for (const name of drop) await store.delete(name)
  return drop
}

export function requestBackup(ctx: ServiceCtx, actor: ActingAs): { jobId: string } {
  if (actor.aiSessionId || !can(actor, 'backups.manage')) throw forbidden()
  const jobId = enqueueJob(ctx, 'backup', { reason: 'manual' }, { createdBy: actor.id })
  return { jobId }
}

export function listBackupJobs(ctx: ServiceCtx, limit = 20) {
  return ctx.db
    .select({ id: jobs.id, state: jobs.state, createdAt: jobs.createdAt, finishedAt: jobs.finishedAt, lastError: jobs.lastError, result: jobs.result })
    .from(jobs)
    .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'backup')))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .all()
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** If no backup is already queued, schedule one. After a successful run, the handler queues the next night. */
export function ensureBackupScheduled(ctx: ServiceCtx, now = ctx.now()): string | null {
  const queued = ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'backup'), eq(jobs.state, 'queued')))
    .get()
  if (queued) return null
  const last = ctx.db
    .select({ finishedAt: jobs.finishedAt, state: jobs.state, createdAt: jobs.createdAt })
    .from(jobs)
    .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'backup')))
    .orderBy(desc(jobs.createdAt))
    .get()
  if (last?.state === 'running') return null
  const lastAt = last?.finishedAt ?? last?.createdAt
  if (lastAt && now.getTime() - Date.parse(lastAt) < 20 * 60 * 60 * 1000) return null
  return enqueueJob(ctx, 'backup', { reason: 'schedule' }, { runAt: now })
}

export function scheduleNextBackup(ctx: ServiceCtx, after: Date): string {
  const next = new Date(after.getTime() + ONE_DAY_MS)
  return enqueueJob(ctx, 'backup', { reason: 'schedule' }, { runAt: next })
}

export function operatorsToNotify(ctx: ServiceCtx): string[] {
  return ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteId, ctx.siteId), eq(users.status, 'active'), eq(users.isOperator, true)))
    .all()
    .map((u) => u.id)
}

export function createBackupHandler(opts: { mediaDir: () => string; store?: BackupStore | null; getStore?: () => BackupStore | null; appVersion?: string }): JobHandler {
  return {
    async run(ctx, job) {
      const store = opts.store !== undefined ? opts.store : (opts.getStore ? opts.getStore() : resolveBackupStore())
      if (!store) return { skipped: 'No backup destination. Set SITEBUILDER_BACKUP_S3_* or SITEBUILDER_BACKUP_DIR.' }
      const built = await createBackupArchive(ctx, { mediaDir: opts.mediaDir(), appVersion: opts.appVersion })
      const name = backupFileName(ctx.now())
      await store.put(name, built.bytes)
      const pruned = await pruneBackups(store, ctx.now())
      if ((job.payload as { reason?: string }).reason === 'schedule' || (job.payload as { reason?: string }).reason === 'manual') {
        const already = ctx.db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'backup'), eq(jobs.state, 'queued')))
          .get()
        if (!already) scheduleNextBackup(ctx, ctx.now())
      }
      return { name, sha256: built.sha256, bytes: built.bytes.length, originals: built.manifest.originalCount, location: store.location, pruned }
    },
    onFinalFailure(ctx, job, error) {
      const message = error instanceof Error ? error.message : String(error)
      const ids = operatorsToNotify(ctx)
      if (ids.length) notify(ctx, ids, 'backup_failed', `A site backup failed: ${message}`)
      void job
    },
  }
}


/** After restore, remake image renditions. Videos are already in place as originals plus a public copy. */
export function enqueueAllRenditions(ctx: ServiceCtx): number {
  const rows = ctx.db.select({ id: media.id, kind: media.kind }).from(media).where(and(eq(media.siteId, ctx.siteId), isNull(media.deletedAt))).all()
  let n = 0
  for (const row of rows) {
    if (row.kind !== 'image') continue
    enqueueJob(ctx, 'media_renditions', { mediaId: row.id }, { createdBy: 'system' })
    n++
  }
  return n
}

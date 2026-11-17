import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sites } from '../server/db/schema'
import { secretKeyFromEnv } from '../server/services/auth'
import { generateSecretKey } from '../server/services/install'
import {
  applyRestoredFiles,
  backupFileName,
  backupsToDelete,
  createBackupArchive,
  createBackupHandler,
  decryptBackupArchive,
  ensureBackupScheduled,
  localBackupStore,
  requestBackup,
} from '../server/services/backup'
import { runJobsOnce } from '../server/services/jobs'
import { s3ConfigFromEnv, s3List, s3Put, setS3Http } from '../server/services/s3'
import { setup } from './helpers'

describe('backup retention', () => {
  it('keeps 14 nightly copies and 8 weekly ones', () => {
    const names: string[] = []
    const start = Date.parse('2026-01-01T02:00:00Z')
    for (let i = 0; i < 80; i++) {
      names.push(backupFileName(new Date(start + i * 24 * 60 * 60 * 1000)))
    }
    const drop = new Set(backupsToDelete(names, new Date('2026-03-22T00:00:00Z')))
    const kept = names.filter((n) => !drop.has(n))
    expect(kept.length).toBeGreaterThanOrEqual(14)
    expect(kept.length).toBeLessThanOrEqual(14 + 8)
    // The most recent 14 days are kept.
    for (const name of names.slice(-14)) expect(drop.has(name)).toBe(false)
  })
})

describe('backup and restore', () => {
  it('writes an encrypted archive and restores the database and originals', async () => {
    const s = setup()
    s.ctx.db.update(sites).set({ name: 'Claire demo' }).where(eq(sites.id, s.ctx.siteId)).run()
    const mediaDir = mkdtempSync(join(tmpdir(), 'sitebuilder-media-'))
    mkdirSync(join(mediaDir, 'originals'), { recursive: true })
    writeFileSync(join(mediaDir, 'originals', 'hero.bin'), 'original-bytes')
    const key = secretKeyFromEnv(generateSecretKey())
    const built = await createBackupArchive(s.ctx, { mediaDir, key, appVersion: '0.1.0' })
    expect(built.bytes.subarray(0, 4).toString()).toBe('SBK1')
    expect(built.manifest.siteName).toBe('Claire demo')
    expect(built.manifest.originalCount).toBe(1)

    const unpacked = decryptBackupArchive(built.bytes, key)
    try {
      expect(unpacked.manifest.siteId).toBe(s.ctx.siteId)
      const dest = mkdtempSync(join(tmpdir(), 'sitebuilder-restore-'))
      const dbPath = join(dest, 'sitebuilder.db')
      const destMedia = join(dest, 'media')
      applyRestoredFiles(unpacked.extractDir, { dbPath, mediaDir: destMedia })
      expect(existsSync(dbPath)).toBe(true)
      expect(readFileSync(join(destMedia, 'originals', 'hero.bin'), 'utf8')).toBe('original-bytes')
    } finally {
      unpacked.cleanup()
    }

    const storeDir = mkdtempSync(join(tmpdir(), 'sitebuilder-bakstore-'))
    const store = localBackupStore(storeDir)
    const handler = createBackupHandler({ mediaDir: () => mediaDir, store, appVersion: '0.1.0' })
    const prev = process.env.SITEBUILDER_SECRET_KEY
    process.env.SITEBUILDER_SECRET_KEY = key.toString('base64')
    try {
      const { jobId } = requestBackup(s.ctx, s.admin)
      while (await runJobsOnce(s.ctx, { backup: handler })) {}
      const listed = await store.list()
      expect(listed.length).toBe(1)
      expect(listed[0]!.name).toMatch(/^backup-.*Z\.sbk$/)
      expect(jobId).toBeTruthy()
    } finally {
      if (prev) process.env.SITEBUILDER_SECRET_KEY = prev
      else delete process.env.SITEBUILDER_SECRET_KEY
    }
  })

  it('skips when no destination is configured, and schedules a job when none is queued', async () => {
    const s = setup()
    const handler = createBackupHandler({ mediaDir: () => '/tmp', store: null })
    const result = await handler.run(s.ctx, { id: 'job_x', kind: 'backup', payload: {} } as never)
    expect(result).toEqual({ skipped: 'No backup destination. Set SITEBUILDER_BACKUP_S3_* or SITEBUILDER_BACKUP_DIR.' })
    const id = ensureBackupScheduled(s.ctx)
    expect(id).toBeTruthy()
    expect(ensureBackupScheduled(s.ctx)).toBeNull()
  })

  it('lists and uploads to S3 with a signed request when credentials are set', async () => {
    const cfg = s3ConfigFromEnv({
      SITEBUILDER_BACKUP_S3_ENDPOINT: 'https://s3.example.test',
      SITEBUILDER_BACKUP_S3_BUCKET: 'backups',
      SITEBUILDER_BACKUP_S3_REGION: 'auto',
      SITEBUILDER_BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      SITEBUILDER_BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
      SITEBUILDER_BACKUP_S3_PREFIX: 'sitebuilder',
    })
    expect(cfg?.bucket).toBe('backups')
    const calls: { method: string; url: string; auth: string | null }[] = []
    setS3Http(async (url, init) => {
      const u = String(url)
      calls.push({ method: String(init?.method), url: u, auth: new Headers(init?.headers).get('authorization') })
      if (init?.method === 'PUT') return new Response('', { status: 200 })
      if (u.includes('list-type=2')) {
        return new Response(
          `<?xml version="1.0"?><ListBucketResult><Contents><Key>sitebuilder/backup-20261117T020000Z.sbk</Key><Size>10</Size><LastModified>2026-11-17T02:00:00Z</LastModified></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`,
          { status: 200 },
        )
      }
      return new Response('no', { status: 404 })
    })
    try {
      await s3Put(cfg!, 'backup-20261117T020000Z.sbk', Buffer.from('hello'))
      const items = await s3List(cfg!)
      expect(items).toEqual([{ name: 'backup-20261117T020000Z.sbk', size: 10, lastModified: new Date('2026-11-17T02:00:00Z') }])
      expect(calls[0]?.method).toBe('PUT')
      expect(calls[0]?.url).toContain('/backups/sitebuilder/backup-20261117T020000Z.sbk')
      expect(calls[0]?.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//)
    } finally {
      setS3Http(null)
    }
  })
})

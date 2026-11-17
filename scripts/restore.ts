#!/usr/bin/env tsx
// Restore a backup: replace the database and media originals, remake renditions, re-render the site.
// The secret key is not in the backup — it must already be in the environment.
// Stop the builder before running this against a live install.
//
//   SITEBUILDER_SECRET_KEY=... SITEBUILDER_DB_PATH=... npx tsx scripts/restore.ts --file /path/to/backup.sbk
//   npx tsx scripts/restore.ts --name backup-20261117T020000Z.sbk   # from the configured store
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { sites } from '../server/db/schema'
import { secretKeyFromEnv } from '../server/services/auth'
import { applyRestoredFiles, decryptBackupArchive, enqueueAllRenditions, resolveBackupStore } from '../server/services/backup'
import { createMediaRenditionsHandler } from '../server/services/media'
import { createPublishHandler, rebuildPublishedSite } from '../server/services/publish'
import { createFileReleaseWriter } from '../server/services/release'
import { runJobsOnce } from '../server/services/jobs'
import { createDefaultRegistry } from '../shared/blocks/registry'
import type { ServiceCtx } from '../server/services/context'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const file = arg('--file')
const name = arg('--name')
const dbPath = process.env.SITEBUILDER_DB_PATH ?? '.data/sitebuilder.db'
const mediaDir = process.env.SITEBUILDER_MEDIA_DIR ?? join(dbPath === ':memory:' ? '.data' : dirname(dbPath), 'media')
const siteRoot = process.env.SITEBUILDER_SITE_ROOT ?? (dbPath === ':memory:' ? '.data' : dirname(dbPath))

if (!file && !name) {
  console.error('Usage: restore.ts --file path.sbk | --name backup-....sbk')
  process.exit(2)
}

const key = secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY)
const bytes = file ? readFileSync(file) : await (async () => {
  const store = resolveBackupStore()
  if (!store) throw new Error('No backup store is configured, and no --file was given.')
  return store.get(name!)
})()

const unpacked = decryptBackupArchive(bytes, key)
try {
  console.log(`Restoring ${unpacked.manifest.siteName} from ${unpacked.manifest.createdAt} (format ${unpacked.manifest.format}).`)
  applyRestoredFiles(unpacked.extractDir, { dbPath, mediaDir })
} finally {
  unpacked.cleanup()
}

const { db } = openDb(dbPath, loadMigrationsFromDir())
const site = db.select().from(sites).get()
if (!site) {
  console.error('The restored database has no site.')
  process.exit(1)
}
const ctx: ServiceCtx = { db, siteId: site.id, registry: createDefaultRegistry(), now: () => new Date() }
const n = enqueueAllRenditions(ctx)
const handlers = {
  media_renditions: createMediaRenditionsHandler(mediaDir),
  publish: createPublishHandler(createFileReleaseWriter(siteRoot)),
}
while (await runJobsOnce(ctx, handlers)) {}
const rebuilt = await rebuildPublishedSite(ctx, createFileReleaseWriter(siteRoot))
console.log(`Restore finished. Remade ${n} image sets. Re-rendered ${rebuilt.pages} pages as ${rebuilt.releaseId}.`)

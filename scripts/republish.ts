#!/usr/bin/env tsx
// Re-render every live page from its live version into a new release (no drafts, no approvals change).
// Use after deploying a renderer fix so the public site picks it up.
//
//   SITEBUILDER_DB_PATH=... SITEBUILDER_SITE_ROOT=... npx tsx scripts/republish.ts
import { dirname } from 'node:path'
import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { sites } from '../server/db/schema'
import { rebuildPublishedSite } from '../server/services/publish'
import { createFileReleaseWriter } from '../server/services/release'
import { createDefaultRegistry } from '../shared/blocks/registry'
import type { ServiceCtx } from '../server/services/context'

const dbPath = process.env.SITEBUILDER_DB_PATH ?? '.data/sitebuilder.db'
const siteRoot = process.env.SITEBUILDER_SITE_ROOT ?? dirname(dbPath)
const { db } = openDb(dbPath, loadMigrationsFromDir())
const site = db.select().from(sites).get()
if (!site) {
  console.error('No site in this database.')
  process.exit(1)
}
const ctx: ServiceCtx = { db, siteId: site.id, registry: createDefaultRegistry(), now: () => new Date() }
const rebuilt = await rebuildPublishedSite(ctx, createFileReleaseWriter(siteRoot))
console.log(`Re-rendered ${rebuilt.pages} live pages as ${rebuilt.releaseId}.`)

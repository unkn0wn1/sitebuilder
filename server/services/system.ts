// System status for operators: version, disk, database, last publish, last backup, job queue.
// See docs/16-operations.md#monitoring.
import { statfsSync, statSync } from 'node:fs'
import { and, desc, eq, sql } from 'drizzle-orm'
import { jobs, releases } from '../db/schema'
import type { ServiceCtx } from './context'

export interface SystemPaths {
  version: string
  dbPath: string
  dataDir: string
}

function disk(dir: string) {
  try {
    const s = statfsSync(dir)
    const total = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    return { totalBytes: total, freeBytes: free, usedPercent: total ? Math.round(((total - free) / total) * 100) : null }
  } catch {
    return null
  }
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size + (statSync(`${path}-wal`, { throwIfNoEntry: false })?.size ?? 0)
  } catch {
    return null
  }
}

export function systemStatus(ctx: ServiceCtx, paths: SystemPaths) {
  const queue = ctx.db
    .select({ lane: jobs.lane, state: jobs.state, n: sql<number>`count(*)` })
    .from(jobs)
    .where(eq(jobs.siteId, ctx.siteId))
    .groupBy(jobs.lane, jobs.state)
    .all()
  const oldestQueued = ctx.db.select({ runAt: jobs.runAt }).from(jobs).where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.state, 'queued'))).orderBy(jobs.runAt).get()
  const failed = ctx.db
    .select({ id: jobs.id, kind: jobs.kind, lastError: jobs.lastError, finishedAt: jobs.finishedAt })
    .from(jobs)
    .where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.state, 'failed')))
    .orderBy(desc(jobs.finishedAt))
    .limit(5)
    .all()
  const lastRelease = ctx.db.select({ id: releases.id, kind: releases.kind, state: releases.state, createdAt: releases.createdAt, finishedAt: releases.finishedAt }).from(releases).where(eq(releases.siteId, ctx.siteId)).orderBy(desc(releases.createdAt)).get()
  const lastBackup = ctx.db.select({ finishedAt: jobs.finishedAt, state: jobs.state }).from(jobs).where(and(eq(jobs.siteId, ctx.siteId), eq(jobs.kind, 'backup'))).orderBy(desc(jobs.createdAt)).get()
  const memory = process.memoryUsage()
  return {
    version: paths.version,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssBytes: memory.rss,
    disk: disk(paths.dataDir),
    databaseBytes: paths.dbPath === ':memory:' ? null : fileSize(paths.dbPath),
    lastRelease: lastRelease ?? null,
    lastBackup: lastBackup ?? null,
    jobs: { counts: queue, oldestQueuedAt: oldestQueued?.runAt ?? null, recentFailures: failed },
  }
}

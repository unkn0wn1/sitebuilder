// Process-wide database handle and service context for Nitro routes.
// In demo mode the handle and paths come from the visitor's sandbox (AsyncLocalStorage).
import { dirname, join } from 'node:path'
import type { DbHandle } from '../db/client'
import { createDefaultRegistry } from '../../shared/blocks/registry'
import type { ServiceCtx } from '../services/context'
import { demoMode } from '../services/demo-mode'
import { currentSandbox } from '../services/demo-sandbox'
import { AppError } from '../services/errors'
import { getOnlySite } from '../services/site'

let handle: DbHandle | null = null
let siteId: string | null = null
const registry = createDefaultRegistry()

let path = ':memory:'

export function setDbHandle(h: DbHandle, dbFile: string) {
  handle = h
  path = dbFile
  siteId = null
}

export function dbPath(): string {
  const sandbox = currentSandbox()
  if (sandbox) return sandbox.dbPath
  if (demoMode()) throw new AppError('not_set_up', 'Demo mode has no process-wide database.')
  return path
}

function dataRoot(): string {
  return path === ':memory:' ? '.data' : dirname(path)
}

/** Where uploaded images and renditions live. Default: a "media" folder next to the database. */
export function mediaDir(): string {
  const sandbox = currentSandbox()
  if (sandbox) return sandbox.mediaPath
  if (demoMode()) throw new AppError('not_set_up', 'Demo mode has no process-wide media directory.')
  return process.env.SITEBUILDER_MEDIA_DIR ?? join(dataRoot(), 'media')
}

/** Site root: `releases/` and the `current` symlink live here, next to the database by default. */
export function siteRoot(): string {
  const sandbox = currentSandbox()
  if (sandbox) return sandbox.sitePath
  if (demoMode()) throw new AppError('not_set_up', 'Demo mode has no process-wide site directory.')
  return process.env.SITEBUILDER_SITE_ROOT ?? dataRoot()
}

export function getDbHandle(): DbHandle {
  const sandbox = currentSandbox()
  if (sandbox) return sandbox.handle
  if (demoMode()) throw new AppError('not_set_up', 'The database is not open yet.')
  if (!handle) throw new AppError('not_set_up', 'The database is not open yet.')
  return handle
}

/** Service context for the one site on this install (ADR 0007). */
export function useServiceCtx(): ServiceCtx {
  const sandbox = currentSandbox()
  if (sandbox) return { db: sandbox.handle.db, siteId: sandbox.siteId, registry, now: () => new Date() }
  if (demoMode()) throw new AppError('not_set_up', 'The database is not open yet.')
  const { db } = getDbHandle()
  if (!siteId) {
    const site = getOnlySite(db)
    if (!site) throw new AppError('not_set_up', 'This builder has not been set up yet. Run the seed or setup script.')
    siteId = site.id
  }
  return { db, siteId, registry, now: () => new Date() }
}

// Process-wide database handle and service context for Nitro routes.
import type { DbHandle } from '../db/client'
import { createDefaultRegistry } from '../../shared/blocks/registry'
import type { ServiceCtx } from '../services/context'
import { AppError } from '../services/errors'
import { getOnlySite } from '../services/site'

let handle: DbHandle | null = null
let siteId: string | null = null
const registry = createDefaultRegistry()

export function setDbHandle(h: DbHandle) {
  handle = h
  siteId = null
}

export function getDbHandle(): DbHandle {
  if (!handle) throw new AppError('not_set_up', 'The database is not open yet.')
  return handle
}

/** Service context for the one site on this install (ADR 0007). */
export function useServiceCtx(): ServiceCtx {
  const { db } = getDbHandle()
  if (!siteId) {
    const site = getOnlySite(db)
    if (!site) throw new AppError('not_set_up', 'This builder has not been set up yet. Run the seed or setup script.')
    siteId = site.id
  }
  return { db, siteId, registry, now: () => new Date() }
}

// What every service function needs. Services are synchronous (better-sqlite3).
import type { Db } from '../db/client'
import type { BlockRegistry } from '../../shared/blocks/registry'
import type { Actor } from '../../shared/roles'

export interface ServiceCtx {
  db: Db
  siteId: string
  registry: BlockRegistry
  now: () => Date
  /** Optional folder for generated preview images (and tests). */
  filesDir?: string
  /** Tests inject a mock provider. Production resolves one from settings and the encrypted key. */
  aiProvider?: import('./ai-provider').ModelProvider
}

/** A person, optionally acting through an AI session they own. */
export interface ActingAs extends Actor {
  aiSessionId?: string
}

export function iso(ctx: ServiceCtx): string {
  return ctx.now().toISOString()
}

export function actorKey(actor: ActingAs): string {
  return actor.aiSessionId ? `ai:${actor.aiSessionId}` : `user:${actor.id}`
}

const depth = new WeakMap<object, number>()

/** Run fn in a transaction, or inside the current one if already in a transaction. */
export function inTx<T>(ctx: ServiceCtx, fn: () => T): T {
  const d = depth.get(ctx.db) ?? 0
  depth.set(ctx.db, d + 1)
  try {
    return d > 0 ? fn() : ctx.db.transaction(() => fn())
  } finally {
    depth.set(ctx.db, d)
  }
}

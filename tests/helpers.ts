import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { createUser } from '../server/services/auth'
import type { ActingAs, ServiceCtx } from '../server/services/context'
import { STARTER_TEMPLATES } from '../server/services/seed-data'
import { createSite } from '../server/services/site'
import { createTemplate } from '../server/services/templates'
import { sites } from '../server/db/schema'
import { eq } from 'drizzle-orm'

export class Clock {
  constructor(public t = Date.parse('2026-11-17T00:00:00Z')) {}
  now = () => new Date(this.t)
  advance(ms: number) {
    this.t += ms
  }
}

const migrations = loadMigrationsFromDir()

export function setup(opts: { selfApproval?: boolean } = {}) {
  const clock = new Clock()
  const { db, sqlite } = openDb(':memory:', migrations)
  const registry = createDefaultRegistry()
  const siteId = createSite({ db, registry, now: clock.now }, { name: 'Test charity', settings: { workflow: { selfApproval: opts.selfApproval ?? false } } })
  const ctx: ServiceCtx = { db, siteId, registry, now: clock.now }
  const mk = (role: 'editor' | 'approver' | 'admin', name: string): ActingAs => {
    const { user } = createUser(ctx, { email: `${name}@example.org`, name, role, password: 'a-long-test-password' })
    return { id: user.id, role: user.role, isOperator: false }
  }
  const editor = mk('editor', 'asha')
  const editor2 = mk('editor', 'sam')
  const approver = mk('approver', 'priya')
  const admin = mk('admin', 'spencer')
  for (const [key, rules] of Object.entries(STARTER_TEMPLATES)) createTemplate(ctx, key, rules, admin.id)
  const setSelfApproval = (on: boolean) => db.update(sites).set({ settings: { workflow: { selfApproval: on } } }).where(eq(sites.id, siteId)).run()
  return { ctx, clock, sqlite, editor, editor2, approver, admin, setSelfApproval }
}

export const IMG = { media: 'med_00000000000000000000000001', alt: 'A dog' }
export const EMB = 'emb_00000000000000000000000001'

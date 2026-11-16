// Assistant memory: site memory (admins edit, everyone reads) and user memory (your own).
// The assistant can only propose entries; a person accepts them. See docs/12-ai-harness.md#memory.
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { can } from '../../shared/roles'
import { memoryEntries } from '../db/schema'
import { audit } from './audit'
import { iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'

export const MEMORY_MAX_CHARS = 300
export const MEMORY_MAX_ENTRIES = 100

type Entry = typeof memoryEntries.$inferSelect

function canEditSite(actor: ActingAs) {
  return !actor.aiSessionId && can(actor, 'memory.site')
}

export function listMemory(ctx: ServiceCtx, actor: ActingAs) {
  const visible = or(
    and(eq(memoryEntries.scope, 'site'), canEditSite(actor) ? undefined : eq(memoryEntries.state, 'active')),
    and(eq(memoryEntries.scope, 'user'), eq(memoryEntries.userId, actor.id)),
  )
  return ctx.db.select().from(memoryEntries).where(and(eq(memoryEntries.siteId, ctx.siteId), visible)).orderBy(desc(memoryEntries.createdAt)).all()
}

/** Active entries for building the assistant's context. */
export function memoryForPrompt(ctx: ServiceCtx, userId: string) {
  return ctx.db
    .select({ scope: memoryEntries.scope, text: memoryEntries.text })
    .from(memoryEntries)
    .where(and(eq(memoryEntries.siteId, ctx.siteId), eq(memoryEntries.state, 'active'), or(eq(memoryEntries.scope, 'site'), eq(memoryEntries.userId, userId))))
    .all()
}

export function addMemory(ctx: ServiceCtx, actor: ActingAs, input: { scope: 'site' | 'user'; text: string }) {
  if (actor.aiSessionId) throw forbidden('The assistant can only propose memory.')
  if (input.scope === 'site' && !canEditSite(actor)) throw forbidden('Only admins can change site memory.')
  const text = input.text.trim()
  if (!text || text.length > MEMORY_MAX_CHARS) throw new AppError('validation_failed', `Keep it to ${MEMORY_MAX_CHARS} characters.`, [{ path: 'text', message: 'Too long or empty.' }])
  const count = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(memoryEntries)
    .where(and(eq(memoryEntries.siteId, ctx.siteId), eq(memoryEntries.scope, input.scope), input.scope === 'user' ? eq(memoryEntries.userId, actor.id) : undefined))
    .get()!.n
  if (count >= MEMORY_MAX_ENTRIES) throw new AppError('validation_failed', 'Memory is full. Delete some entries first.')
  const entry: Entry = { id: newId('memory', ctx.now().getTime()), siteId: ctx.siteId, scope: input.scope, userId: input.scope === 'user' ? actor.id : null, text, state: 'active', createdBy: actor.id, createdAt: iso(ctx) }
  ctx.db.insert(memoryEntries).values(entry).run()
  audit(ctx, actor, 'memory.added', { type: 'memory', id: entry.id }, { scope: entry.scope })
  return entry
}

function requireEntry(ctx: ServiceCtx, actor: ActingAs, id: string): Entry {
  const entry = ctx.db.select().from(memoryEntries).where(and(eq(memoryEntries.id, id), eq(memoryEntries.siteId, ctx.siteId))).get()
  // Someone else's user memory is invisible, so it is "not found" rather than "forbidden".
  if (!entry || (entry.scope === 'user' && entry.userId !== actor.id)) throw notFound('That memory entry')
  if (entry.scope === 'site' && entry.state === 'proposed' && !canEditSite(actor) && entry.createdBy !== actor.id) throw notFound('That memory entry')
  return entry
}

/** Accept an entry the assistant proposed. Site entries need an admin. */
export function acceptMemory(ctx: ServiceCtx, actor: ActingAs, id: string) {
  if (actor.aiSessionId) throw forbidden('The assistant cannot accept memory.')
  const entry = requireEntry(ctx, actor, id)
  if (entry.state !== 'proposed') throw new AppError('invalid_state', 'This entry is already saved.')
  if (entry.scope === 'site' && !canEditSite(actor)) throw forbidden('An admin needs to accept site memory.')
  ctx.db.update(memoryEntries).set({ state: 'active' }).where(eq(memoryEntries.id, id)).run()
  audit(ctx, actor, 'memory.accepted', { type: 'memory', id }, { scope: entry.scope })
  return { ...entry, state: 'active' as const }
}

export function deleteMemory(ctx: ServiceCtx, actor: ActingAs, id: string) {
  if (actor.aiSessionId) throw forbidden('The assistant cannot delete memory.')
  const entry = requireEntry(ctx, actor, id)
  const proposer = entry.state === 'proposed' && entry.createdBy === actor.id
  if (entry.scope === 'site' && !canEditSite(actor) && !proposer) throw forbidden('Only admins can change site memory.')
  ctx.db.delete(memoryEntries).where(eq(memoryEntries.id, id)).run()
  audit(ctx, actor, 'memory.deleted', { type: 'memory', id }, { scope: entry.scope })
}

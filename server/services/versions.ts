// Version snapshots shared by pages and site parts: append-only, with autosave coalescing.
// See docs/13-data-model.md#versions-drafts-and-autosave.
import { and, eq, sql } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { versions, type VersionTargetType } from '../db/schema'
import { actorKey, iso, type ActingAs, type ServiceCtx } from './context'
import { notFound } from './errors'

export type VersionRow = typeof versions.$inferSelect
type Doc = { schemaVersion: number }

/** Autosave coalescing windows. */
export const AUTOSAVE_MAX_SPAN_MS = 5 * 60_000
export const AUTOSAVE_MAX_GAP_MS = 2 * 60_000

export function getVersionRow(ctx: ServiceCtx, id: string): VersionRow {
  const v = ctx.db.select().from(versions).where(and(eq(versions.id, id), eq(versions.siteId, ctx.siteId))).get()
  if (!v) throw notFound('That version')
  return v
}

export function insertVersion(ctx: ServiceCtx, targetType: VersionTargetType, targetId: string, doc: Doc, actor: ActingAs, kind: VersionRow['kind'], sealed: boolean, summary?: string): string {
  const max = ctx.db.select({ n: sql<number>`max(${versions.number})` }).from(versions).where(and(eq(versions.targetType, targetType), eq(versions.targetId, targetId))).get()?.n ?? 0
  const id = newId('version', ctx.now().getTime())
  const now = iso(ctx)
  ctx.db
    .insert(versions)
    .values({ id, siteId: ctx.siteId, targetType, targetId, number: max + 1, doc: doc as Record<string, unknown>, schemaVersion: doc.schemaVersion, kind, actorKey: actorKey(actor), authorId: actor.id, aiSessionId: actor.aiSessionId ?? null, summary: summary ?? null, sealed, createdAt: now, updatedAt: now })
    .run()
  return id
}

/** Save the draft document as a snapshot, coalescing autosaves from the same actor. Returns the head version id. */
export function saveDraftSnapshot(ctx: ServiceCtx, targetType: VersionTargetType, targetId: string, headId: string | null, doc: Doc, actor: ActingAs): string {
  const key = actorKey(actor)
  const now = ctx.now()
  const head = headId ? getVersionRow(ctx, headId) : undefined
  if (head && !head.sealed && head.actorKey === key) {
    const isAi = key.startsWith('ai:')
    const withinSpan = now.getTime() - Date.parse(head.createdAt) <= AUTOSAVE_MAX_SPAN_MS
    const withinGap = now.getTime() - Date.parse(head.updatedAt) <= AUTOSAVE_MAX_GAP_MS
    if (isAi || (withinSpan && withinGap)) {
      ctx.db.update(versions).set({ doc: doc as Record<string, unknown>, updatedAt: now.toISOString() }).where(eq(versions.id, head.id)).run()
      return head.id
    }
  }
  if (head && !head.sealed) ctx.db.update(versions).set({ sealed: true }).where(eq(versions.id, head.id)).run()
  return insertVersion(ctx, targetType, targetId, doc, actor, key.startsWith('ai:') ? 'ai' : 'autosave', false)
}

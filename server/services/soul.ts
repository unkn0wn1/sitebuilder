// Personality text: read the view, and save it with the character budget. Not part of PATCH /settings.
import { eq } from 'drizzle-orm'
import { can } from '../../shared/roles'
import { DEFAULT_SOUL, SOUL_CHAR_LIMIT, SOUL_RAW_MAX, soulBudgetError, soulForPrompt, storedSoul, stripSoulComments } from '../../shared/soul'
import { readSettings } from '../../shared/settings'
import { sites } from '../db/schema'
import { audit } from './audit'
import { inTx, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden } from './errors'

export interface SoulView {
  text: string
  defaultText: string
  strippedLength: number
  limit: number
  rawLimit: number
  isDefault: boolean
}

function view(stored: string | null): SoulView {
  const text = stored ?? DEFAULT_SOUL
  return {
    text,
    defaultText: DEFAULT_SOUL,
    strippedLength: stripSoulComments(text).length,
    limit: SOUL_CHAR_LIMIT,
    rawLimit: SOUL_RAW_MAX,
    isDefault: stored === null,
  }
}

export function getSoul(ctx: ServiceCtx): SoulView {
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  return view(readSettings(site.settings).soul)
}

/** Stripped personality for prompts and agents. Empty when the stored text strips to nothing. */
export function strippedSoul(ctx: ServiceCtx): string {
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()
  return soulForPrompt(site ? readSettings(site.settings).soul : null)
}

/**
 * Write the personality the same way a settings save does, and audit `settings.soul.updated`.
 * Pass `extra` only from an approved agent proposal. A direct save leaves the details as
 * `{ isDefault, strippedLength }`. The caller decides who is allowed to write.
 */
export function applySoul(ctx: ServiceCtx, actor: ActingAs, text: string, extra?: Record<string, unknown>): SoulView {
  const problem = soulBudgetError(text)
  if (problem) throw new AppError('validation_failed', problem)
  const stripped = stripSoulComments(text)
  const soul = storedSoul(text)
  return inTx(ctx, () => {
    const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
    const settings = { ...readSettings(site.settings), soul }
    ctx.db.update(sites).set({ settings }).where(eq(sites.id, ctx.siteId)).run()
    audit(ctx, actor, 'settings.soul.updated', { type: 'site', id: ctx.siteId }, { isDefault: soul === null, strippedLength: stripped.length, ...(extra ?? {}) })
    return view(soul)
  })
}

export function saveSoul(ctx: ServiceCtx, actor: ActingAs, text: string): SoulView {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  return applySoul(ctx, actor, text)
}

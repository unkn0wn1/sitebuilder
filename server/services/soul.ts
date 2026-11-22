// Personality text: read the view, and save it with the character budget. Not part of PATCH /settings.
import { eq } from 'drizzle-orm'
import { can } from '../../shared/roles'
import { DEFAULT_SOUL, SOUL_CHAR_LIMIT, SOUL_RAW_MAX, soulForPrompt, storedSoul, stripSoulComments } from '../../shared/soul'
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

export function saveSoul(ctx: ServiceCtx, actor: ActingAs, text: string): SoulView {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  if (text.length > SOUL_RAW_MAX) {
    throw new AppError('validation_failed', `The personality text is ${text.length} characters. The limit is 200,000.`)
  }
  const stripped = stripSoulComments(text)
  if (stripped.length > SOUL_CHAR_LIMIT) {
    throw new AppError('validation_failed', `The personality the AI sees is ${stripped.length} characters. The limit is 48,000. Comments are not counted.`)
  }
  const soul = storedSoul(text)
  return inTx(ctx, () => {
    const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
    const settings = { ...readSettings(site.settings), soul }
    ctx.db.update(sites).set({ settings }).where(eq(sites.id, ctx.siteId)).run()
    audit(ctx, actor, 'settings.soul.updated', { type: 'site', id: ctx.siteId }, { isDefault: soul === null, strippedLength: stripped.length })
    return view(soul)
  })
}

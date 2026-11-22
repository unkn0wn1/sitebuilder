import { newId } from '../../shared/ids'
import { auditEvents } from '../db/schema'
import { iso, type ActingAs, type ServiceCtx } from './context'

export function audit(
  ctx: ServiceCtx,
  actor: ActingAs | 'system',
  action: string,
  target?: { type: string; id: string },
  details?: Record<string, unknown>,
) {
  ctx.db
    .insert(auditEvents)
    .values({
      id: newId('audit', ctx.now().getTime()),
      siteId: ctx.siteId,
      at: iso(ctx),
      actorType: actor === 'system' ? 'system' : actor.agent ? 'agent' : actor.aiSessionId ? 'ai' : 'user',
      actorId: actor === 'system' ? null : actor.id,
      aiSessionId: actor === 'system' ? null : (actor.aiSessionId ?? null),
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      // For an agent, the token goes in the details (the actor is the person who owns the token).
      details: actor !== 'system' && actor.agent ? { ...details, agent: { tokenId: actor.agent.tokenId, tokenName: actor.agent.tokenName } } : (details ?? null),
    })
    .run()
}

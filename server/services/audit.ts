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
      actorType: actor === 'system' ? 'system' : actor.aiSessionId ? 'ai' : 'user',
      actorId: actor === 'system' ? null : actor.id,
      aiSessionId: actor === 'system' ? null : (actor.aiSessionId ?? null),
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      details: details ?? null,
    })
    .run()
}

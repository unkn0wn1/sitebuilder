// In-app notifications plus email jobs. See docs/16-operations.md#email.
import { and, eq, inArray } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import type { Role } from '../../shared/roles'
import { notifications, users } from '../db/schema'
import { iso, type ServiceCtx } from './context'
import { enqueueJob } from './jobs'

export type NotificationKind = 'review_requested' | 'sent_back' | 'published' | 'publish_failed' | 'emergency_rollback'

export function usersWithRoles(ctx: ServiceCtx, roles: Role[]): string[] {
  return ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteId, ctx.siteId), eq(users.status, 'active'), inArray(users.role, roles)))
    .all()
    .map((u) => u.id)
}

export function notify(
  ctx: ServiceCtx,
  userIds: string[],
  kind: NotificationKind,
  message: string,
  target?: { type: string; id: string },
) {
  for (const userId of new Set(userIds)) {
    ctx.db
      .insert(notifications)
      .values({ id: newId('notification', ctx.now().getTime()), siteId: ctx.siteId, userId, kind, targetType: target?.type ?? null, targetId: target?.id ?? null, message, createdAt: iso(ctx) })
      .run()
    enqueueJob(ctx, 'send_email', { userId, kind, message, target: target ?? null })
  }
}

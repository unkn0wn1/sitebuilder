// Approving or publishing a review that changes custom CSS needs design.css (admin).
// Storing CSS on a draft does not. Agents and editors can carry it; an admin has to let it go live.
// pageCssChanged already treats a removed section that had non-empty CSS as a change, so this gate already requires design.css for that review.
import { eq } from 'drizzle-orm'
import { brandCssChanged, pageCssChanged } from '../../shared/css/changed'
import { can } from '../../shared/roles'
import { users } from '../db/schema'
import { getOrCreateBrand } from './brand'
import type { ActingAs, ServiceCtx } from './context'
import { forbidden } from './errors'
import { requirePage } from './pages'
import { getVersionRow } from './versions'

export interface CssReviewRef {
  targetType: string
  targetId: string
  versionId: string
}

export function reviewIntroducesCustomCss(ctx: ServiceCtx, review: CssReviewRef): boolean {
  const after = getVersionRow(ctx, review.versionId).doc
  if (review.targetType === 'page') {
    const page = requirePage(ctx, review.targetId)
    const before = page.publishedVersionId ? getVersionRow(ctx, page.publishedVersionId).doc : null
    return pageCssChanged(before, after)
  }
  if (review.targetType === 'brand') {
    const pack = getOrCreateBrand(ctx)
    if (pack.id !== review.targetId) return false
    const before = pack.publishedVersionId ? getVersionRow(ctx, pack.publishedVersionId).doc : null
    return brandCssChanged(before, after)
  }
  return false
}

export function assertCanApproveCustomCss(ctx: ServiceCtx, actor: ActingAs, review: CssReviewRef) {
  if (can(actor, 'design.css')) return
  if (!reviewIntroducesCustomCss(ctx, review)) return
  throw forbidden('Custom CSS changes need an admin to approve them.')
}

/** The publish job's own check, for a job that was queued without going through approval. */
export function assertJobMayPublishCss(ctx: ServiceCtx, createdBy: string | null, review: CssReviewRef) {
  if (!reviewIntroducesCustomCss(ctx, review)) return
  const user = createdBy ? ctx.db.select({ role: users.role, isOperator: users.isOperator }).from(users).where(eq(users.id, createdBy)).get() : undefined
  if (!user || !can(user, 'design.css')) throw new Error('Custom CSS changes need an admin to publish them.')
}

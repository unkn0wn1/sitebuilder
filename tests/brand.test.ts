import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { auditEvents } from '../server/db/schema'
import { editBrand, getBrand, submitBrand } from '../server/services/brand'
import { defaultBrandDoc } from '../shared/brand'
import { AppError } from '../server/services/errors'
import { setup } from './helpers'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof AppError) return e.code
    throw e
  }
  return 'ok'
}


describe('brand pack', () => {
  it('creates a default pack, lets an admin edit and submit, and forbids editors', () => {
    const s = setup()
    const first = getBrand(s.ctx)
    expect(first.doc.tokens.accent).toBe('#b5471d')
    expect(first.revision).toBe(0)
    expect(code(() => editBrand(s.ctx, s.editor, 0, defaultBrandDoc()))).toBe('forbidden')
    const next = { ...defaultBrandDoc(), menuStyle: 'mega' as const, tokens: { ...defaultBrandDoc().tokens, accent: '#113399' } }
    const saved = editBrand(s.ctx, s.admin, 0, next)
    expect(saved.revision).toBe(1)
    expect(saved.doc.menuStyle).toBe('mega')
    const sub = submitBrand(s.ctx, s.admin, { note: 'New look' })
    expect(sub.reviewId).toBeTruthy()
    expect(getBrand(s.ctx).pack.workflowState).toBe('in_review')
  })

  it('does not withdraw a pending review when the same draft is saved again', () => {
    const s = setup()
    const next = { ...defaultBrandDoc(), menuStyle: 'mega' as const }
    const saved = editBrand(s.ctx, s.admin, 0, next)
    submitBrand(s.ctx, s.admin)
    expect(getBrand(s.ctx).pack.workflowState).toBe('in_review')
    const again = editBrand(s.ctx, s.admin, saved.revision, next)
    expect(again.reviewWithdrawn).toBe(false)
    expect(again.revision).toBe(saved.revision)
    expect(getBrand(s.ctx).pack.workflowState).toBe('in_review')
    expect(getBrand(s.ctx).review).toBeTruthy()
  })

  it('withdraws a pending review only when the draft actually changes', () => {
    const s = setup()
    const next = { ...defaultBrandDoc(), menuStyle: 'mega' as const }
    const saved = editBrand(s.ctx, s.admin, 0, next)
    submitBrand(s.ctx, s.admin)
    const changed = editBrand(s.ctx, s.admin, saved.revision, { ...next, menuStyle: 'simple' })
    expect(changed.reviewWithdrawn).toBe(true)
    expect(getBrand(s.ctx).pack.workflowState).not.toBe('in_review')
    expect(getBrand(s.ctx).review).toBeNull()
  })

  it('stores site CSS, records that it changed without the text, and rejects a hostile sheet', () => {
    const s = setup()
    const sheet = 'a { text-underline-offset: 0.15em; }'
    const saved = editBrand(s.ctx, s.admin, 0, { ...defaultBrandDoc(), customCss: sheet })
    expect(saved.doc.customCss).toBe(sheet)
    expect(saved.warnings.filter((warning) => warning.path === 'customCss')).toEqual([])
    const edited = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'brand.edited')).all()
    expect(edited.at(-1)?.details).toEqual({ revision: 1, customCss: true })
    expect(JSON.stringify(edited.at(-1)?.details)).not.toContain('text-underline-offset')

    const colour = editBrand(s.ctx, s.admin, saved.revision, { ...saved.doc, tokens: { ...saved.doc.tokens, accent: '#113399' } })
    expect(colour.doc.customCss).toBe(sheet)
    const colourAudit = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'brand.edited')).all().at(-1)
    expect(colourAudit?.details).toEqual({ revision: colour.revision })
    expect(JSON.stringify(colourAudit?.details)).not.toContain('customCss')

    const cleared = editBrand(s.ctx, s.admin, colour.revision, { ...colour.doc, customCss: '  \n' })
    expect(cleared.doc).not.toHaveProperty('customCss')
    const clearAudit = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'brand.edited')).all().at(-1)
    expect(clearAudit?.details).toEqual({ revision: cleared.revision, customCss: true })
    expect(JSON.stringify(clearAudit?.details)).not.toContain('text-underline-offset')

    let rejected: AppError | null = null
    try {
      editBrand(s.ctx, s.admin, cleared.revision, { ...defaultBrandDoc(), customCss: 'a { background: url(javascript:MARKER9f3c) }' })
    } catch (error) {
      rejected = error as AppError
    }
    expect(rejected?.code).toBe('validation_failed')
    expect(rejected?.message).toMatch(/^Line \d+, column \d+:/)
    expect(rejected?.message).not.toContain('MARKER9f3c')
    expect(JSON.stringify(rejected?.fields)).not.toContain('MARKER9f3c')
    expect(getBrand(s.ctx).doc).not.toHaveProperty('customCss')
  })
})

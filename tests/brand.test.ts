import { describe, expect, it } from 'vitest'
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
})

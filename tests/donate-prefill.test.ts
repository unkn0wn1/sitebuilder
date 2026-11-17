import { describe, expect, it } from 'vitest'
import {
  applyRaiseDonorsGiftInfo,
  donateAmountParam,
  normaliseFrequency,
  prefillHint,
  prefillSearchParams,
  readPrefillFromElement,
  virtuousPrefill,
} from '../shared/donate-prefill'

describe('virtuous donate prefill', () => {
  it('parses displayed amounts and ignores placeholders', () => {
    expect(donateAmountParam('₹500')).toBe('500')
    expect(donateAmountParam('₹2,000')).toBe('2000')
    expect(donateAmountParam('TBC')).toBeUndefined()
    expect(donateAmountParam('A gift [placeholder]')).toBeUndefined()
    expect(donateAmountParam(0)).toBeUndefined()
  })

  it('normalises frequency aliases to Virtuous values', () => {
    expect(normaliseFrequency('Monthly')).toBe('monthly')
    expect(normaliseFrequency('one-time')).toBe('once')
    expect(normaliseFrequency('Yearly')).toBe('annually')
    expect(normaliseFrequency('TBC')).toBeUndefined()
    expect(normaliseFrequency('whenever')).toBeUndefined()
  })

  it('builds the documented amount and frequency URL params', () => {
    const prefill = virtuousPrefill({ amount: '₹2,000', frequency: 'Monthly', label: '₹2,000' })
    expect(prefill).toEqual({ amount: '2000', frequency: 'monthly', label: '₹2,000' })
    expect(prefillSearchParams('', prefill)).toBe('?amount=2000&frequency=monthly')
    expect(prefillSearchParams('?utm=spring', prefill)).toBe('?utm=spring&amount=2000&frequency=monthly')
  })

  it('sets window.RaiseDonorsForms.settings.giftInfo without dropping other settings', () => {
    const w: Record<string, unknown> = { RaiseDonorsForms: { settings: { donorInfo: { email: 'a@example.org' }, giftInfo: { comments: 'Keep' } } } }
    applyRaiseDonorsGiftInfo(w, { amount: '500', frequency: 'once' })
    const forms = w.RaiseDonorsForms as { settings: { donorInfo: { email: string }; giftInfo: { amount: number; frequency: string; comments: string } } }
    expect(forms.settings.donorInfo.email).toBe('a@example.org')
    expect(forms.settings.giftInfo).toEqual({ comments: 'Keep', amount: 500, frequency: 'once' })
  })

  it('reads data attributes from a tier button and writes a fallback hint', () => {
    const prefill = readPrefillFromElement({
      getAttribute: (name) => ({ 'data-donate-amount': '₹500', 'data-donate-frequency': 'monthly', 'data-donate-label': '₹500' })[name] ?? null,
    })
    expect(prefillHint(prefill)).toBe('Selected: ₹500, monthly. You can change this on the form.')
  })
})

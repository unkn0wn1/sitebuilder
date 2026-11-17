import { describe, expect, it } from 'vitest'
import { formatMoney, hasEnded, parseAmount, progressPercent } from '../shared/amounts'

describe('amounts and campaign dates', () => {
  it('parses rupee and comma-grouped figures', () => {
    expect(parseAmount('₹1,20,000')).toBe(120000)
    expect(parseAmount('87,400')).toBe(87400)
    expect(progressPercent('87,400', '2,50,000')).toBe(35)
    expect(formatMoney('₹', '87,400')).toBe('₹87,400')
  })

  it('treats an end date as the end of that UTC day', () => {
    expect(hasEnded('2026-12-01', new Date('2026-12-01T23:59:59.000Z'))).toBe(false)
    expect(hasEnded('2026-12-01', new Date('2026-12-02T00:00:00.000Z'))).toBe(true)
  })
})

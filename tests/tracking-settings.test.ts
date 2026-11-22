import { describe, expect, it } from 'vitest'
import { ga4SkippedBecauseGtm } from '../shared/settings'

describe('ga4SkippedBecauseGtm', () => {
  it('is true only when both ga4 and gtm are non-empty', () => {
    expect(ga4SkippedBecauseGtm({ ga4: 'G-ABC123XYZ', gtm: 'GTM-ABC1234' })).toBe(true)
    expect(ga4SkippedBecauseGtm({ ga4: '  G-ABC123XYZ  ', gtm: ' GTM-ABC1234 ' })).toBe(true)
    expect(ga4SkippedBecauseGtm({ ga4: 'G-ABC123XYZ', gtm: null })).toBe(false)
    expect(ga4SkippedBecauseGtm({ ga4: null, gtm: 'GTM-ABC1234' })).toBe(false)
    expect(ga4SkippedBecauseGtm({ ga4: null, gtm: null })).toBe(false)
    expect(ga4SkippedBecauseGtm({})).toBe(false)
    expect(ga4SkippedBecauseGtm({ ga4: '', gtm: 'GTM-ABC1234' })).toBe(false)
    expect(ga4SkippedBecauseGtm({ ga4: 'G-ABC123XYZ', gtm: '' })).toBe(false)
    expect(ga4SkippedBecauseGtm({ ga4: '   ', gtm: 'GTM-ABC1234' })).toBe(false)
    expect(ga4SkippedBecauseGtm({ ga4: 'G-ABC123XYZ', gtm: '   ' })).toBe(false)
  })
})

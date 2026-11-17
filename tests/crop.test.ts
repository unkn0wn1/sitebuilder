import { describe, expect, it } from 'vitest'
import { cropRectError, defaultCropRect, nearestCommonRatio, ratioFromSize } from '../shared/crop'

describe('crop geometry', () => {
  it('simplifies slot sizes to a short ratio, snapping awkward sizes to a common one', () => {
    expect(ratioFromSize(1280, 720)).toBe('16:9')
    expect(ratioFromSize(960, 720)).toBe('4:3')
    expect(ratioFromSize(800, 800)).toBe('1:1')
    expect(ratioFromSize(1280, 853)).toBe('3:2')
    expect(nearestCommonRatio(1280 / 853)).toBe('3:2')
  })

  it('proposes a centred crop, or one around the focal point, that stays inside the image', () => {
    expect(defaultCropRect({ width: 1600, height: 900 }, '16:9')).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
    expect(defaultCropRect({ width: 1600, height: 900 }, '1:1')).toEqual({ x: 350, y: 0, width: 900, height: 900 })
    const focused = defaultCropRect({ width: 1600, height: 900, focalX: 200, focalY: 100 }, '1:1')
    expect(focused).toEqual({ x: 0, y: 0, width: 900, height: 900 })
    expect(cropRectError({ width: 1600, height: 900 }, '1:1', focused)).toBeNull()
    expect(cropRectError({ width: 1600, height: 900 }, '1:1', { x: 0, y: 0, width: 800, height: 400 })).toMatch(/isn't 1:1/)
    expect(cropRectError({ width: 1600, height: 900 }, '1:1', { x: 1000, y: 0, width: 900, height: 900 })).toMatch(/outside/)
  })
})

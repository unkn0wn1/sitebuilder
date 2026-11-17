import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { squareMarkFromLogo } from '../server/services/brand-icons'

async function wordmark() {
  const mark = await sharp({ create: { width: 90, height: 90, channels: 4, background: { r: 230, g: 120, b: 40, alpha: 1 } } }).png().toBuffer()
  const word = await sharp({ create: { width: 160, height: 40, channels: 4, background: { r: 5, g: 83, b: 103, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: mark, left: 10, top: 15 },
      { input: word, left: 130, top: 40 },
    ])
    .png()
    .toBuffer()
}

describe('brand icons from a logo', () => {
  it('crops a wide wordmark to the left-hand mark', async () => {
    const square = await squareMarkFromLogo(await wordmark(), 64)
    const meta = await sharp(square).metadata()
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(64)
    expect(meta.hasAlpha).toBe(true)
    const { dominant } = await sharp(square).stats()
    expect(dominant.r).toBeGreaterThan(dominant.b + 40)
    expect(dominant.r).toBeGreaterThan(120)
  })
})

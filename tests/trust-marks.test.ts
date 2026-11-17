import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_MARK } from '../shared/page-brief'
import { classifyTrustMedia, collectTrustStrip, isTrustMedia } from '../shared/trust-marks'

const candidPng = { id: 'med_candid_png', filename: 'candid-seal.png', alt: 'Candid seal for Animal Aid Unlimited', kind: 'image' }
const candidSvg = { id: 'med_candid_svg', filename: 'candid-seal.svg', alt: 'Candid seal for Animal Aid Unlimited', kind: 'svg' }
const navigator = { id: 'med_nav', filename: 'charity-navigator-three-star.png', alt: 'Charity Navigator Three-Star Rating badge', kind: 'image' }
const kayak = { id: 'med_kayak', filename: 'featured-on-kayak.png', alt: 'Featured on Kayak', kind: 'image' }
const puppy = { id: 'med_puppy', filename: 'hero-poster.jpg', alt: 'A rescued puppy wrapped in a blanket in the hospital', kind: 'image' }

describe('collectTrustStrip', () => {
  it('classifies known seals and ignores ordinary photos', () => {
    expect(classifyTrustMedia(candidSvg)).toBe('candid')
    expect(classifyTrustMedia(navigator)).toBe('charity_navigator')
    expect(classifyTrustMedia(kayak)).toBe('kayak')
    expect(isTrustMedia(puppy)).toBe(false)
  })

  it('returns null when the library has no real marks', () => {
    expect(collectTrustStrip({ media: [puppy] })).toBeNull()
    expect(
      collectTrustStrip({
        existing: [{ heading: 'Give with confidence', items: [{ name: `A trusted mark ${PLACEHOLDER_MARK}` }] }],
      }),
    ).toBeNull()
  })

  it('fills a strip from library media without inventing ratings or using placeholders', () => {
    const strip = collectTrustStrip({ media: [puppy, candidPng, candidSvg, navigator, kayak] })
    expect(strip).not.toBeNull()
    expect(strip!.heading).toBe('Give with confidence')
    expect(strip!.intro).not.toMatch(/placeholder|TBC/i)
    expect(strip!.items.map((i) => i.name)).toEqual(['Candid', 'Charity Navigator', 'Kayak'])
    expect(strip!.items[0]!.logo?.media).toBe(candidSvg.id)
    expect(strip!.items.every((item) => item.group === 'Rated by' || item.group === 'Recommended on')).toBe(true)
    expect(JSON.stringify(strip)).not.toContain(PLACEHOLDER_MARK)
    expect(strip!.items.some((item) => /platinum|5 stars|4\.9/i.test(`${item.note ?? ''} ${item.name}`))).toBe(false)
  })

  it('reuses published names, notes, links and badge snippets, and upgrades a raster Candid logo to the SVG', () => {
    const strip = collectTrustStrip({
      media: [candidPng, candidSvg, navigator, kayak],
      existing: [
        {
          heading: 'Give with confidence',
          intro: 'Animal Aid Unlimited’s current public marks, grouped so regulator ratings stay separate from travel recommendations.',
          items: [
            {
              name: 'Candid',
              logo: { media: candidPng.id, alt: 'Candid seal for Animal Aid Unlimited' },
              href: 'https://app.candid.org/profile/8069592/animal-aid-unlimited-71-0884843',
              group: 'Rated by',
            },
            {
              name: 'Charity Navigator',
              logo: { media: navigator.id, alt: 'Charity Navigator Three-Star Rating badge' },
              note: 'Three-Star rating',
              href: 'https://www.charitynavigator.org/ein/710884843',
              group: 'Rated by',
            },
            {
              name: 'Tripadvisor',
              note: 'Recommended on Tripadvisor',
              badgeHtml: '<div id="TA_rated696" class="TA_rated"></div>',
              group: 'Recommended on',
            },
          ],
        },
      ],
    })
    expect(strip!.intro).toContain('Animal Aid Unlimited')
    expect(strip!.items.map((i) => i.name)).toEqual(['Candid', 'Charity Navigator', 'Kayak', 'Tripadvisor'])
    const candid = strip!.items.find((i) => i.name === 'Candid')!
    expect(candid.logo?.media).toBe(candidSvg.id)
    expect(candid.href).toContain('app.candid.org')
    const nav = strip!.items.find((i) => i.name === 'Charity Navigator')!
    expect(nav.note).toBe('Three-Star rating')
    expect(strip!.items.find((i) => i.name === 'Tripadvisor')!.badgeHtml).toContain('TA_rated696')
  })
})

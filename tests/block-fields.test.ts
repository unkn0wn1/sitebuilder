import { describe, expect, it } from 'vitest'
import { fieldsForBlock, blockLabel, headingProp, blockCatalog, imageSlotFor, visibleFieldsForBlock, visibleListItemFields } from '../app/utils/block-fields'
import { scopeThemeCss } from '../app/utils/theme-css'

describe('block fields', () => {
  it('describes a Hero for the inspector', () => {
    const fields = fieldsForBlock('Hero')
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
    expect(byName.heading).toMatchObject({ kind: 'text', max: 80, optional: false, label: 'Heading' })
    expect(byName.subheading).toMatchObject({ kind: 'text', max: 160, optional: true })
    expect(byName.image).toMatchObject({ kind: 'image', label: 'Photo' })
    expect(byName.cta).toMatchObject({ kind: 'link', label: 'Button', optional: true })
    expect(byName.tone).toMatchObject({ kind: 'enum', options: ['primary', 'neutral', 'accent'] })
    expect(byName.mode).toMatchObject({
      kind: 'enum',
      label: 'Layout',
      options: ['image', 'video', 'image-carousel', 'video-carousel'],
    })
    expect(byName.slides).toMatchObject({ kind: 'list', label: 'Slides' })
    expect(byName.poster).toMatchObject({ kind: 'image', label: 'Poster' })
    expect(byName.video).toMatchObject({ kind: 'media', label: 'Video' })
  })

  it('shows Hero fields for the current layout and keeps hidden values in the props', () => {
    const oldHero = { heading: 'Keep them warm', image: { media: 'med_x', alt: 'A dog' } }
    const single = visibleFieldsForBlock('Hero', oldHero).map((field) => field.name)
    expect(single).toEqual(expect.arrayContaining(['heading', 'subheading', 'image', 'cta', 'tone', 'mode']))
    for (const hidden of ['poster', 'video', 'slides']) expect(single).not.toContain(hidden)

    const video = visibleFieldsForBlock('Hero', { mode: 'video', slides: [{ heading: 'Kept' }] }).map((field) => field.name)
    expect(video).toEqual(expect.arrayContaining(['poster', 'video', 'image']))
    expect(video).not.toContain('slides')

    for (const mode of ['image-carousel', 'video-carousel']) {
      const carousel = visibleFieldsForBlock('Hero', { mode, slides: [{ heading: 'Kept' }] }).map((field) => field.name)
      expect(carousel).toContain('slides')
      for (const hidden of ['image', 'poster', 'video']) expect(carousel).not.toContain(hidden)
    }

    const slides = fieldsForBlock('Hero').find((field) => field.name === 'slides')!
    expect(visibleListItemFields('Hero', slides, { mode: 'image-carousel' }).map((field) => field.name)).not.toContain('video')
    expect(visibleListItemFields('Hero', slides, { mode: 'video-carousel' }).map((field) => field.name)).toContain('video')
    expect(visibleListItemFields('Hero', slides, {}).map((field) => field.name)).not.toContain('video')

    const faq = fieldsForBlock('FAQ').find((field) => field.name === 'items')!
    expect(visibleListItemFields('FAQ', faq, { mode: 'image-carousel' }).map((field) => field.name)).toEqual(faq.item?.map((field) => field.name))
    expect(visibleFieldsForBlock('FAQ', {}).map((field) => field.name)).toEqual(fieldsForBlock('FAQ').map((field) => field.name))
    expect(oldHero).toEqual({ heading: 'Keep them warm', image: { media: 'med_x', alt: 'A dog' } })
  })

  it('describes rich text and lists', () => {
    expect(fieldsForBlock('RichText')[0]).toMatchObject({ name: 'content', kind: 'richtext' })
    const items = fieldsForBlock('FAQ').find((f) => f.name === 'items')
    expect(items?.kind).toBe('list')
    expect(items?.item?.map((f) => f.kind)).toEqual(['text', 'richtext'])
  })

  it('lists sections with plain labels', () => {
    expect(blockLabel('CallToAction')).toBe('Call to action')
    expect(headingProp('Hero')).toBe('heading')
    expect(blockCatalog().some((b) => b.type === 'VideoHero')).toBe(true)
    expect(imageSlotFor('Hero', 'image')).toEqual({ width: 1280, height: 720, ratio: '16:9' })
    expect(imageSlotFor('Hero', 'poster')).toEqual({ width: 1280, height: 720, ratio: '16:9' })
    expect(imageSlotFor('Hero', 'slides.0.image')).toEqual({ width: 1280, height: 720, ratio: '16:9' })
    expect(imageSlotFor('Image', 'image')?.ratio).toBe('3:2')
  })

  it('describes the new campaign blocks, including grouped trust marks and badge snippets', () => {
    expect(blockLabel('ImpactTiers')).toBe('Impact tiers')
    expect(blockLabel('DonationProgress')).toBe('Donation progress')
    expect(blockLabel('MatchBanner')).toBe('Match or countdown')
    expect(blockLabel('StoryBeforeAfter')).toBe('Story with before and after')
    expect(blockLabel('TrustStrip')).toBe('Trust marks')
    expect(blockCatalog().map((b) => b.type)).toEqual(expect.arrayContaining(['ImpactTiers', 'DonationProgress', 'MatchBanner', 'StoryBeforeAfter', 'TrustStrip']))
    const trustItems = fieldsForBlock('TrustStrip').find((f) => f.name === 'items')
    expect(trustItems?.kind).toBe('list')
    expect(trustItems?.item?.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'logo', 'href', 'badgeHtml', 'group']))
    expect(trustItems?.item?.find((f) => f.name === 'badgeHtml')?.kind).toBe('textarea')
    expect(trustItems?.item?.find((f) => f.name === 'group')?.label).toBe('Group label')
    expect(imageSlotFor('StoryBeforeAfter', 'before')).toEqual({ width: 960, height: 720, ratio: '4:3' })
    expect(imageSlotFor('ImpactTiers', 'items.0.image')).toEqual({ width: 640, height: 480, ratio: '4:3' })
  })
})

describe('scoped theme CSS', () => {
  it('scopes public theme selectors to the canvas', () => {
    const css = scopeThemeCss(':root { --ink: #000; }\nbody { color: var(--ink); }\n.hero h1 { margin: 0; }\n@media (min-width: 700px) {\n  .split { display: grid; }\n}\n')
    expect(css).toContain('.sb-canvas { --ink: #000; }')
    expect(css).toContain('.sb-canvas { color: var(--ink); }')
    expect(css).toContain('.sb-canvas .hero h1 { margin: 0; }')
    expect(css).toContain('.sb-canvas .split { display: grid; }')
    expect(css).toContain('@media (min-width: 700px)')
  })
})

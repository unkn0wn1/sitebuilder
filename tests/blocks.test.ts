import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineBlock, text } from '../shared/blocks/define'
import { createDefaultRegistry, createRegistry } from '../shared/blocks/registry'
import { Hero, SAMPLE_MEDIA_ID, SAMPLE_VIDEO_ID, STARTER_BLOCKS, VideoHero } from '../shared/blocks/library'
import { checkTemplateRules, withLibraryBlockUpdates } from '../shared/templates'
import { migratePageDoc, PageMigrationError } from '../shared/page'

describe('block registry', () => {
  const registry = createDefaultRegistry()

  it('every starter block validates its own sample and produces JSON Schema', () => {
    for (const def of STARTER_BLOCKS) {
      const res = registry.validate({ id: 'b_test1', type: def.type, v: def.version, props: def.sample as Record<string, unknown> })
      expect(res.ok, def.type).toBe(true)
      expect(registry.jsonSchema(def.type)).toHaveProperty('type', 'object')
    }
  })

  it('gives plain-English issues with paths', () => {
    const res = registry.validate({ id: 'b_test1', type: 'Hero', v: 1, props: { heading: 'x'.repeat(81), image: { media: 'nope' } } }, 'blocks.0.props')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues.map((i) => i.path)).toContain('blocks.0.props.heading')
      expect(res.issues.find((i) => i.path === 'blocks.0.props.heading')?.message).toMatch(/under 80/)
    }
  })

  it('migrates old blocks forward on read', () => {
    const v1 = { type: 'Banner', version: 1, label: 'Banner', category: 'Text' as const, props: z.object({ title: text({ max: 50, required: true }) }), sample: { title: 'x' } }
    const v2 = defineBlock({
      ...v1,
      version: 2,
      props: z.object({ heading: text({ max: 50, required: true }), tone: z.enum(['a', 'b']) }),
      migrations: { 1: ({ title, ...rest }) => ({ ...rest, heading: title, tone: 'a' }) },
      sample: { heading: 'x', tone: 'a' },
    })
    const reg = createRegistry([v2])
    const migrated = reg.migrate({ id: 'b_abcd', type: 'Banner', v: 1, props: { title: 'Old' } })
    expect(migrated).toEqual({ id: 'b_abcd', type: 'Banner', v: 2, props: { heading: 'Old', tone: 'a' } })
    expect(reg.validate(migrated).ok).toBe(true)

    const doc = migratePageDoc({ schemaVersion: 1, title: 'T', seo: {}, blocks: [{ id: 'b_abcd', type: 'Banner', v: 1, props: { title: 'Old' } }] }, reg)
    expect(doc.blocks[0]!.v).toBe(2)
  })

  it('refuses blocks from a newer version and documents from the future', () => {
    expect(() => registry.migrate({ id: 'b_abcd', type: 'Hero', v: 99, props: {} })).toThrow(/newer/)
    expect(() => migratePageDoc({ schemaVersion: 99, title: 'T', seo: {}, blocks: [] }, registry)).toThrow(PageMigrationError)
  })

  it('a block without a migration path cannot be defined', () => {
    expect(() => defineBlock({ type: 'X', version: 2, label: 'X', category: 'Text', props: z.object({}), sample: {} })).toThrow(/no migration/)
  })

  it('accepts an old hero and the four modes, and rejects a broken carousel', () => {
    const image = { media: SAMPLE_MEDIA_ID, alt: 'A rescued puppy wrapped in a blanket' }
    const base = { heading: 'Keep them warm', image }
    const block = (props: Record<string, unknown>) => ({ id: 'b_test1', type: 'Hero', v: 1, props })
    expect(registry.validate(block(Hero.sample as Record<string, unknown>)).ok).toBe(true)
    expect(registry.validate(block(base)).ok).toBe(true)
    expect(registry.validate(block({ ...base, mode: 'image' })).ok).toBe(true)
    expect(registry.validate(block({ ...base, mode: 'video', video: SAMPLE_VIDEO_ID })).ok).toBe(true)
    expect(registry.validate(block({ ...base, mode: 'image-carousel', slides: [{ image }, { image }] })).ok).toBe(true)
    expect(registry.validate(block({ ...base, mode: 'video-carousel', slides: [{ video: SAMPLE_VIDEO_ID }, { video: SAMPLE_VIDEO_ID }] })).ok).toBe(true)

    const noVideo = registry.validate(block({ ...base, mode: 'video' }))
    expect(noVideo.ok).toBe(false)
    if (!noVideo.ok) expect(noVideo.issues.some((issue) => issue.path.endsWith('video'))).toBe(true)

    const oneSlide = registry.validate(block({ ...base, mode: 'video-carousel', slides: [{ video: SAMPLE_VIDEO_ID }] }))
    expect(oneSlide.ok).toBe(false)
    if (!oneSlide.ok) expect(oneSlide.issues.some((issue) => issue.path.endsWith('slides'))).toBe(true)

    const noImage = registry.validate(block({ ...base, mode: 'image-carousel', slides: [{ image }, { heading: 'Second' }] }))
    expect(noImage.ok).toBe(false)
    if (!noImage.ok) expect(noImage.issues.some((issue) => issue.path.endsWith('image'))).toBe(true)
  })

  it('treats a VideoHero as satisfying a required Hero on a Home page', () => {
    const rules = { schemaVersion: 1 as const, label: 'Home', allowedBlocks: ['Hero', 'VideoHero', 'RichText'], requiredBlocks: ['Hero'], startingBlocks: [] }
    expect(checkTemplateRules(['VideoHero'], rules, { enforceRequired: true })).toEqual([])
    expect(checkTemplateRules(['RichText'], rules, { enforceRequired: true })[0]?.message).toMatch(/needs a "Hero"/)
    expect(VideoHero.sample.video).toBeTruthy()
  })
})

describe('template library updates', () => {
  it('adds the new campaign blocks to older broad and story templates', () => {
    const broad = withLibraryBlockUpdates({
      schemaVersion: 1,
      label: 'Standard',
      allowedBlocks: ['Hero', 'VideoHero', 'RichText', 'TextAndImage', 'Image', 'Gallery', 'Quote', 'Stats', 'CardGrid', 'CallToAction', 'FAQ', 'DonationEmbed', 'Embed'],
      requiredBlocks: [],
      startingBlocks: [],
    })
    expect(broad.allowedBlocks).toEqual(expect.arrayContaining(['ImpactTiers', 'DonationProgress', 'MatchBanner', 'StoryBeforeAfter', 'TrustStrip']))
    const story = withLibraryBlockUpdates({
      schemaVersion: 1,
      label: 'Story',
      allowedBlocks: ['Hero', 'VideoHero', 'RichText', 'TextAndImage', 'Image', 'Gallery', 'Quote', 'CallToAction', 'DonationEmbed'],
      requiredBlocks: ['RichText'],
      startingBlocks: [],
    })
    expect(story.allowedBlocks).toEqual(expect.arrayContaining(['StoryBeforeAfter', 'TrustStrip']))
    expect(story.allowedBlocks).not.toContain('ImpactTiers')
  })
})

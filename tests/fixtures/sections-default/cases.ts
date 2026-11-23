// Inputs for the sections golden. The HTML next to this file is written by
// scripts/regen-golden.ts. Do not hand-edit those HTML files.
// Hero mode cases cover the four Hero modes. The sample hero in all-blocks stays a single image.
import { Hero, SAMPLE_EMBED_ID, SAMPLE_MEDIA_ID, SAMPLE_VIDEO_ID, STARTER_BLOCKS } from '../../../shared/blocks/library'
import { emptyPageDoc, type PageDoc } from '../../../shared/page'
import { DEFAULT_THEME_TOKENS, themeCssFromTokens } from '../../../shared/theme-css'
import type { EmbedCatalogEntry, MediaCatalogEntry, SiteRenderContext } from '../../../server/services/render'

export const SECTION_RENDER = { pageId: 'pg_sections', versionId: 'ver_1', path: '/' } as const

/** Pinned clock for the MatchThermometer countdown. The sample ends 2026-12-02T04:59:59.000Z. */
export const SECTION_NOW = new Date('2026-11-23T01:00:00.000Z')

export interface SectionCase {
  name: string
  doc: PageDoc
  site: SiteRenderContext
}

/** Stable ids, each matching the block id rule (b_ plus 4 to 16 letters or digits). */
const BLOCK_IDS: Record<string, string> = {
  Hero: 'b_hero',
  VideoHero: 'b_videohero',
  RichText: 'b_richtext',
  TextAndImage: 'b_textandimage',
  Image: 'b_image',
  Gallery: 'b_gallery',
  Quote: 'b_quote',
  Stats: 'b_stats',
  CardGrid: 'b_cardgrid',
  CallToAction: 'b_calltoaction',
  FAQ: 'b_faq0',
  DonationEmbed: 'b_donationembed',
  Embed: 'b_embed',
  ImpactTiers: 'b_impacttiers',
  DonationProgress: 'b_donationprogress',
  MatchBanner: 'b_matchbanner',
  MatchThermometer: 'b_matchthermo',
  StoryBeforeAfter: 'b_storybeforeafter',
  TrustStrip: 'b_truststrip',
}

const image: MediaCatalogEntry = {
  id: SAMPLE_MEDIA_ID,
  width: 1280,
  height: 720,
  alt: null,
  decorative: false,
  status: 'ready',
  kind: 'image',
  mime: 'image/jpeg',
  cropRatios: [],
}

const video: MediaCatalogEntry = {
  id: SAMPLE_VIDEO_ID,
  width: null,
  height: null,
  alt: null,
  decorative: false,
  status: 'ready',
  kind: 'video',
  mime: 'video/mp4',
  cropRatios: [],
}

// DonationEmbed and Embed samples share SAMPLE_EMBED_ID, so one catalog entry
// covers both. Virtuous makes the donation block render its box.
const form: EmbedCatalogEntry = {
  id: SAMPLE_EMBED_ID,
  provider: 'virtuous',
  name: 'Example donation form',
  config: { formId: 'example-form' },
}

function sectionSite(themeCss?: string): SiteRenderContext {
  return {
    name: 'Example charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: null,
    footer: null,
    banner: null,
    menus: {},
    pagesById: {},
    media: { [SAMPLE_MEDIA_ID]: image, [SAMPLE_VIDEO_ID]: video },
    mediaComplete: true,
    embeds: { [SAMPLE_EMBED_ID]: form },
    ...(themeCss ? { themeCss } : {}),
  }
}

function sectionsDoc(): PageDoc {
  const doc = emptyPageDoc('Sections')
  doc.blocks = STARTER_BLOCKS.map((block) => {
    const id = BLOCK_IDS[block.type]
    if (!id) throw new Error(`Add a stable id for ${block.type} in tests/fixtures/sections-default/cases.ts`)
    // The MatchBanner sample ends on 2026-12-01 and hides itself after that day
    // when hideWhenPassed is true. Force it off so this golden does not rot.
    const sample = block.sample as Record<string, unknown>
    const props = block.type === 'MatchBanner' ? { ...sample, hideWhenPassed: false } : sample
    return { id, type: block.type, v: block.version, props }
  })
  return doc
}

const doc = sectionsDoc()

const blockCases: SectionCase[] = [
  { name: 'all-blocks-default', doc, site: sectionSite() },
  {
    name: 'all-blocks-custom-accent',
    doc,
    site: sectionSite(themeCssFromTokens({ ...DEFAULT_THEME_TOKENS, accent: '#113399' })),
  },
]

const heroSample = Hero.sample as Record<string, unknown>
const slideImage = heroSample.image

function heroPage(id: string, props: Record<string, unknown>): PageDoc {
  const doc = emptyPageDoc('Sections')
  doc.blocks = [{ id, type: 'Hero', v: 1, props }]
  return doc
}

/** One page per hero mode. The image case is the old sample, so its hero matches all-blocks. */
export const HERO_MODE_CASES: SectionCase[] = [
  { name: 'hero-image', doc: heroPage('b_hero', heroSample), site: sectionSite() },
  {
    name: 'hero-video',
    doc: heroPage('b_herovid', { ...heroSample, mode: 'video', video: SAMPLE_VIDEO_ID }),
    site: sectionSite(),
  },
  {
    name: 'hero-image-carousel',
    doc: heroPage('b_heroimgc', {
      ...heroSample,
      mode: 'image-carousel',
      slides: [
        { image: slideImage, heading: 'A warm bed tonight', subheading: 'Blankets for every kennel.' },
        { image: slideImage, heading: 'Food and treatment' },
      ],
    }),
    site: sectionSite(),
  },
  {
    name: 'hero-video-carousel',
    doc: heroPage('b_herovidc', {
      ...heroSample,
      mode: 'video-carousel',
      slides: [
        { image: slideImage, video: SAMPLE_VIDEO_ID, heading: 'A warm bed tonight', subheading: 'Blankets for every kennel.' },
        { image: slideImage, video: SAMPLE_VIDEO_ID, heading: 'Food and treatment' },
      ],
    }),
    site: sectionSite(),
  },
]

export const SECTION_CASES: SectionCase[] = [...blockCases, ...HERO_MODE_CASES]

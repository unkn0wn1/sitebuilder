// Inputs for the sections golden. The HTML next to this file is written by
// scripts/regen-golden.ts. Do not hand-edit those HTML files.
// Hero mode cases are appended to HERO_MODE_CASES once those modes exist.
import { SAMPLE_EMBED_ID, SAMPLE_MEDIA_ID, SAMPLE_VIDEO_ID, STARTER_BLOCKS } from '../../../shared/blocks/library'
import { emptyPageDoc, type PageDoc } from '../../../shared/page'
import { DEFAULT_THEME_TOKENS, themeCssFromTokens } from '../../../shared/theme-css'
import type { EmbedCatalogEntry, MediaCatalogEntry, SiteRenderContext } from '../../../server/services/render'

export const SECTION_RENDER = { pageId: 'pg_sections', versionId: 'ver_1', path: '/' } as const

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

/** Append hero mode fixtures here once the four modes exist. */
export const HERO_MODE_CASES: SectionCase[] = []

export const SECTION_CASES: SectionCase[] = [...blockCases, ...HERO_MODE_CASES]

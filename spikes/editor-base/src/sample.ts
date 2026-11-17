import { CURRENT_PAGE_SCHEMA_VERSION, type PageDoc } from '../../../shared/page'
import type { PageMeta } from '../../../shared/ops'

export const sampleDoc: PageDoc = {
  schemaVersion: CURRENT_PAGE_SCHEMA_VERSION,
  title: 'Winter appeal',
  seo: { title: null, description: null, image: null, canonical: null, noindex: false },
  blocks: [
    { id: 'b_hero01', type: 'Hero', v: 1, props: { heading: 'Keep them warm this winter', subheading: 'Your gift pays for blankets, food and treatment.', tone: 'primary' } },
    { id: 'b_text01', type: 'RichText', v: 1, props: { heading: 'How your gift helps' } },
    { id: 'b_quot01', type: 'Quote', v: 1, props: { text: 'They gave him a second chance.', attribution: 'A volunteer' } },
    { id: 'b_cta001', type: 'CallToAction', v: 1, props: { heading: 'Give a warm place tonight', button: { label: 'Donate', href: '#donate' } } },
  ],
}

export const sampleMeta: PageMeta = { slug: 'winter-appeal', parentId: null }

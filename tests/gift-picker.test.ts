import { describe, expect, it } from 'vitest'
import { ImpactTiers } from '../shared/blocks/library'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { emptyPageDoc } from '../shared/page'
import { PICKER_CSS } from '../shared/theme-css'
import { renderPageHtml, type SiteRenderContext } from '../server/services/render'

const registry = createDefaultRegistry()

function site(): SiteRenderContext {
  return {
    name: 'Test charity',
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
    media: {},
    embeds: {},
  }
}

const items = [
  { amount: '$10', title: 'Feeds a recovering dog for a week', explanation: 'Warm meals and clean water while a rescued dog heals.', frequency: 'once' as const, image: { media: 'med_00000000000000000000000001', alt: 'Recovering dogs' } },
  { amount: '$25', title: 'Treats a wound', explanation: 'Cleaning, dressing and medicine for an injured street dog.', frequency: 'monthly' as const },
  { amount: '$50', title: 'Teaches kindness locally', explanation: 'A community visit teaching children how to care for street animals.' },
]

function page(props: Record<string, unknown>, id = 'b_giftpick1') {
  const doc = emptyPageDoc('Give')
  doc.blocks = [{ id, type: 'ImpactTiers', v: 1, props }]
  return doc
}

describe('impact tiers picker', () => {
  it('keeps a missing layout on the card grid', async () => {
    const sample = { ...ImpactTiers.sample }
    const checked = registry.validate({ id: 'b_giftpick1', type: 'ImpactTiers', v: 1, props: sample })
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.props.layout).toBe('grid')
    expect(registry.validate({ id: 'b_giftpick1', type: 'ImpactTiers', v: 1, props: { ...sample, layout: 'picker' } }).ok).toBe(true)
    expect(registry.validate({ id: 'b_giftpick1', type: 'ImpactTiers', v: 1, props: { ...sample, layout: 'tiles' } }).ok).toBe(false)
    expect(registry.validate({ id: 'b_giftpick1', type: 'ImpactTiers', v: 1, props: { ...sample, eyebrow: 'x'.repeat(41) } }).ok).toBe(false)
    expect(registry.validate({ id: 'b_giftpick1', type: 'ImpactTiers', v: 1, props: { ...sample, items: Array.from({ length: 9 }, () => sample.items[0]) } }).ok).toBe(false)

    const grid = await renderPageHtml({ doc: page(sample), pageId: 'pg_give', versionId: 'ver_1', path: '/give', site: site() })
    expect(grid.html).toContain('class="tiers"')
    expect(grid.html).not.toContain('class="ga"')
    expect(grid.html).not.toContain('class="eyebrow"')
    expect(grid.html).not.toContain(PICKER_CSS.trim().slice(0, 24))
    expect(grid.html).not.toContain('/picker.js')

    const withEyebrow = await renderPageHtml({
      doc: page({ ...sample, eyebrow: 'Udaipur, India' }),
      pageId: 'pg_give',
      versionId: 'ver_1',
      path: '/give',
      site: site(),
    })
    expect(withEyebrow.html).toContain('class="eyebrow"')
    expect(withEyebrow.html).toContain('Udaipur, India')
    expect(withEyebrow.html).toContain('class="tiers"')
  })

  it('renders radios, the first item, and the same donate attributes as the grid', async () => {
    const props = { heading: 'How your gift is spent', intro: 'Pick an amount.', layout: 'picker', items, otherAmount: 'Or give a different amount' }
    const grid = await renderPageHtml({
      doc: page({ ...props, layout: 'grid' }),
      pageId: 'pg_give',
      versionId: 'ver_1',
      path: '/give',
      site: site(),
    })
    const picked = await renderPageHtml({ doc: page(props), pageId: 'pg_give', versionId: 'ver_1', path: '/give', site: site() })
    const html = picked.html
    expect(html).toContain(PICKER_CSS)
    expect(html).not.toContain('/picker.js')
    expect(html).toContain('src="/embed.js"')
    expect(html).not.toContain('class="eyebrow"')

    const radios = [...html.matchAll(/<input class="ga-sr"[^>]*>/g)].map((match) => match[0])
    expect(radios).toHaveLength(3)
    expect(radios[0]).toContain('name="it-b_giftpick1"')
    expect(radios[0]).toContain('id="it-b_giftpick1-1"')
    expect(radios[0]).toContain('checked')
    expect(radios[1]).not.toContain('checked')
    expect(radios[2]).not.toContain('checked')

    const figures = [...html.matchAll(/<figure class="ga-f"([^>]*)>/g)].map((match) => match[1] ?? '')
    expect(figures).toHaveLength(3)
    expect(figures[0]).not.toContain('hidden')
    expect(figures[1]).toContain('hidden')
    expect(figures[2]).toContain('hidden')
    expect(html).toContain('for="it-b_giftpick1-3"')
    expect(html).toContain('Teaches kindness locally')
    expect(html).toContain('>Give $50<')
    expect(html).toContain('class="tier-other"')
    expect(html).toContain('Or give a different amount')
    expect(html).toContain('sizes="(max-width: 759px) 100vw, 560px"')

    const gives = [...html.matchAll(/<a class="btn tier-give ga-give"([^>]*)>/g)].map((match) => match[1] ?? '')
    expect(gives).toHaveLength(3)
    expect(gives[0]).not.toContain('hidden')
    expect(gives[1]).toContain('hidden')
    expect(gives[0]).toContain('data-donate-amount="10"')
    expect(gives[0]).toContain('data-donate-frequency="once"')
    expect(gives[1]).toContain('data-donate-amount="25"')
    expect(gives[1]).toContain('data-donate-frequency="monthly"')
    expect(gives[2]).toContain('data-donate-amount="50"')
    expect(gives[2]).not.toContain('data-donate-frequency')
    for (const attr of ['data-donate-amount="10"', 'data-donate-frequency="once"', 'data-donate-amount="25"', 'data-donate-frequency="monthly"', 'data-donate-amount="50"']) {
      expect(grid.html).toContain(attr)
    }

    const second = emptyPageDoc('Give')
    second.blocks = [
      { id: 'b_pickera', type: 'ImpactTiers', v: 1, props },
      { id: 'b_pickerb', type: 'ImpactTiers', v: 1, props: { ...props, heading: 'Another list' } },
    ]
    const both = await renderPageHtml({ doc: second, pageId: 'pg_give', versionId: 'ver_1', path: '/give', site: site() })
    expect(both.html).toContain('name="it-b_pickera"')
    expect(both.html).toContain('name="it-b_pickerb"')
    expect(both.html.match(/name="it-b_pickera"/g)).toHaveLength(3)
    expect(both.html.match(/name="it-b_pickerb"/g)).toHaveLength(3)
  })

  it('draws one ask in the picker: the card button, not a second section button', async () => {
    const props = { heading: 'How your gift is spent', layout: 'picker', items, cta: { label: 'Give now', href: '#donate' } }
    const picked = await renderPageHtml({ doc: page(props), pageId: 'pg_give', versionId: 'ver_1', path: '/give', site: site() })
    expect(picked.html).not.toContain('>Give now</a>')
    expect(picked.html).toContain('ga-give')
    const grid = await renderPageHtml({ doc: page({ ...props, layout: 'grid' }), pageId: 'pg_give', versionId: 'ver_1', path: '/give', site: site() })
    expect(grid.html).toContain('>Give now</a>')
  })
})

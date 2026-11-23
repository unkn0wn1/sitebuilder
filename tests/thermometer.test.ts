import { describe, expect, it } from 'vitest'
import { MatchThermometer } from '../shared/blocks/library'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { emptyPageDoc } from '../shared/page'
import { THERMOMETER_CSS } from '../shared/theme-css'
import {
  ENDED_TEXT,
  barLayout,
  chipText,
  countdownParts,
  gaugeLabel,
  goalTicks,
  thermoFigures,
  tubeLayout,
} from '../shared/thermometer'
import { THERMOMETER_JS, renderPageHtml, type SiteRenderContext } from '../server/services/render'
import { SECTION_NOW } from './fixtures/sections-default/cases'

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

function page(props: Record<string, unknown>) {
  const doc = emptyPageDoc('Match')
  doc.blocks = [{ id: 'b_matchthermo', type: 'MatchThermometer', v: 1, props }]
  return doc
}

const sample = MatchThermometer.sample as Record<string, unknown>

describe('match thermometer figures', () => {
  it('accepts the sample and rejects a bad goal, a bad instant and a fractional donor count', () => {
    expect(registry.validate({ id: 'b_matchthermo', type: 'MatchThermometer', v: 1, props: sample }).ok).toBe(true)
    expect(registry.validate({ id: 'b_matchthermo', type: 'MatchThermometer', v: 1, props: { ...sample, goal: -1 } }).ok).toBe(false)
    expect(registry.validate({ id: 'b_matchthermo', type: 'MatchThermometer', v: 1, props: { ...sample, endsAt: '2026-12-02' } }).ok).toBe(false)
    expect(registry.validate({ id: 'b_matchthermo', type: 'MatchThermometer', v: 1, props: { ...sample, donors: 1.5 } }).ok).toBe(false)
  })

  it('derives the total, the cap and an explicit match used', () => {
    const figures = thermoFigures({ goal: 60000, raised: 14400, matched: 14400, donors: 412, matchCap: 20000 })
    expect(figures.total).toBe(28800)
    expect(figures.percent).toBe(48)
    expect(figures.matchUsed).toBe(14400)
    expect(figures.raisedShare).toBeCloseTo(0.24)
    expect(figures.totalShare).toBeCloseTo(0.48)
    const explicit = thermoFigures({ goal: 60000, raised: 14400, matched: 14400, donors: 1, matchCap: 20000, matchUsed: 5000 })
    expect(explicit.matchUsed).toBe(5000)
    const over = thermoFigures({ goal: 100, raised: 80, matched: 80, donors: 1, matchCap: 50 })
    expect(over.total).toBe(160)
    expect(over.percent).toBe(100)
    expect(over.raisedShare).toBe(0.8)
    expect(over.totalShare).toBe(1)
    const empty = thermoFigures({ goal: 0, raised: 10, matched: 10, donors: 1, matchCap: 0 })
    expect(empty.percent).toBe(0)
    expect(empty.matchUsed).toBe(0)
  })

  it('drops a tick label wherever it meets the badge', () => {
    const ticks = goalTicks('$', 60000)
    const labels = (percent: number) =>
      tubeLayout(percent, 0, percent / 100, ticks)
        .ticks.filter((tick) => tick.showLabel)
        .map((tick) => tick.label)
    expect(labels(48)).toEqual(['$15K', '$45K', '$60K'])
    expect(labels(50)).toEqual(['$15K', '$45K', '$60K'])
    expect(labels(25)).toEqual(['$30K', '$45K', '$60K'])
    expect(labels(24)).toEqual(['$30K', '$45K', '$60K'])
    expect(labels(75)).toEqual(['$15K', '$30K', '$60K'])
    expect(labels(100)).toEqual(['$15K', '$30K', '$45K'])
    expect(labels(10)).toEqual(['$15K', '$30K', '$45K', '$60K'])
    expect(labels(0)).toEqual(['$15K', '$30K', '$45K', '$60K'])
    expect(labels(36)).toEqual(['$15K', '$30K', '$45K', '$60K'])
    for (const percent of [0, 10, 24, 25, 36, 48, 50, 75, 100]) {
      const layout = tubeLayout(percent, 0, percent / 100, ticks)
      expect(layout.ticks.every((tick) => tick.y > 0)).toBe(true)
    }
  })

  it('keeps the phone badge inside the bar viewBox', () => {
    for (const percent of [0, 48, 100]) {
      const bar = barLayout(percent, 0.24, percent / 100)
      expect(bar.badgeX).toBeGreaterThanOrEqual(0)
      expect(bar.badgeX + bar.badgeW).toBeLessThanOrEqual(320)
    }
  })

  it('splits the pinned countdown and the ended state', () => {
    const live = countdownParts(SECTION_NOW, '2026-12-02T04:59:59.000Z')
    expect(live).toEqual({ ended: false, days: 9, hours: 3, minutes: 59, seconds: 59 })
    const ended = countdownParts(new Date('2026-12-02T05:00:00.000Z'), '2026-12-02T04:59:59.000Z')
    expect(ended.ended).toBe(true)
    expect(chipText('$', 20000)).toBe('Match active: every gift matched up to $20,000')
    expect(gaugeLabel('$', 28800, 60000, 48)).toBe('$28,800 of $60,000, 48 percent')
  })
})

describe('match thermometer render', () => {
  it('draws the sample card, the script, and no script on a page without the block', async () => {
    const rendered = await renderPageHtml({ doc: page(sample), pageId: 'pg_match', versionId: 'ver_1', path: '/match', site: site(), now: SECTION_NOW })
    const html = rendered.html
    expect(html).toContain(chipText('$', 20000))
    expect(html).toContain('$28,800')
    expect(html).toContain('$14,400')
    expect(html).toContain('>412<')
    expect(html).toContain('Match fund used')
    expect(html).toContain('aria-label="$28,800 of $60,000, 48 percent"')
    expect(html).toContain('class="th-tube"')
    expect(html).toContain('class="th-bar"')
    expect(html).toContain('>9<')
    expect(html).toContain('>03<')
    expect(html).toContain('>59<')
    expect(html).toContain('Giving Tuesday ends in')
    expect(html).toContain('Tuesday 1 Dec 2026, 11:59 pm US Eastern')
    expect(html).toContain('src="/thermometer.js"')
    expect(html).toContain('id="th-stripe-b_matchthermo"')
    expect(html).toContain('id="th-clip-b_matchthermo"')
    const tubeTicks = html.slice(html.indexOf('class="th-ticks"'), html.indexOf('class="th-scale"'))
    expect(tubeTicks).not.toContain('>$30K<')
    expect(tubeTicks).toContain('>$15K<')
    expect(tubeTicks).toContain('>$45K<')
    expect(tubeTicks).toContain('>$60K<')
    const scale = html.slice(html.indexOf('class="th-scale"'), html.indexOf('class="th-legend"'))
    expect(scale).toContain('>$15K<')
    expect(scale).toContain('>$30K<')
    expect(scale).toContain('>$45K<')
    expect(scale).toContain('>$60K<')
    expect(html).toContain(THERMOMETER_CSS)
    expect(THERMOMETER_CSS).not.toContain('animation')
    expect(THERMOMETER_JS).not.toContain('\u2014')

    const plain = emptyPageDoc('Plain')
    plain.blocks = [{ id: 'b_richtext', type: 'RichText', v: 1, props: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] } } }]
    const other = await renderPageHtml({ doc: plain, pageId: 'pg_plain', versionId: 'ver_1', path: '/plain', site: site(), now: SECTION_NOW })
    expect(other.html).not.toContain('/thermometer.js')
    expect(other.html).not.toContain('class="th"')
    expect(other.html).not.toContain(THERMOMETER_CSS.trim().slice(0, 40))
  })

  it('renders the ended sentence and an explicit match used figure', async () => {
    const ended = await renderPageHtml({
      doc: page(sample),
      pageId: 'pg_match',
      versionId: 'ver_1',
      path: '/match',
      site: site(),
      now: new Date('2026-12-03T00:00:00.000Z'),
    })
    expect(ended.html).toContain(ENDED_TEXT)
    expect(ended.html).not.toContain('class="th-cd"')
    expect(ended.html).toContain('src="/thermometer.js"')

    const used = await renderPageHtml({
      doc: page({ ...sample, matchUsed: 5000 }),
      pageId: 'pg_match',
      versionId: 'ver_1',
      path: '/match',
      site: site(),
      now: SECTION_NOW,
    })
    expect(used.html).toContain('<b>$5,000</b> of $20,000')
    expect(used.html).toContain('value="5000"')
  })
})

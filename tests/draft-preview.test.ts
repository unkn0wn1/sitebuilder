import { describe, expect, it } from 'vitest'
import { previewHtml, renderDraftPreview, previewCsp } from '../server/services/draft-preview'
import { emptyPageDoc } from '../shared/page'
import { richTextFromParagraphs } from '../shared/richtext'
import { setup } from './helpers'

const SAMPLE = 'med_00000000000000000000000001'

describe('editor and approval previews use the publish renderer', () => {
  it('draws the draft as the published page would be, with block ids for click to select', async () => {
    const s = setup()
    const doc = emptyPageDoc('Rescue')
    doc.blocks = [
      { id: 'b_hero0001', type: 'Hero', v: 1, props: { heading: 'From the roadside to recovery', image: { media: SAMPLE, alt: 'A dog' } } },
      { id: 'b_text0001', type: 'RichText', v: 1, props: { content: richTextFromParagraphs(['Thank you.']) } },
    ]
    const { html } = await renderDraftPreview(s.ctx, doc, { path: '/rescue' })
    expect(html).toContain('<h1>From the roadside to recovery</h1>')
    expect(html).toContain('data-block-id="b_hero0001"')
    expect(html).toContain('data-block-id="b_text0001"')
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'self';/)
    expect(html).not.toMatch(/src="\/(menu|islands|embed|header|analytics)\.js"/)
  })

  it('shows a placeholder where a photo is not in the library, and points real photos at a builder route', async () => {
    const s = setup()
    const { media } = await import('../server/db/schema')
    s.ctx.db.update(media).set({ width: 700, height: 500 }).run()
    const doc = emptyPageDoc('Photos')
    doc.blocks = [
      { id: 'b_ti000001', type: 'TextAndImage', v: 1, props: { heading: 'Real', content: richTextFromParagraphs(['x']), image: { media: SAMPLE, alt: 'A dog' } } },
      { id: 'b_ti000002', type: 'TextAndImage', v: 1, props: { heading: 'Lost', content: richTextFromParagraphs(['x']), image: { media: 'med_000000000000000000000000ZZ', alt: 'Gone' } } },
    ]
    const { html } = await renderDraftPreview(s.ctx, doc)
    // The test library has the sample id as a real photo; the unknown id gets the placeholder.
    expect(html).toContain(`/api/v1/preview/media/${SAMPLE}-`)
    expect(html).not.toMatch(/["\s,]\/media\/med_/)
    expect(html).toContain('data-sample-photo')
    expect(html).toContain(encodeURIComponent('Photo not found'))
  })

  it('never fails the whole page for one section that cannot be drawn', async () => {
    const s = setup()
    const doc = emptyPageDoc('Broken')
    doc.blocks = [
      { id: 'b_q0000001', type: 'Quote', v: 1, props: { text: 'Still here' } },
      { id: 'b_rt000001', type: 'RichText', v: 1, props: { content: { type: 'doc', content: [{ type: 'mystery', content: 5 }] } } },
    ]
    const { html } = await renderDraftPreview(s.ctx, doc)
    expect(html).toContain('Still here')
  })

  it('points a see-through header script at the builder asset route', () => {
    const html = previewHtml('<script src="/header.js" defer></script>\n<script type="module" src="/embed.js"></script>', "default-src 'self'; script-src 'self';")
    expect(html).toContain('src="/api/v1/preview/assets/header.js"')
    expect(html).toContain('src="/api/v1/preview/assets/embed.js"')
    expect(html).not.toContain('src="/header.js"')
    expect(html).not.toContain('src="/embed.js"')
  })

  it('only lets the builder’s own scripts run, talks to nothing and frames nothing', () => {
    const csp = previewCsp("default-src 'self'; script-src 'self' https://cdn.virtuoussoftware.com https://www.googletagmanager.com; style-src 'self' 'sha256-x'; connect-src 'self' https://www.google-analytics.com; frame-src https://cdn.virtuoussoftware.com; frame-ancestors 'none';")
    expect(csp).toContain("script-src 'self';")
    expect(csp).not.toContain('googletagmanager')
    expect(csp).not.toContain('virtuous')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-src 'none'")
  })
})

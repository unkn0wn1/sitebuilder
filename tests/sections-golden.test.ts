import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLE_ID, THEME_CSS, renderPageHtml } from '../server/services/render'
import { SECTION_CASES, SECTION_RENDER } from './fixtures/sections-default/cases'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/sections-default')

function bodyOf(html: string): string {
  const start = html.indexOf('<body>')
  const end = html.lastIndexOf('</body>')
  return html.slice(start, end)
}

describe('starter sections match the golden HTML', () => {
  it.each(SECTION_CASES.map((c) => c.name))('%s is byte-identical', async (name) => {
    const sectionCase = SECTION_CASES.find((c) => c.name === name)!
    const rendered = await renderPageHtml({ ...SECTION_RENDER, doc: sectionCase.doc, site: sectionCase.site })
    const expected = readFileSync(join(fixtureDir, `${name}.html`), 'utf8')
    expect(rendered.html).toBe(expected)
    expect(rendered.deps.bundleId).toBe(BUNDLE_ID)
    expect(rendered.html).toContain(rendered.csp)
  })

  it('keeps the default sheet on the stock brand and swaps only the accent on the custom brand', async () => {
    const stock = SECTION_CASES.find((c) => c.name === 'all-blocks-default')!
    const custom = SECTION_CASES.find((c) => c.name === 'all-blocks-custom-accent')!
    const stockHtml = await renderPageHtml({ ...SECTION_RENDER, doc: stock.doc, site: stock.site })
    const customHtml = await renderPageHtml({ ...SECTION_RENDER, doc: custom.doc, site: custom.site })
    expect(stockHtml.html).toContain('<style>' + THEME_CSS + '</style>')
    expect(customHtml.html).toContain('--accent: #113399;')
    expect(customHtml.html).not.toContain('--accent: #b5471d;')
    expect(bodyOf(customHtml.html)).toBe(bodyOf(stockHtml.html))
  })
})

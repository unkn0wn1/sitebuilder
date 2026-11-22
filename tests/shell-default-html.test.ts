import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_CSS, renderPageHtml, type SiteRenderContext } from '../server/services/render'
import { validateSitePartDoc } from '../shared/site-parts'
import { SHELL_CASES, type ShellCase } from './fixtures/shell-default/cases'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/shell-default')

describe('default shell HTML matches the fixtures taken before the renderer change', () => {
  it.each(SHELL_CASES.map((c) => c.name))('%s is byte-identical and inlines only the base theme', async (name) => {
    const shellCase = SHELL_CASES.find((c) => c.name === name)!
    const rendered = await renderPageHtml({ doc: shellCase.doc, pageId: 'pg_home', versionId: 'ver_1', path: '/', site: shellCase.site })
    const expected = readFileSync(join(fixtureDir, `${name}.html`), 'utf8')
    expect(rendered.html).toBe(expected)
    expect(rendered.html).toContain('<style>' + THEME_CSS + '</style>')
  })

  it.each(SHELL_CASES.map((c) => c.name))('%s stays byte-identical after the new defaults are filled in', async (name) => {
    const shellCase = SHELL_CASES.find((c) => c.name === name)!
    const rendered = await renderPageHtml({ doc: shellCase.doc, pageId: 'pg_home', versionId: 'ver_1', path: '/', site: withParsedDefaults(shellCase) })
    const expected = readFileSync(join(fixtureDir, `${name}.html`), 'utf8')
    expect(rendered.html).toBe(expected)
  })
})

function withParsedDefaults(shellCase: ShellCase): SiteRenderContext {
  const site: SiteRenderContext = { ...shellCase.site, menus: { ...shellCase.site.menus } }
  if (site.header) {
    const parsed = validateSitePartDoc('header', site.header.doc)
    if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '))
    site.header = { id: site.header.id, doc: parsed.doc }
  }
  if (site.footer) {
    const parsed = validateSitePartDoc('footer', site.footer.doc)
    if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '))
    site.footer = { id: site.footer.id, doc: parsed.doc }
  }
  if (site.banner) {
    const parsed = validateSitePartDoc('banner', site.banner.doc)
    if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '))
    site.banner = { id: site.banner.id, doc: parsed.doc }
  }
  return site
}

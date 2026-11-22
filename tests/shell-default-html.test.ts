import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_CSS, renderPageHtml } from '../server/services/render'
import { SHELL_CASES } from './fixtures/shell-default/cases'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/shell-default')

describe('default shell HTML matches the fixtures taken before the renderer change', () => {
  it.each(SHELL_CASES.map((c) => c.name))('%s is byte-identical and inlines only the base theme', async (name) => {
    const shellCase = SHELL_CASES.find((c) => c.name === name)!
    const rendered = await renderPageHtml({ doc: shellCase.doc, pageId: 'pg_home', versionId: 'ver_1', path: '/', site: shellCase.site })
    const expected = readFileSync(join(fixtureDir, `${name}.html`), 'utf8')
    expect(rendered.html).toBe(expected)
    expect(rendered.html).toContain('<style>' + THEME_CSS + '</style>')
  })
})

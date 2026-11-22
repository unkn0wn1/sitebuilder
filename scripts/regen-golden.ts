#!/usr/bin/env tsx
// Rewrite golden HTML from the render fixtures. Do not hand-edit the HTML.
//   npm run golden:regen
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPageHtml } from '../server/services/render'
import { SECTION_CASES, SECTION_RENDER } from '../tests/fixtures/sections-default/cases'
import { SHELL_CASES } from '../tests/fixtures/shell-default/cases'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Same page id, version, and path as tests/shell-default-html.test.ts.
const SHELL_RENDER = { pageId: 'pg_home', versionId: 'ver_1', path: '/' } as const

async function writeCases(
  dir: string,
  cases: { name: string; doc: (typeof SHELL_CASES)[number]['doc']; site: (typeof SHELL_CASES)[number]['site'] }[],
  render: { pageId: string; versionId: string; path: string },
) {
  mkdirSync(dir, { recursive: true })
  for (const entry of cases) {
    const rendered = await renderPageHtml({
      doc: entry.doc,
      pageId: render.pageId,
      versionId: render.versionId,
      path: render.path,
      site: entry.site,
    })
    const file = join(dir, `${entry.name}.html`)
    writeFileSync(file, rendered.html)
    console.log(file)
  }
}

await writeCases(join(root, 'tests/fixtures/shell-default'), SHELL_CASES, SHELL_RENDER)
await writeCases(join(root, 'tests/fixtures/sections-default'), SECTION_CASES, SECTION_RENDER)

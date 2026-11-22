import { describe, expect, it } from 'vitest'
import { cssTextChange } from '../app/utils/reviews'
import { runJobsOnce } from '../server/services/jobs'
import { applyPageOps, createPage, getPage } from '../server/services/pages'
import { createPublishHandler } from '../server/services/publish'
import { approveReview, getReview, submitPage, summariseDiff } from '../server/services/reviews'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { runChecks } from '../shared/checks'
import { diffPages, type BlockChange } from '../shared/diff'
import { emptyPageDoc, type PageDoc } from '../shared/page'
import { setup } from './helpers'

const registry = createDefaultRegistry()
const handlers = { publish: createPublishHandler(), send_email: { run: () => ({ skipped: true }) }, purge_cache: { run: () => ({ skipped: true }) } }

function page(blocks: PageDoc['blocks']): PageDoc {
  const doc = emptyPageDoc('Winter appeal')
  doc.blocks = blocks
  return doc
}

function quote(id: string, css?: string, text = 'They gave him a second chance.'): PageDoc['blocks'][number] {
  return { id, type: 'Quote', v: 1, props: { text, attribution: 'A volunteer' }, ...(css !== undefined ? { css } : {}) }
}

function changed(blocks: BlockChange[]) {
  const found = blocks.find((block) => block.kind === 'changed')
  if (!found || found.kind !== 'changed') throw new Error('expected a changed section')
  return found
}

describe('custom CSS diff', () => {
  it('includes css text only when the CSS differs', () => {
    const both = diffPages(page([quote('b_css01', '.a { color: red }', 'One')]), page([quote('b_css01', '.a { color: blue }', 'Two')]))
    expect(changed(both.blocks)).toMatchObject({ fields: ['text', 'css'], cssBefore: '.a { color: red }', cssAfter: '.a { color: blue }' })

    const onlyCss = diffPages(page([quote('b_css01', '.a { color: red }')]), page([quote('b_css01', '.a { color: blue }')]))
    expect(changed(onlyCss.blocks)).toEqual({ kind: 'changed', blockId: 'b_css01', type: 'Quote', fields: ['css'], cssBefore: '.a { color: red }', cssAfter: '.a { color: blue }' })
    expect(summariseDiff(onlyCss, (type) => type.toLowerCase())).toBe('Changed custom CSS')
    expect(cssTextChange(changed(onlyCss.blocks))).toEqual({ before: '.a { color: red }', after: '.a { color: blue }' })

    const propsOnly = diffPages(page([quote('b_css01', '.a { color: red }', 'One')]), page([quote('b_css01', '.a { color: red }', 'Two')]))
    const propsChange = changed(propsOnly.blocks)
    expect(propsChange.fields).toEqual(['text'])
    expect(propsChange).not.toHaveProperty('cssBefore')
    expect(propsChange).not.toHaveProperty('cssAfter')
    expect(cssTextChange(propsChange)).toBeNull()
    expect(summariseDiff(propsOnly, (type) => type.toLowerCase())).toBe('Changed quote')
  })

  it('keeps a new or removed section as added or removed', () => {
    const fresh = diffPages(null, page([quote('b_css01', '.a { color: red }')]))
    expect(fresh.blocks).toEqual([{ kind: 'added', blockId: 'b_css01', type: 'Quote' }])
    expect(cssTextChange(fresh.blocks[0]!)).toBeNull()
    expect(summariseDiff(fresh, (type) => type.toLowerCase())).toBe('Added quote, changed the title')

    const swapped = diffPages(page([quote('b_css01', '.a { color: red }')]), page([quote('b_css02', '.b { color: blue }')]))
    expect(swapped.blocks.map((block) => block.kind).sort()).toEqual(['added', 'removed'])
    for (const block of swapped.blocks) expect(block).not.toHaveProperty('cssBefore')

    const gone = diffPages(page([quote('b_css01', '.a { color: red }')]), page([]))
    expect(gone.blocks).toEqual([{ kind: 'removed', blockId: 'b_css01', type: 'Quote' }])
    expect(summariseDiff(gone, (type) => type.toLowerCase())).toBe('Removed quote')
  })
})

describe('custom CSS checks', () => {
  it('warns on fixed and hiding CSS and does not block', () => {
    const doc = page([
      quote('b_fixed1', '.a { position : fixed ; display:none; opacity: 0.5 }'),
      quote('b_hide01', '.a { visibility: hidden }'),
      quote('b_opac01', '.a { opacity: 0 }'),
      quote('b_plain1', '.a { opacity: 0.5; opacity: 10; position: relative }'),
    ])
    const checks = runChecks(doc, registry, null)
    expect(checks.blocking.filter((issue) => issue.path.endsWith('.css'))).toEqual([])
    expect(checks.warnings.filter((issue) => issue.path === 'blocks.0.css').map((issue) => issue.message)).toEqual([
      'This CSS uses position: fixed, so it can cover other parts of the page.',
      'This CSS hides something (display: none, visibility: hidden or opacity: 0).',
    ])
    expect(checks.warnings.filter((issue) => issue.path === 'blocks.1.css')).toHaveLength(1)
    expect(checks.warnings.filter((issue) => issue.path === 'blocks.2.css')).toHaveLength(1)
    expect(checks.warnings.filter((issue) => issue.path.startsWith('blocks.3.css'))).toEqual([])
  })
})

describe('review of a later CSS edit', () => {
  it('returns css before and after without the live document', async () => {
    const s = setup()
    const { page } = createPage(s.ctx, s.editor, { title: 'Winter appeal', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { id: 'b_css01', type: 'Quote', props: { text: 'They gave him a second chance.', attribution: 'A volunteer' } } }])
    const firstCss = '.wrap { color: #112233 }'
    const secondCss = '.wrap { color: #445566 }'
    applyPageOps(s.ctx, s.admin, page.id, getPage(s.ctx, page.id).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: firstCss }])
    const first = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.admin, first.reviewId, { versionId: first.versionId })
    while (await runJobsOnce(s.ctx, handlers)) {}
    expect(getPage(s.ctx, page.id).page.publishedVersionId).toBeTruthy()

    applyPageOps(s.ctx, s.admin, page.id, getPage(s.ctx, page.id).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: secondCss }])
    const second = submitPage(s.ctx, s.editor, page.id)
    const detail = getReview(s.ctx, s.admin, second.reviewId)
    expect(detail.target.type).toBe('page')
    if (!('diff' in detail)) throw new Error('expected a page review')
    expect(detail).not.toHaveProperty('liveDoc')
    expect(changed(detail.diff.blocks)).toMatchObject({ blockId: 'b_css01', fields: ['css'], cssBefore: firstCss, cssAfter: secondCss })
  })
})

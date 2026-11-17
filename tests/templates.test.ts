import { describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { runJobsOnce } from '../server/services/jobs'
import { createPage } from '../server/services/pages'
import { createPublishHandler } from '../server/services/publish'
import { approveReview } from '../server/services/reviews'
import { createTemplateDraft, editTemplate, getTemplate, getTemplateRules, listTemplates, submitTemplate } from '../server/services/templates'
import { setup } from './helpers'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof AppError) return e.code
    throw e
  }
  return 'ok'
}

const handlers = { publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }

describe('page types', () => {
  it('lets an admin edit and submit, and only applies published rules to new pages', async () => {
    const s = setup()
    expect(getTemplateRules(s.ctx, 'campaign')?.requiredBlocks).toEqual(['Hero', 'DonationEmbed'])
    expect(code(() => editTemplate(s.ctx, s.editor, listTemplates(s.ctx).find((t) => t.key === 'campaign')!.id, 0, getTemplate(s.ctx, listTemplates(s.ctx).find((t) => t.key === 'campaign')!.id).doc))).toBe('forbidden')

    const campaign = listTemplates(s.ctx).find((t) => t.key === 'campaign')!
    const current = getTemplate(s.ctx, campaign.id)
    const next = { ...current.doc, requiredBlocks: ['Hero'] }
    const saved = editTemplate(s.ctx, s.admin, campaign.id, current.revision, next)
    expect(saved.revision).toBe(1)
    expect(saved.doc.requiredBlocks).toEqual(['Hero'])
    // Draft changes must not affect pages until they are published.
    expect(getTemplateRules(s.ctx, 'campaign')?.requiredBlocks).toEqual(['Hero', 'DonationEmbed'])

    const sub = submitTemplate(s.ctx, s.admin, campaign.id, { note: 'Drop the donation form requirement' })
    expect(sub.reviewId).toBeTruthy()
    expect(getTemplate(s.ctx, campaign.id).template.workflowState).toBe('in_review')

    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    await runJobsOnce(s.ctx, handlers)
    expect(getTemplate(s.ctx, campaign.id).template.workflowState).toBe('published')
    expect(getTemplateRules(s.ctx, 'campaign')?.requiredBlocks).toEqual(['Hero'])
  })

  it('creates a draft type that editors cannot use until it is published', async () => {
    const s = setup()
    expect(code(() => createTemplateDraft(s.ctx, s.editor, { key: 'briefing', rules: { schemaVersion: 1, label: 'Briefing', allowedBlocks: ['RichText'], requiredBlocks: [], startingBlocks: [] } }))).toBe('forbidden')
    const created = createTemplateDraft(s.ctx, s.admin, { key: 'briefing', rules: { schemaVersion: 1, label: 'Briefing', allowedBlocks: ['RichText'], requiredBlocks: [], startingBlocks: [] } })
    expect(getTemplateRules(s.ctx, 'briefing')).toBeNull()
    expect(code(() => createPage(s.ctx, s.editor, { title: 'A briefing', template: 'briefing' }))).toBe('validation_failed')
    expect(getTemplate(s.ctx, created.id).template.workflowState).toBe('draft')
    const sub = submitTemplate(s.ctx, s.admin, created.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    await runJobsOnce(s.ctx, handlers)
    expect(getTemplateRules(s.ctx, 'briefing')?.label).toBe('Briefing')
    const page = createPage(s.ctx, s.editor, { title: 'A briefing', template: 'briefing' })
    expect(page.page.template).toBe('briefing')
    const listed = listTemplates(s.ctx).find((t) => t.key === 'briefing')
    expect(listed?.live).toBe(true)
    expect(getTemplate(s.ctx, created.id).template.workflowState).toBe('published')
  })
})

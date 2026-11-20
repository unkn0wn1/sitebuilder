import { AppError } from '../server/services/errors'
import { runJobsOnce } from '../server/services/jobs'
import { applyPageOps, createPage } from '../server/services/pages'
import { createPublishHandler } from '../server/services/publish'
import { approveReview, submitPage } from '../server/services/reviews'
import { createSitePart, editSitePart, submitSitePart } from '../server/services/site-parts'
import { createAgentToken, authenticateAgent } from '../server/services/agent/tokens'
import { setup, IMG } from './helpers'
import { type RichTextDoc } from '../shared/richtext'

export const handlers = { publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }

export const SIGNUP = 'https://old-signup.example.com/winter'
const linked: RichTextDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Join us ' }, { type: 'text', text: 'here', marks: [{ type: 'link', href: SIGNUP }] }, { type: 'text', text: ' tonight.' }] }],
}

export async function code(fn: () => unknown): Promise<string> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof AppError) return e.code
    throw e
  }
  return 'ok'
}

export async function world(rules: unknown[] = [{ label: 'Take links down', actions: ['remove_link', 'edit_text'], result: 'publish' }], extra: Record<string, unknown> = {}) {
  const s = setup()
  // A live "events" page with a text link and a button to the same address, plus a live menu and footer.
  const { page } = createPage(s.ctx, s.editor, { title: 'Events', template: 'standard' })
  applyPageOps(s.ctx, s.editor, page.id, 0, [
    { op: 'set_seo', description: 'Events' },
    { op: 'add_block', block: { type: 'RichText', props: { content: linked } } },
    { op: 'add_block', block: { type: 'Hero', props: { heading: 'Events', image: IMG, cta: { label: 'Sign up', href: SIGNUP } } } },
  ])
  const sub = submitPage(s.ctx, s.editor, page.id)
  approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
  await runJobsOnce(s.ctx, handlers)
  const menuId = createSitePart(s.ctx, 'menu', 'main', 'Menu')
  editSitePart(s.ctx, s.admin, menuId, 0, {
    schemaVersion: 1,
    items: [
      { id: 'b_menu0001', label: 'Home', target: { type: 'url', url: '/' }, children: [] },
      { id: 'b_menu0002', label: 'Sign up', target: { type: 'url', url: SIGNUP }, children: [] },
    ],
  })
  const ms = submitSitePart(s.ctx, s.admin, menuId)
  approveReview(s.ctx, s.approver, ms.reviewId, { versionId: ms.versionId })
  await runJobsOnce(s.ctx, handlers)
  const created = createAgentToken(s.ctx, s.admin, { name: 'Claude at 3am', access: 'draft', rules, ...extra })
  const agent = authenticateAgent(s.ctx, created.secret, null)
  return { ...s, agent, secret: created.secret, tokenId: created.token.id, pageId: page.id, menuId }
}
export type World = Awaited<ReturnType<typeof world>>

/** Run background jobs until none are left (publishing is one job per page or part). */
export async function drain(w: Pick<World, 'ctx'>) {
  for (let i = 0; i < 10; i++) if ((await runJobsOnce(w.ctx, handlers)) === 0) return
}

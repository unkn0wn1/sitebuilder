// Build the immutable Riverside Community Pantry snapshot. Demo mode must be off:
// the hostname and indexing locks would refuse the settings this snapshot needs.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { DEMO_EMAIL, DEMO_PASSWORD } from '../../shared/demo'
import { createDefaultRegistry } from '../../shared/blocks/registry'
import { richTextFromParagraphs } from '../../shared/richtext'
import { openDb, type DbHandle } from '../db/client'
import { loadMigrationsFromDir } from '../db/migrations-fs'
import { pages } from '../db/schema'
import { createUser } from './auth'
import type { ActingAs, ServiceCtx } from './context'
import { assertCurrentLink, chmodGoldenReadOnly, writeGoldenChecksum } from './demo-sandbox'
import { runJobsOnce, type JobHandlers } from './jobs'
import { createMediaRenditionsHandler, uploadMedia } from './media'
import { applyPageOps, createPage } from './pages'
import { createPublishHandler } from './publish'
import { createFileReleaseWriter } from './release'
import { approveReview, submitPage } from './reviews'
import { STARTER_TEMPLATES } from './seed-data'
import { updateSettings } from './settings'
import { createEmbed, createSite } from './site'
import { createSitePart } from './site-parts'
import { createTemplate } from './templates'

const PANTRY = 'Riverside Community Pantry'

async function drain(ctx: ServiceCtx, handlers: JobHandlers) {
  for (let i = 0; i < 40; i++) {
    if (!(await runJobsOnce(ctx, handlers))) return
  }
  throw new Error('Demo golden jobs did not finish.')
}

export async function buildDemoGolden(demoRoot: string, opts: { readOnly?: boolean } = {}): Promise<string> {
  if (process.env.SITEBUILDER_DEMO_MODE === '1') throw new Error('Build the golden snapshot with SITEBUILDER_DEMO_MODE unset.')
  const golden = join(demoRoot, 'golden')
  rmSync(golden, { recursive: true, force: true })
  mkdirSync(golden, { recursive: true })
  const mediaDir = join(golden, 'media')
  const siteRoot = join(golden, 'site')
  mkdirSync(mediaDir, { recursive: true })
  mkdirSync(siteRoot, { recursive: true })

  const handle: DbHandle = openDb(join(golden, 'sitebuilder.db'), loadMigrationsFromDir())
  const { db, sqlite } = handle
  const registry = createDefaultRegistry()
  const now = () => new Date()
  const siteId = createSite(
    { db, registry, now },
    {
      name: PANTRY,
      primaryDomain: 'demo.skewstone.com',
      settings: { seo: { allowIndexing: false, robotsTxt: 'User-agent: *\nDisallow: /\n' }, workflow: { selfApproval: true } },
    },
  )
  const ctx: ServiceCtx = { db, siteId, registry, now }
  const { user } = createUser(ctx, { email: DEMO_EMAIL, name: 'Pantry team', role: 'admin', password: DEMO_PASSWORD })
  const actor: ActingAs = { id: user.id, role: user.role, isOperator: false }
  updateSettings(ctx, actor, {
    workflow: { selfApproval: true },
    seo: { allowIndexing: false, robotsTxt: 'User-agent: *\nDisallow: /\n' },
  })
  for (const [key, rules] of Object.entries(STARTER_TEMPLATES)) createTemplate(ctx, key, rules, user.id)
  const parts = [
    ['header', 'header', 'Header', true],
    ['footer', 'footer', 'Footer', true],
    ['menu', 'main', 'Main menu', true],
    ['banner', 'banner', 'Banner', false],
  ] as const
  for (const [kind, key, label, live] of parts) createSitePart(ctx, kind, key, label, actor, { live })
  const { id: embedId } = createEmbed(ctx, actor, { provider: 'virtuous', name: 'Pantry donations', config: { formId: 'riverside-pantry-form' } })

  const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#1a56db' } }).png().toBuffer()
  const uploaded = await uploadMedia(ctx, actor, { filename: 'pantry-placeholder.png', data: png, mediaDir })
  const handlers: JobHandlers = {
    publish: createPublishHandler(createFileReleaseWriter(siteRoot, { mediaDir })),
    media_renditions: createMediaRenditionsHandler(mediaDir),
  }
  await drain(ctx, handlers)
  const image = { media: uploaded.media.id, alt: 'Blue placeholder for the Riverside Community Pantry' }

  const pagesToBuild: { title: string; template: string; slug: string; blocks: { type: string; props: Record<string, unknown> }[] }[] = [
    {
      title: 'Fresh food for Riverside',
      template: 'home',
      slug: '',
      blocks: [
        { type: 'Hero', props: { heading: 'Fresh food for Riverside', subheading: 'The pantry team shares groceries from 18 Harbour Lane, Riverside.', image, cta: { label: 'Get food', href: '/get-food' } } },
        { type: 'RichText', props: { content: richTextFromParagraphs(['Riverside Community Pantry is a fictional charity used for the public demo.', 'The pantry team packs groceries for neighbours who need them. There is no membership fee.']) } },
        { type: 'CallToAction', props: { heading: 'Bring a bag if you can', text: 'The door at 18 Harbour Lane, Riverside is open on weekday afternoons.', button: { label: 'See opening hours', href: '/get-food' } } },
      ],
    },
    {
      title: 'About the pantry',
      template: 'standard',
      slug: 'about',
      blocks: [
        { type: 'RichText', props: { content: richTextFromParagraphs(['The pantry team is a group of neighbours. This page does not name real people.', 'Food is donated by shops and households in Riverside, then given out from 18 Harbour Lane.']) } },
      ],
    },
    {
      title: 'Get food',
      template: 'standard',
      slug: 'get-food',
      blocks: [
        { type: 'RichText', props: { content: richTextFromParagraphs(['Come to 18 Harbour Lane, Riverside. Bring a bag. You do not need a referral.', 'If the shelf you need is empty, tell the pantry team and they will note it for the next delivery.']) } },
      ],
    },
    {
      title: 'Give food',
      template: 'standard',
      slug: 'give-food',
      blocks: [
        { type: 'RichText', props: { content: richTextFromParagraphs(['Unopened tins, rice, pasta, and cereal can be left at 18 Harbour Lane, Riverside.', 'Money gifts go through the pantry form below. Skewstone does not take the payment itself.']) } },
        { type: 'DonationEmbed', props: { embed: embedId, heading: 'Give to the pantry', anchor: 'donate' } },
        { type: 'CallToAction', props: { heading: 'Thank you', text: 'The pantry team puts gifts on the shelf the same week.', button: { label: 'Back to the start', href: '/' } } },
      ],
    },
  ]

  for (const spec of pagesToBuild) {
    const { page } = createPage(ctx, actor, { title: spec.title, template: spec.template, slug: spec.slug })
    const edited = applyPageOps(
      ctx,
      actor,
      page.id,
      page.draftRevision,
      spec.blocks.map((block) => ({ op: 'add_block' as const, block })),
    )
    if (edited.revision === page.draftRevision) throw new Error(`No blocks were added to ${spec.title}.`)
    const submitted = submitPage(ctx, actor, page.id, { note: 'Demo snapshot' })
    approveReview(ctx, actor, submitted.reviewId, { versionId: submitted.versionId })
  }
  await drain(ctx, handlers)
  const home = db.select({ title: pages.title }).from(pages).where(eq(pages.slug, '')).get()
  if (!home) throw new Error('The golden snapshot has no home page.')

  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite.close()
  rmSync(join(golden, 'sitebuilder.db-wal'), { force: true })
  rmSync(join(golden, 'sitebuilder.db-shm'), { force: true })
  assertCurrentLink(golden)
  writeGoldenChecksum(golden)
  if (opts.readOnly) chmodGoldenReadOnly(golden)
  return golden
}

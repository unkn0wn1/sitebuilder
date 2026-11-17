// The page document. See docs/03-block-model.md and docs/13-data-model.md#page-and-section-documents.
import { z } from 'zod'
import { zodIssues, type FieldIssue } from './issues'
import { mediaId } from './blocks/define'
import type { BlockRegistry, StoredBlock } from './blocks/registry'
import { checkTemplateRules, type TemplateRules } from './templates'
import { cloneDraft } from './clone'

export const CURRENT_PAGE_SCHEMA_VERSION = 1

export const blockIdSchema = z.string().regex(/^b_[a-z0-9]{4,16}$/, { message: 'Not a valid section id.' })

export const storedBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.string().min(1).max(60),
    v: z.number().int().min(1),
    props: z.record(z.string(), z.unknown()),
  })
  .strict()

export const seoSchema = z
  .object({
    title: z.string().trim().max(70, { message: 'Keep the search title under 70 characters.' }).nullable().default(null),
    description: z.string().trim().max(160, { message: 'Keep the description under 160 characters.' }).nullable().default(null),
    image: mediaId.nullable().default(null),
    canonical: z.url({ protocol: /^https$/, message: 'Use a full https:// address.' }).nullable().default(null),
    noindex: z.boolean().default(false),
  })
  .strict()

export type PageSeo = z.infer<typeof seoSchema>

export const pageTitleSchema = z.string().trim().min(1, { message: 'The page needs a title.' }).max(120, { message: 'Keep the title under 120 characters.' })

export const pageDocSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    title: pageTitleSchema,
    seo: seoSchema,
    blocks: z.array(storedBlockSchema).max(100, { message: 'A page can have at most 100 sections.' }),
  })
  .strict()

export type PageDoc = z.infer<typeof pageDocSchema>

/** Whole-document migrations: PAGE_DOC_MIGRATIONS[n] upgrades from schemaVersion n to n + 1. None yet. */
export const PAGE_DOC_MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {}

export class PageMigrationError extends Error {}

/** Migrate a stored document (any older version) to the current format, including every block. Pure. */
export function migratePageDoc(raw: unknown, registry: BlockRegistry): PageDoc {
  if (typeof raw !== 'object' || raw === null) throw new PageMigrationError('Page document is not an object.')
  let doc = raw as Record<string, unknown>
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  if (version > CURRENT_PAGE_SCHEMA_VERSION) throw new PageMigrationError(`Page document version ${version} is newer than this builder.`)
  while (version < CURRENT_PAGE_SCHEMA_VERSION) {
    const step = PAGE_DOC_MIGRATIONS[version]
    if (!step) throw new PageMigrationError(`No page document migration from version ${version}.`)
    doc = step(cloneDraft(doc))
    version++
  }
  const parsed = pageDocSchema.safeParse({ ...doc, schemaVersion: CURRENT_PAGE_SCHEMA_VERSION })
  if (!parsed.success) throw new PageMigrationError(`Stored page document is invalid: ${parsed.error.issues[0]?.message}`)
  return { ...parsed.data, blocks: parsed.data.blocks.map((b) => registry.migrate(b as StoredBlock)) }
}

export function emptyPageDoc(title: string): PageDoc {
  return { schemaVersion: CURRENT_PAGE_SCHEMA_VERSION, title, seo: seoSchema.parse({}), blocks: [] }
}

/**
 * Validate a (migrated) document: shape, every block's props, and the template's rules.
 * Returns the normalised document (defaults filled in) or the issues.
 */
export function validatePageDoc(
  doc: PageDoc,
  registry: BlockRegistry,
  rules: TemplateRules | null,
  opts: { enforceRequired: boolean } = { enforceRequired: false },
): { ok: true; doc: PageDoc } | { ok: false; issues: FieldIssue[] } {
  const shape = pageDocSchema.safeParse(doc)
  if (!shape.success) return { ok: false, issues: zodIssues(shape.error) }
  const issues: FieldIssue[] = []
  const ids = new Set<string>()
  const blocks: StoredBlock[] = []
  shape.data.blocks.forEach((block, i) => {
    if (ids.has(block.id)) issues.push({ path: `blocks.${i}.id`, message: 'Two sections have the same id.' })
    ids.add(block.id)
    const result = registry.validate(block as StoredBlock, `blocks.${i}.props`)
    if (result.ok) blocks.push({ ...(block as StoredBlock), props: result.props })
    else issues.push(...result.issues)
  })
  if (rules) issues.push(...checkTemplateRules(shape.data.blocks.map((b) => b.type), rules, opts))
  if (issues.length) return { ok: false, issues }
  return { ok: true, doc: { ...shape.data, blocks } }
}

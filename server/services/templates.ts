// Templates (page types). Rules live in the template's version document. See docs/03-block-model.md#templates-page-types.
import { and, eq } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { templateRulesSchema, type TemplateRules } from '../../shared/templates'
import { templates, versions } from '../db/schema'
import { iso, type ServiceCtx } from './context'

export function getTemplateRules(ctx: ServiceCtx, key: string): TemplateRules | null {
  const row = ctx.db.select().from(templates).where(and(eq(templates.siteId, ctx.siteId), eq(templates.key, key))).get()
  const versionId = row?.publishedVersionId ?? row?.draftVersionId
  if (!versionId) return null
  const version = ctx.db.select().from(versions).where(eq(versions.id, versionId)).get()
  return version ? templateRulesSchema.parse(version.doc) : null
}

export function listTemplates(ctx: ServiceCtx) {
  return ctx.db
    .select({ id: templates.id, key: templates.key, label: templates.label, state: templates.workflowState })
    .from(templates)
    .where(eq(templates.siteId, ctx.siteId))
    .all()
}

/** Create a template that is live straight away (setup and seeds). Later edits go through drafts and approval. */
export function createTemplate(ctx: ServiceCtx, key: string, rules: TemplateRules, authorId: string): string {
  const parsed = templateRulesSchema.parse(rules)
  for (const type of [...parsed.allowedBlocks, ...parsed.requiredBlocks]) {
    if (!ctx.registry.has(type)) throw new Error(`Template ${key} uses unknown block ${type}`)
  }
  const id = newId('template', ctx.now().getTime())
  const versionId = newId('version', ctx.now().getTime())
  const now = iso(ctx)
  ctx.db
    .insert(templates)
    .values({ id, siteId: ctx.siteId, key, label: parsed.label, draftVersionId: versionId, publishedVersionId: versionId, workflowState: 'published', createdAt: now, updatedAt: now })
    .run()
  ctx.db
    .insert(versions)
    .values({ id: versionId, siteId: ctx.siteId, targetType: 'template', targetId: id, number: 1, doc: parsed, schemaVersion: 1, kind: 'created', actorKey: `user:${authorId}`, authorId, sealed: true, createdAt: now, updatedAt: now })
    .run()
  return id
}

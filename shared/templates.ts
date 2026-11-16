// Templates (page types) are rules, not fixed layouts. See docs/03-block-model.md#templates-page-types.
import { z } from 'zod'
import type { FieldIssue } from './issues'

export const templateRulesSchema = z
  .object({
    label: z.string().min(1).max(60),
    allowedBlocks: z.array(z.string()).min(1),
    requiredBlocks: z.array(z.string()).default([]),
    startingBlocks: z.array(z.object({ type: z.string(), props: z.record(z.string(), z.unknown()) })).default([]),
  })
  .strict()

export type TemplateRules = z.infer<typeof templateRulesSchema>

/** Allowed blocks are always checked. Required blocks only at submission, so half-built drafts can be saved. */
export function checkTemplateRules(blockTypes: string[], rules: TemplateRules, opts: { enforceRequired: boolean }): FieldIssue[] {
  const issues: FieldIssue[] = []
  blockTypes.forEach((type, i) => {
    if (!rules.allowedBlocks.includes(type)) issues.push({ path: `blocks.${i}.type`, message: `A "${type}" section isn't allowed on a ${rules.label} page.` })
  })
  if (opts.enforceRequired) {
    for (const required of rules.requiredBlocks) {
      if (!blockTypes.includes(required)) issues.push({ path: 'blocks', message: `A ${rules.label} page needs a "${required}" section.` })
    }
  }
  return issues
}

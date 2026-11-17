// Templates (page types) are rules, not fixed layouts. See docs/03-block-model.md#templates-page-types.
import { z } from 'zod'
import type { FieldIssue } from './issues'

export const templateRulesSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    label: z.string().trim().min(1).max(60),
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
      const accepted = required === 'Hero' ? ['Hero', 'VideoHero'] : [required]
      if (!accepted.some((type) => blockTypes.includes(type))) issues.push({ path: 'blocks', message: `A ${rules.label} page needs a "${required}" section.` })
    }
  }
  return issues
}

/** Approval checks for a page type itself (not for a page that uses it). */
export function templateChecks(rules: TemplateRules): { blocking: FieldIssue[]; warnings: FieldIssue[] } {
  const blocking: FieldIssue[] = []
  const warnings: FieldIssue[] = []
  if (!rules.allowedBlocks.length) blocking.push({ path: 'allowedBlocks', message: 'A page type needs at least one allowed section.' })
  for (const required of rules.requiredBlocks) {
    const accepted = required === 'Hero' ? ['Hero', 'VideoHero'] : [required]
    if (!accepted.some((type) => rules.allowedBlocks.includes(type))) {
      blocking.push({ path: 'requiredBlocks', message: `A required "${required}" section must also be allowed.` })
    }
  }
  for (const start of rules.startingBlocks) {
    if (!rules.allowedBlocks.includes(start.type)) {
      blocking.push({ path: 'startingBlocks', message: `A new page can't start with a "${start.type}" section that isn't allowed.` })
    }
  }
  if (!rules.startingBlocks.length) warnings.push({ path: 'startingBlocks', message: 'New pages of this type will start empty. You can add starting sections if you want.' })
  return { blocking, warnings }
}

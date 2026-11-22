// Ready-made rule sets for an agent token, so nobody has to write JSON to get a sensible start.
// Each is an ordinary list of rules (see rules.ts); an admin can edit them afterwards.
import type { AgentRuleInput } from './rules'

export interface RulePreset {
  key: string
  label: string
  access: 'read' | 'draft'
  description: string
  rules: AgentRuleInput[]
}

export const RULE_PRESETS: RulePreset[] = [
  {
    key: 'read-only',
    label: 'Read only',
    access: 'read',
    description: 'Can read pages and search. Cannot change anything.',
    rules: [],
  },
  {
    key: 'drafts',
    label: 'Drafts for approval',
    access: 'draft',
    description: 'Can make any draft. Nothing goes live until a person approves it. The safest way to let an AI help.',
    rules: [],
  },
  {
    key: 'takedown',
    label: 'Emergency takedown',
    access: 'draft',
    description: 'May take links down, and undo its own changes within a day, and publish those by itself. Everything else goes to a person.',
    rules: [
      { id: 'takedown', label: 'Take links down', actions: ['remove_link'], result: 'publish', limits: { maxSections: 50, maxPerHour: 10 } },
      { id: 'undo', label: 'Undo within a day', actions: ['undo_change'], result: 'publish', limits: { withinHours: 24, maxPerHour: 10 } },
    ],
  },
  {
    key: 'copy-editor',
    label: 'Copy editor',
    access: 'draft',
    description: 'May change words on ordinary pages and take links down, and publish small edits by itself (up to 200 words, no new links). Everything else goes to a person.',
    rules: [
      { id: 'words', label: 'Small wording changes', actions: ['edit_text'], result: 'publish', limits: { maxSections: 10, maxWords: 200, maxPerHour: 20 } },
      { id: 'takedown', label: 'Take links down', actions: ['remove_link'], result: 'publish', limits: { maxSections: 50, maxPerHour: 10 } },
      { id: 'undo', label: 'Undo within a day', actions: ['undo_change'], result: 'publish', limits: { withinHours: 24, maxPerHour: 10 } },
    ],
  },
]

export const presetByKey = (key: string) => RULE_PRESETS.find((p) => p.key === key)

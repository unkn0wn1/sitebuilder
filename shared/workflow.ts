// Page workflow states. Defined once here and in docs/13-data-model.md#page-workflow-states.

export const WORKFLOW_STATES = ['draft', 'in_review', 'approved', 'published', 'unpublished'] as const
export type WorkflowState = (typeof WORKFLOW_STATES)[number]

export const REVIEW_STATES = ['pending', 'sent_back', 'withdrawn', 'approved', 'published', 'failed'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

/** Plain words for the GUI (docs/04-gui.md#glossary). */
export const STATE_LABELS: Record<WorkflowState, string> = {
  draft: 'Draft',
  in_review: 'Waiting for approval',
  approved: 'Publishing',
  published: 'Live',
  unpublished: 'Offline',
}

/** Where a page returns to when a review is sent back or withdrawn. */
export function restingState(opts: { publishedVersionId: string | null; wasUnpublished: boolean }): WorkflowState {
  if (opts.publishedVersionId) return 'published'
  if (opts.wasUnpublished) return 'unpublished'
  return 'draft'
}

export function canSubmit(state: WorkflowState): boolean {
  return state === 'draft' || state === 'published' || state === 'unpublished'
}

/** Status shown next to a page title. Live pages with a newer draft say so. */
export function statusLabel(state: WorkflowState, hasUnpublishedChanges = false): string {
  if (state === 'published' && hasUnpublishedChanges) return 'Live, with changes'
  return STATE_LABELS[state]
}

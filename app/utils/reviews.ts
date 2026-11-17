import type { ReviewState, WorkflowState } from '#shared/workflow'
import type { FieldIssue } from '#shared/issues'
import type { PageDiff } from '#shared/diff'
import type { PageDoc } from '#shared/page'
import type { BrandDoc } from '#shared/brand'
import type { SitePartDoc, SitePartKind } from '#shared/site-parts'

export interface ReviewListItem {
  id: string
  targetType: 'page' | 'site_part' | 'brand'
  targetId: string
  versionId: string
  state: ReviewState
  note: string | null
  changeSummary: string | null
  submittedBy: string
  submittedByName: string
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: string | null
  jobId: string | null
  createdAt: string
  title: string
}

export interface ReviewComment {
  id: string
  blockId: string | null
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

export interface ReviewDetail {
  review: {
    id: string
    targetType: 'page' | 'site_part' | 'brand'
    targetId: string
    versionId: string
    state: ReviewState
    note: string | null
    changeSummary: string | null
    submittedBy: string
    decidedBy: string | null
    decidedAt: string | null
    decisionComment: string | null
    overrideReason: string | null
    jobId: string | null
    createdAt: string
  }
  target:
    | { type: 'page'; id: string; title: string; path: string; template: string; state: WorkflowState }
    | { type: 'site_part'; id: string; title: string; kind: SitePartKind; state: WorkflowState }
    | { type: 'brand'; id: string; title: string; state: WorkflowState }
  doc: PageDoc | SitePartDoc | BrandDoc
  liveDoc?: SitePartDoc | BrandDoc | null
  hasLive: boolean
  diff?: PageDiff
  checks: { blocking: FieldIssue[]; warnings: FieldIssue[] }
  draftChangedSinceSubmit: boolean
  submittedByName: string
  decidedByName: string | null
  comments: ReviewComment[]
}

export const CHANGE_KIND_LABELS: Record<PageDiff['blocks'][number]['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  moved: 'Moved',
}

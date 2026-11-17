import type { WorkflowState } from '#shared/workflow'
import type { FieldIssue } from '#shared/issues'
import type { SitePartDoc, SitePartKind } from '#shared/site-parts'

export interface SitePartListItem {
  id: string
  kind: SitePartKind
  key: string
  label: string
  state: WorkflowState
  isLive: boolean
  hasUnpublishedChanges: boolean
  updatedAt: string
}

export interface SitePartDetail {
  part: {
    id: string
    kind: SitePartKind
    key: string
    label: string
    workflowState: WorkflowState
    publishedVersionId: string | null
    draftVersionId: string | null
    draftRevision: number
  }
  doc: SitePartDoc
  revision: number
  review: { id: string } | null
  checks: { blocking: FieldIssue[]; warnings: FieldIssue[] }
}

export interface PageOption {
  id: string
  title: string
  path: string | null
  state: WorkflowState
}

export const KIND_LABELS: Record<SitePartKind, string> = {
  header: 'Header',
  footer: 'Footer',
  menu: 'Menu',
  banner: 'Banner',
}

export const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  bluesky: 'Bluesky',
  threads: 'Threads',
}

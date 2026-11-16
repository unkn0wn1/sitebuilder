// Draft types for the page and block model. See docs/03-block-model.md. Subject to change.

export interface Block<TProps = Record<string, unknown>> {
  /** Stable id, unique within the page. */
  id: string
  /** Registered block type, for example "Hero" or "VirtuousEmbed". */
  type: string
  props: TProps
}

export type PageStatus = 'draft' | 'in_review' | 'approved' | 'published'

export interface Page {
  id: string
  slug: string
  locale: string
  template: string
  title: string
  blocks: Block[]
}

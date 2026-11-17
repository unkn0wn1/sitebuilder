// Helpers for showing FieldIssue paths next to editor fields and in a summary list.
import type { FieldIssue } from './issues'

const FIELD_WORDS: Record<string, string> = {
  heading: 'Heading',
  subheading: 'Subheading',
  text: 'Text',
  content: 'Text',
  caption: 'Caption',
  attribution: 'Attribution',
  image: 'Photo',
  intro: 'Introduction',
  items: 'Items',
  name: 'Name',
  note: 'Note',
  href: 'Link',
  logo: 'Logo',
  alt: 'Alt text',
  badgeHtml: 'Badge',
  group: 'Group label',
  title: 'Title',
  message: 'Message',
  matchLine: 'Match line',
  raised: 'Raised so far',
  goal: 'Goal',
  quote: 'Pull quote',
  before: 'Before photo',
  after: 'After photo',
  beforeCaption: 'Before caption',
  afterCaption: 'After caption',
  seo: 'Search',
  description: 'Description',
  blocks: 'Sections',
}

export interface DescribedIssue {
  issue: FieldIssue
  blockIndex: number | null
  title: string
  message: string
}

export function issuesAt(issues: FieldIssue[] | undefined, path: string): FieldIssue[] {
  return (issues ?? []).filter((issue) => issue.path === path)
}

export function issuesUnder(issues: FieldIssue[] | undefined, path: string): FieldIssue[] {
  const prefix = path.endsWith('.') ? path : `${path}.`
  return (issues ?? []).filter((issue) => issue.path === path || issue.path.startsWith(prefix))
}

export function blockIndexFromPath(path: string): number | null {
  const match = path.match(/^blocks\.(\d+)(?:\.|$)/)
  return match ? Number(match[1]) : null
}

function labelize(part: string): string {
  if (/^\d+$/.test(part)) return `item ${Number(part) + 1}`
  return FIELD_WORDS[part] ?? part.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

export function pathLabel(path: string, blockLabels: Record<string, string> = {}, blockTypes: string[] = []): string {
  if (!path) return 'Page'
  const parts = path.split('.')
  if (parts[0] === 'title') return 'Page title'
  if (parts[0] === 'seo') return ['Search', ...parts.slice(1).map(labelize)].join(', ')
  if (parts[0] === 'blocks' && parts.length >= 2) {
    const index = Number(parts[1])
    const type = Number.isFinite(index) ? blockTypes[index] : undefined
    const section = (type && blockLabels[type]) || type || `Section ${index + 1}`
    const rest = parts.slice(2)[0] === 'props' ? parts.slice(3) : parts.slice(2)
    const field = rest.filter((part) => part !== 'props').map(labelize).join(', ')
    return field ? `${section}: ${field}` : section
  }
  return parts.map(labelize).join(', ')
}

export function describeIssues(
  issues: FieldIssue[] | undefined,
  opts: { blockTypes?: string[]; blockLabels?: Record<string, string> } = {},
): DescribedIssue[] {
  return (issues ?? []).map((issue) => ({
    issue,
    blockIndex: blockIndexFromPath(issue.path),
    title: pathLabel(issue.path, opts.blockLabels ?? {}, opts.blockTypes ?? []),
    message: issue.message,
  }))
}

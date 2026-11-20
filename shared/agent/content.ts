// Reading and rewriting page and site-part content for the agent gateway: finding text and links,
// replacing words, taking links out, and a small markdown-style format for rich text.
// Pure functions over JSON. Validation against the block and site-part schemas is done by the caller.
// See docs/agent-gateway.md#how-text-and-links-are-found.
import { cloneDraft } from '../clone'
import { isSafeHref, richTextDoc, type RichTextDoc } from '../richtext'
import { internalSitePath } from '../internal-links'

export type PathPart = string | number
export type Path = PathPart[]
type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)

export const pathString = (path: Path) => path.join('.')

/** Prop names that hold words a person reads. Anything else (amounts, ids, enums, images) is not "text". */
export const TEXT_KEYS = new Set([
  'heading', 'subheading', 'srHeading', 'eyebrow', 'intro', 'title', 'quote', 'attribution', 'note', 'name', 'message', 'label',
  'group', 'explanation', 'matchLine', 'beforeCaption', 'afterCaption', 'caption', 'question', 'description', 'body', 'text',
  'lead', 'accent', 'address', 'legalText', 'contactTitle', 'linksTitle', 'tagline',
])

function isRichDoc(v: unknown): v is RichTextDoc {
  return isRec(v) && v.type === 'doc' && Array.isArray(v.content)
}

export function getAt(root: unknown, path: Path): unknown {
  let cur: unknown = root
  for (const p of path) {
    if (Array.isArray(cur) && typeof p === 'number') cur = cur[p]
    else if (isRec(cur) && typeof p === 'string') cur = cur[p]
    else return undefined
  }
  return cur
}

// ---------------------------------------------------------------------------------------------------------------------
// Text

export interface TextLeaf {
  path: Path
  kind: 'prop' | 'rich'
  text: string
}

/** Every piece of reader-facing text, in document order. Rich text is reported one text run at a time. */
export function textLeaves(root: unknown): TextLeaf[] {
  const out: TextLeaf[] = []
  const walk = (value: unknown, path: Path, key: string | null) => {
    if (isRichDoc(value)) {
      const visitInline = (nodes: unknown, base: Path) => {
        if (!Array.isArray(nodes)) return
        nodes.forEach((n, i) => {
          if (isRec(n) && n.type === 'text' && typeof n.text === 'string') out.push({ path: [...base, i, 'text'], kind: 'rich', text: n.text })
        })
      }
      value.content.forEach((node, i) => {
        const base: Path = [...path, 'content', i]
        if (node.type === 'paragraph' || node.type === 'heading') visitInline(node.content, [...base, 'content'])
        else node.content.forEach((item, j) => item.content.forEach((p, k) => visitInline(p.content, [...base, 'content', j, 'content', k, 'content'])))
      })
      return
    }
    if (typeof value === 'string') {
      if (key && TEXT_KEYS.has(key)) out.push({ path, kind: 'prop', text: value })
      return
    }
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], key))
    else if (isRec(value)) for (const [k, v] of Object.entries(value)) walk(v, [...path, k], k)
  }
  walk(root, [], null)
  return out
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

export function wordList(text: string): string[] {
  return (text.match(WORD) ?? []).map((w) => w.toLowerCase())
}

/** Words added or removed between two documents (the larger of the two counts). */
export function wordsChanged(before: unknown, after: unknown): number {
  const count = (root: unknown) => {
    const m = new Map<string, number>()
    for (const leaf of textLeaves(root)) for (const w of wordList(leaf.text)) m.set(w, (m.get(w) ?? 0) + 1)
    return m
  }
  const a = count(before)
  const b = count(after)
  let added = 0
  let removed = 0
  for (const [w, n] of b) added += Math.max(0, n - (a.get(w) ?? 0))
  for (const [w, n] of a) removed += Math.max(0, n - (b.get(w) ?? 0))
  return Math.max(added, removed)
}

export interface ReplaceOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export function textMatcher(find: string, opts: ReplaceOptions = {}): RegExp {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = opts.wholeWord ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped
  return new RegExp(body, `gu${opts.caseSensitive === false ? 'i' : ''}`)
}

export function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

export interface TextReplacement {
  path: Path
  before: string
  after: string
  count: number
}

/**
 * Replace text in every text leaf. Works on a copy. Matches never span two rich-text runs (a run ends where
 * bold, italic or a link starts), so text split by formatting must be changed run by run.
 * A rich-text run left empty is dropped.
 */
export function replaceText<T>(root: T, find: string, replace: string, opts: ReplaceOptions = {}): { value: T; replacements: TextReplacement[] } {
  const value = cloneDraft(root)
  const re = textMatcher(find, opts)
  const replacements: TextReplacement[] = []
  const emptied: Path[] = []
  for (const leaf of textLeaves(value)) {
    const n = countMatches(leaf.text, re)
    if (!n) continue
    const after = leaf.text.replace(re, () => replace)
    setAt(value, leaf.path, after)
    replacements.push({ path: leaf.path, before: leaf.text, after, count: n })
    if (leaf.kind === 'rich' && after === '') emptied.push(leaf.path)
  }
  // Drop emptied runs, last index first so earlier indexes stay valid.
  for (const p of emptied.sort((a, b) => (b[b.length - 2] as number) - (a[a.length - 2] as number))) {
    const arr = getAt(value, p.slice(0, -2))
    if (Array.isArray(arr)) arr.splice(p[p.length - 2] as number, 1)
  }
  return { value, replacements }
}

function setAt(root: unknown, path: Path, v: unknown) {
  const parent = getAt(root, path.slice(0, -1))
  const key = path[path.length - 1]!
  if (Array.isArray(parent) && typeof key === 'number') parent[key] = v
  else if (isRec(parent) && typeof key === 'string') parent[key] = v
}

export interface TextHit {
  path: Path
  text: string
  /** A short window around the match. */
  snippet: string
}

/** Find a phrase in text leaves, plus a plain-text window around each match. Case-insensitive unless asked. */
export function searchText(root: unknown, query: string, opts: ReplaceOptions = { caseSensitive: false }): TextHit[] {
  const re = textMatcher(query, { caseSensitive: false, ...opts })
  const hits: TextHit[] = []
  for (const leaf of textLeaves(root)) {
    re.lastIndex = 0
    const m = re.exec(leaf.text)
    if (!m) continue
    const start = Math.max(0, m.index - 50)
    const end = Math.min(leaf.text.length, m.index + m[0].length + 50)
    hits.push({ path: leaf.path, text: leaf.text, snippet: `${start > 0 ? '…' : ''}${leaf.text.slice(start, end)}${end < leaf.text.length ? '…' : ''}` })
  }
  return hits
}

// ---------------------------------------------------------------------------------------------------------------------
// Links

export type LinkKind = 'text_link' | 'button' | 'link' | 'menu_target' | 'social' | 'page_target'

export type Removal =
  | { type: 'unmark'; nodePath: Path; markIndex: number }
  | { type: 'delete_key'; parentPath: Path; key: string }
  | { type: 'set_null'; parentPath: Path; key: string }
  | { type: 'splice'; arrayPath: Path; index: number }
  | { type: 'unremovable'; reason: string }

export interface LinkHit {
  /** Where the address lives (the href or url string, or the page target object). */
  path: Path
  kind: LinkKind
  /** The address, or `page:<pageId>` for a menu or button that points at a page on this site. */
  href: string
  pageId?: string
  /** The words on the link or button, when there are any. */
  label: string | null
  removal: Removal
}

export type DocKind = 'block' | 'sitepart'

/**
 * Every link in a document. `docKind` decides how a link is taken out: block props delete the optional
 * prop, site parts set the nullable field to null.
 */
export function findLinks(root: unknown, docKind: DocKind): LinkHit[] {
  const out: LinkHit[] = []
  const walk = (value: unknown, path: Path, parentPath: Path | null, parentKey: PathPart | null) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, [...path, i], path, i))
      return
    }
    if (!isRec(value)) return
    // Rich text link marks.
    if (value.type === 'text' && Array.isArray(value.marks)) {
      value.marks.forEach((m, mi) => {
        if (isRec(m) && m.type === 'link' && typeof m.href === 'string') {
          out.push({ path: [...path, 'marks', mi, 'href'], kind: 'text_link', href: m.href, label: typeof value.text === 'string' ? value.text : null, removal: { type: 'unmark', nodePath: path, markIndex: mi } })
        }
      })
    }
    // A link to a page on this site (menu, header, banner).
    if (value.type === 'page' && typeof value.pageId === 'string') {
      out.push({ path, kind: 'page_target', href: `page:${value.pageId}`, pageId: value.pageId, label: labelFor(parentPath, root), removal: containerRemoval(path, docKind, root, 'target') })
    }
    // A link to an address (menu, header, banner).
    if (value.type === 'url' && typeof value.url === 'string') {
      out.push({ path: [...path, 'url'], kind: 'menu_target', href: value.url, label: labelFor(parentPath, root), removal: containerRemoval(path, docKind, root, 'target') })
    }
    // Footer social links.
    if (typeof value.network === 'string' && typeof value.url === 'string') {
      out.push({ path: [...path, 'url'], kind: 'social', href: value.url, label: value.network, removal: parentPath && typeof parentKey === 'number' ? { type: 'splice', arrayPath: parentPath, index: parentKey } : { type: 'unremovable', reason: 'Social link is not in a list.' } })
    }
    // A button or link in a section: { label, href } or an object with an optional href.
    if (typeof value.href === 'string' && value.type !== 'text' && value.type !== 'link') {
      const keys = Object.keys(value).filter((k) => k !== 'icon')
      const plain = keys.length === 2 && keys.includes('label') && keys.includes('href')
      const removal: Removal = !plain
        ? { type: 'delete_key', parentPath: path, key: 'href' }
        : parentPath && typeof parentKey === 'number'
          ? { type: 'splice', arrayPath: parentPath, index: parentKey }
          : parentPath && typeof parentKey === 'string'
            ? { type: docKind === 'sitepart' ? 'set_null' : 'delete_key', parentPath, key: parentKey }
            : { type: 'unremovable', reason: 'This link cannot be removed on its own.' }
      out.push({ path: [...path, 'href'], kind: plain ? 'button' : 'link', href: value.href, label: typeof value.label === 'string' ? value.label : typeof value.name === 'string' ? value.name : null, removal })
    }
    for (const [k, v] of Object.entries(value)) walk(v, [...path, k], path, k)
  }
  walk(root, [], null, null)
  return out
}

function labelFor(containerPath: Path | null, root: unknown): string | null {
  if (!containerPath) return null
  const c = getAt(root, containerPath)
  return isRec(c) && typeof c.label === 'string' ? c.label : null
}

/** How to remove a link whose address sits in `holder` (an object with a `target`) held at `holderPath`. */
function containerRemoval(targetPath: Path, docKind: DocKind, root: unknown, targetKey: string): Removal {
  const holderPath = targetPath.slice(0, -1)
  void targetKey
  const holder = getAt(root, holderPath)
  const holderKey = holderPath[holderPath.length - 1]
  const holderParentPath = holderPath.slice(0, -1)
  if (typeof holderKey === 'number') {
    if (isRec(holder) && Array.isArray(holder.children) && holder.children.length > 0) {
      return { type: 'unremovable', reason: 'This menu item has sub-items. Take the sub-items out first, or use remove_menu_item.' }
    }
    return { type: 'splice', arrayPath: holderParentPath, index: holderKey }
  }
  if (typeof holderKey === 'string') return { type: docKind === 'sitepart' ? 'set_null' : 'delete_key', parentPath: holderParentPath, key: holderKey }
  return { type: 'unremovable', reason: 'This link cannot be removed on its own.' }
}

export type LinkMatch = 'exact' | 'prefix' | 'domain'

/** Lower-case host without "www.", no protocol, no trailing slash, no fragment. Non-URLs are returned trimmed. */
export function normaliseHref(href: string): string {
  const raw = href.trim()
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      const host = u.hostname.toLowerCase().replace(/^www\./, '')
      const path = u.pathname.replace(/\/+$/, '')
      return `${host}${path}${u.search}`
    } catch {
      return raw
    }
  }
  return raw.replace(/\/+$/, '') || raw
}

export function hrefMatches(href: string, query: string, mode: LinkMatch = 'exact', siteOrigin?: string | null): boolean {
  const h = normaliseHref(href)
  const q = normaliseHref(query)
  const sitePath = internalSitePath(query, siteOrigin)
  const hrefPath = internalSitePath(href, siteOrigin)
  if (sitePath && hrefPath && mode === 'exact') return sitePath === hrefPath
  if (mode === 'exact') return h === q
  if (mode === 'prefix') return h.startsWith(q)
  return h.split('/')[0] === q.split('/')[0] && !q.startsWith('/') && !q.startsWith('mailto:') && !q.startsWith('tel:')
}

export function domainOfHref(href: string, siteOrigin?: string | null): string {
  const raw = href.trim()
  if (raw.startsWith('mailto:')) return 'mailto'
  if (raw.startsWith('tel:')) return 'tel'
  if (raw.startsWith('#') || (raw.startsWith('/') && !raw.startsWith('//')) || raw.startsWith('page:')) return '(this site)'
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (siteOrigin && new URL(siteOrigin).hostname.toLowerCase().replace(/^www\./, '') === host) return '(this site)'
    return host
  } catch {
    return raw
  }
}

export function linkCounts(root: unknown, docKind: DocKind): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of findLinks(root, docKind)) m.set(l.href, (m.get(l.href) ?? 0) + 1)
  return m
}

/** Links added and removed between two documents, and where the added ones go. */
export function linkDelta(before: unknown, after: unknown, docKind: DocKind, siteOrigin?: string | null) {
  const a = linkCounts(before, docKind)
  const b = linkCounts(after, docKind)
  let linksAdded = 0
  let linksRemoved = 0
  const domains = new Set<string>()
  for (const [href, n] of b) {
    const extra = Math.max(0, n - (a.get(href) ?? 0))
    if (extra) {
      linksAdded += extra
      domains.add(domainOfHref(href, siteOrigin))
    }
  }
  for (const [href, n] of a) linksRemoved += Math.max(0, n - (b.get(href) ?? 0))
  return { linksAdded, linksRemoved, newLinkDomains: [...domains].sort() }
}

export interface RemovedLink {
  path: Path
  kind: LinkKind
  href: string
  label: string | null
}

export interface UnremovedLink extends RemovedLink {
  reason: string
}

/** Apply removals to a copy. Deepest and last-index-first so earlier paths stay valid. */
export function removeLinks<T>(root: T, hits: LinkHit[]): { value: T; removed: RemovedLink[]; unremovable: UnremovedLink[] } {
  const value = cloneDraft(root)
  const removed: RemovedLink[] = []
  const unremovable: UnremovedLink[] = []
  const order = (a: Path, b: Path): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue
      if (typeof a[i] === 'number' && typeof b[i] === 'number') return (b[i] as number) - (a[i] as number)
      return String(a[i]).localeCompare(String(b[i]))
    }
    return b.length - a.length
  }
  const keyOf = (r: Removal): Path => (r.type === 'unmark' ? [...r.nodePath, 'marks', r.markIndex] : r.type === 'splice' ? [...r.arrayPath, r.index] : r.type === 'unremovable' ? [] : [...r.parentPath, r.key])
  const seen = new Set<string>()
  for (const hit of [...hits].sort((a, b) => order(keyOf(a.removal), keyOf(b.removal)))) {
    const info = { path: hit.path, kind: hit.kind, href: hit.href, label: hit.label }
    const r = hit.removal
    if (r.type === 'unremovable') {
      unremovable.push({ ...info, reason: r.reason })
      continue
    }
    const k = `${r.type}:${pathString(keyOf(r))}`
    if (seen.has(k)) {
      removed.push(info)
      continue
    }
    seen.add(k)
    if (r.type === 'unmark') {
      const node = getAt(value, r.nodePath)
      if (isRec(node) && Array.isArray(node.marks)) {
        node.marks.splice(r.markIndex, 1)
        if (node.marks.length === 0) delete node.marks
      }
    } else if (r.type === 'splice') {
      const arr = getAt(value, r.arrayPath)
      if (Array.isArray(arr)) arr.splice(r.index, 1)
    } else {
      const parent = getAt(value, r.parentPath)
      if (isRec(parent)) {
        if (r.type === 'delete_key') delete parent[r.key]
        else parent[r.key] = null
      }
    }
    removed.push(info)
  }
  return { value, removed, unremovable }
}

/** Point matching links at a new address. Works on a copy. */
export function replaceLinks<T>(root: T, hits: LinkHit[], newHref: string): { value: T; changed: RemovedLink[]; skipped: UnremovedLink[] } {
  const value = cloneDraft(root)
  const changed: RemovedLink[] = []
  const skipped: UnremovedLink[] = []
  for (const hit of hits) {
    const info = { path: hit.path, kind: hit.kind, href: hit.href, label: hit.label }
    if (hit.kind === 'page_target') {
      const parent = getAt(value, hit.path)
      if (isRec(parent)) {
        // A page target becomes an address target.
        for (const k of Object.keys(parent)) delete parent[k]
        parent.type = 'url'
        parent.url = newHref
        changed.push(info)
      }
      continue
    }
    if (!isSafeHref(newHref)) {
      skipped.push({ ...info, reason: 'The new address is not a safe link.' })
      continue
    }
    setAt(value, hit.path, newHref)
    changed.push(info)
  }
  return { value, changed, skipped }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rich text as markdown-style text

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/

type Mark = { type: 'bold' } | { type: 'italic' } | { type: 'link'; href: string }
type Run = { type: 'text'; text: string; marks?: Mark[] }

function parseInline(text: string, marks: Mark[] = []): Run[] {
  const m = INLINE.exec(text)
  if (!m) return text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : []
  const before = text.slice(0, m.index)
  const after = text.slice(m.index + m[0].length)
  const inner: Run[] = m[1] !== undefined ? parseInline(m[1], [...marks, { type: 'bold' }]) : m[2] !== undefined ? parseInline(m[2], [...marks, { type: 'italic' }]) : parseInline(m[3]!, [...marks, { type: 'link', href: m[4]! }])
  return [...parseInline(before, marks), ...inner, ...parseInline(after, marks)]
}

/**
 * Turn simple markdown into rich text: blank-line separated paragraphs, "## " headings (## ### ####),
 * "- " bullet lines, "1. " numbered lines, and **bold**, *italic* and [text](https://link) inside text.
 */
export function markdownToRichText(markdown: string): { ok: true; doc: RichTextDoc } | { ok: false; message: string } {
  const content: unknown[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) content.push({ type: 'paragraph', content: parseInline(para.join(' ').trim()) })
    para = []
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(t) }] }))
      content.push({ type: list.ordered ? 'orderedList' : 'bulletList', content: items })
    }
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{2,4})\s+(.+)$/.exec(line)
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (!line.trim()) {
      flushPara()
      flushList()
    } else if (heading) {
      flushPara()
      flushList()
      content.push({ type: 'heading', level: heading[1]!.length, content: parseInline(heading[2]!.trim()) })
    } else if (bullet || numbered) {
      flushPara()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1]!.trim())
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  if (content.length === 0) return { ok: false, message: 'There is no text to add.' }
  const parsed = richTextDoc.safeParse({ type: 'doc', content })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'That text cannot be turned into a section.' }
  return { ok: true, doc: parsed.data }
}

function inlineMarkdown(nodes: unknown): string {
  if (!Array.isArray(nodes)) return ''
  return nodes
    .map((n) => {
      if (!isRec(n) || typeof n.text !== 'string') return ''
      let t = n.text
      for (const m of (Array.isArray(n.marks) ? n.marks : []) as Mark[]) {
        if (m.type === 'bold') t = `**${t}**`
        else if (m.type === 'italic') t = `*${t}*`
        else if (m.type === 'link') t = `[${t}](${m.href})`
      }
      return t
    })
    .join('')
}

/** The reverse of markdownToRichText, for showing a page to the agent. */
export function richTextToMarkdown(doc: RichTextDoc): string {
  return doc.content
    .map((node) => {
      if (node.type === 'paragraph') return inlineMarkdown(node.content)
      if (node.type === 'heading') return `${'#'.repeat(node.level)} ${inlineMarkdown(node.content)}`
      return node.content.map((item, i) => `${node.type === 'orderedList' ? `${i + 1}.` : '-'} ${item.content.map((p) => inlineMarkdown(p.content)).join(' ')}`).join('\n')
    })
    .join('\n\n')
}

export type InsertPosition = 'start' | 'end' | { afterText: string }

/** Insert rich text blocks into a rich text doc. Returns null if `afterText` is not found. */
export function insertRichText(doc: RichTextDoc, add: RichTextDoc, position: InsertPosition): RichTextDoc | null {
  const content = cloneDraft(doc.content)
  const incoming = cloneDraft(add.content)
  if (position === 'start') return { type: 'doc', content: [...incoming, ...content] }
  if (position === 'end') return { type: 'doc', content: [...content, ...incoming] }
  const needle = position.afterText.toLowerCase()
  const plain = (node: RichTextDoc['content'][number]): string => richTextToMarkdown({ type: 'doc', content: [node] }).replace(/[*\[\]()#]/g, '').toLowerCase()
  const index = content.findIndex((n) => plain(n).includes(needle))
  if (index < 0) return null
  content.splice(index + 1, 0, ...incoming)
  return { type: 'doc', content }
}

/** Plain-text preview of a block for search results and page summaries. */
export function previewProps(props: Rec, max = 160): string {
  const parts = textLeaves(props).map((l) => l.text)
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function isRichTextValue(v: unknown): v is RichTextDoc {
  return isRichDoc(v)
}

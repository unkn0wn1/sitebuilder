// Structured rich text. Stored as JSON, rendered by our code, never stored as HTML.
// See docs/decisions/0010-zod-versioned-blocks-structured-rich-text.md.
import { z } from 'zod'

const SAFE_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:']

/** True for https, http, mailto and tel links, and for site paths such as "/about" or "#donate". */
export function isSafeHref(href: string): boolean {
  const value = href.trim()
  if (value.length === 0 || value.length > 2048) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (value.startsWith('#')) return true
  try {
    const url = new URL(value)
    return SAFE_SCHEMES.includes(url.protocol)
  } catch {
    return false
  }
}

export const safeHref = z.string().refine(isSafeHref, { message: 'Links must start with https://, http://, mailto:, tel:, / or #.' })

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z.object({ type: z.literal('link'), href: safeHref }).strict(),
])

export const textNode = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(10000),
    marks: z.array(markSchema).max(3).optional(),
  })
  .strict()

const inline = z.array(textNode).max(500)

export const paragraphNode = z.object({ type: z.literal('paragraph'), content: inline.optional() }).strict()
export const headingNode = z
  .object({ type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3), z.literal(4)]), content: inline.optional() })
  .strict()
export const listItemNode = z.object({ type: z.literal('listItem'), content: z.array(paragraphNode).min(1).max(20) }).strict()
export const bulletListNode = z.object({ type: z.literal('bulletList'), content: z.array(listItemNode).min(1).max(100) }).strict()
export const orderedListNode = z.object({ type: z.literal('orderedList'), content: z.array(listItemNode).min(1).max(100) }).strict()

export const richTextBlockNode = z.discriminatedUnion('type', [paragraphNode, headingNode, bulletListNode, orderedListNode])

export const richTextDoc = z
  .object({
    type: z.literal('doc'),
    content: z.array(richTextBlockNode).max(500),
  })
  .strict()

export type RichTextDoc = z.infer<typeof richTextDoc>
export type RichTextNode = z.infer<typeof richTextBlockNode>
export type TextNode = z.infer<typeof textNode>

export function emptyRichText(): RichTextDoc {
  return { type: 'doc', content: [] }
}

/** A simple doc from plain paragraphs, for seeds and tests. */
export function richTextFromParagraphs(paragraphs: string[]): RichTextDoc {
  return { type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined })) }
}

function inlineText(nodes: TextNode[] | undefined): string {
  return (nodes ?? []).map((n) => n.text).join('')
}

/** Plain text, for checks, search and AI context. */
export function richTextToPlain(doc: RichTextDoc | null | undefined): string {
  const parts: string[] = []
  // Tolerate a half-made value (an empty list item, a string from older data) instead of breaking the editor.
  if (typeof doc === 'string') return doc
  for (const node of doc?.content ?? []) {
    if (node.type === 'paragraph' || node.type === 'heading') parts.push(inlineText(node.content))
    else for (const item of node.content ?? []) for (const p of item.content ?? []) parts.push(inlineText(p.content))
  }
  return parts.join('\n')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(nodes: TextNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      let html = escapeHtml(node.text)
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') html = `<strong>${html}</strong>`
        else if (mark.type === 'italic') html = `<em>${html}</em>`
        else if (mark.type === 'link' && isSafeHref(mark.href)) html = `<a href="${escapeHtml(mark.href)}">${html}</a>`
      }
      return html
    })
    .join('')
}

/** Render to HTML. Every string is escaped; links are re-checked. Input must already be validated. */
export function renderRichText(doc: RichTextDoc): string {
  return doc.content
    .map((node) => {
      switch (node.type) {
        case 'paragraph':
          return `<p>${renderInline(node.content)}</p>`
        case 'heading':
          return `<h${node.level}>${renderInline(node.content)}</h${node.level}>`
        case 'bulletList':
        case 'orderedList': {
          const tag = node.type === 'bulletList' ? 'ul' : 'ol'
          const items = node.content.map((item) => `<li>${item.content.map((p) => `<p>${renderInline(p.content)}</p>`).join('')}</li>`).join('')
          return `<${tag}>${items}</${tag}>`
        }
      }
    })
    .join('')
}

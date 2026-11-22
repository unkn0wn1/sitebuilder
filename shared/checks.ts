// Checks before review. See docs/17-testing-and-budgets.md#checks-before-review.
// v1 covers the checks that can be done on the JSON alone. Speed, contrast and link checks need the
// rendered page and run as jobs later.
import type { FieldIssue } from './issues'
import type { PageDoc } from './page'
import type { BlockRegistry } from './blocks/registry'
import { checkTemplateRules, type TemplateRules } from './templates'

export interface CheckResult {
  blocking: FieldIssue[]
  warnings: FieldIssue[]
}

const PLACEHOLDERS = [/lorem ipsum/i, /\[(headline|heading|title|text|name|image|link|placeholder)\]/i, /\bTODO\b/, /\bTBC\b/, /\bxxx+\b/i]

export function looksLikePlaceholder(text: string): boolean {
  return PLACEHOLDERS.some((re) => re.test(text))
}
const VAGUE_LINK_TEXT = /^(click here|here|read more|more|link)$/i

function walk(value: unknown, path: string, visit: (value: unknown, path: string) => void) {
  visit(value, path)
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}.${i}`, visit))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, visit)
}

function isImageRef(value: unknown): value is { media: string; alt?: string; decorative?: boolean } {
  return !!value && typeof value === 'object' && typeof (value as { media?: unknown }).media === 'string' && (value as { media: string }).media.startsWith('med_')
}

interface RtNode {
  type: string
  level?: number
  text?: string
  marks?: { type: string }[]
  content?: RtNode[]
}

function isRichText(value: unknown): value is { type: 'doc'; content: RtNode[] } {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'doc' && Array.isArray((value as { content?: unknown }).content)
}

function textOf(node: RtNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

export function runChecks(doc: PageDoc, registry: BlockRegistry, rules: TemplateRules | null): CheckResult {
  const blocking: FieldIssue[] = []
  const warnings: FieldIssue[] = []

  if (rules) blocking.push(...checkTemplateRules(doc.blocks.map((b) => b.type), rules, { enforceRequired: true }).filter((i) => i.path === 'blocks'))

  doc.blocks.forEach((block, i) => {
    const base = `blocks.${i}.props`
    const def = registry.get(block.type)

    for (const prop of def?.headingProps ?? []) {
      const value = block.props[prop]
      if (typeof value === 'string' && value.trim() === '' ) blocking.push({ path: `${base}.${prop}`, message: 'This heading is empty. Add text or remove it.' })
    }

    walk(block.props, base, (value, path) => {
      if (isImageRef(value) && !value.decorative && !(value.alt && value.alt.trim())) {
        blocking.push({ path, message: "This photo needs a short description (alt text), or mark it as decorative." })
      }
      if (typeof value === 'string' && looksLikePlaceholder(value)) {
        blocking.push({ path, message: 'This looks like placeholder text. Replace it before submitting.' })
      }
      if (isRichText(value)) {
        let lastLevel = 1
        value.content.forEach((node, n) => {
          if (node.type === 'heading') {
            const level = node.level ?? 2
            if (textOf(node).trim() === '') blocking.push({ path: `${path}.content.${n}`, message: 'This heading is empty.' })
            if (level > lastLevel + 1) blocking.push({ path: `${path}.content.${n}`, message: `Heading levels skip from ${lastLevel} to ${level}. Use level ${lastLevel + 1}.` })
            lastLevel = level
          }
        })
      }
      if (value && typeof value === 'object' && (value as RtNode).type === 'text') {
        const node = value as RtNode
        if (node.marks?.some((m) => m.type === 'link') && VAGUE_LINK_TEXT.test((node.text ?? '').trim())) {
          warnings.push({ path, message: `Link text "${node.text}" doesn't say where it goes. Describe the destination.` })
        }
      }
      if (value && typeof value === 'object' && 'label' in value && 'href' in value) {
        const label = String((value as { label: unknown }).label ?? '')
        if (VAGUE_LINK_TEXT.test(label.trim())) warnings.push({ path, message: `Button text "${label}" doesn't say what it does.` })
      }
    })

    const css = block.css ?? ''
    if (css.trim()) {
      if (/position\s*:\s*fixed/i.test(css)) warnings.push({ path: `blocks.${i}.css`, message: 'This CSS uses position: fixed, so it can cover other parts of the page.' })
      if (/display\s*:\s*none/i.test(css) || /visibility\s*:\s*hidden/i.test(css) || /opacity\s*:\s*0(?![0-9.])/i.test(css)) {
        warnings.push({ path: `blocks.${i}.css`, message: 'This CSS hides something (display: none, visibility: hidden or opacity: 0).' })
      }
    }
  })

  if (looksLikePlaceholder(doc.title)) blocking.push({ path: 'title', message: 'The page title looks like placeholder text.' })
  if (!doc.seo.description) warnings.push({ path: 'seo.description', message: 'Add a short description for search engines and social media.' })
  const seoTitle = doc.seo.title ?? doc.title
  if (seoTitle.length > 60) warnings.push({ path: 'seo.title', message: 'Search engines may cut off titles over 60 characters.' })

  return { blocking, warnings }
}

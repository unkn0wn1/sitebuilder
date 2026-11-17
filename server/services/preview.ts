// Schematic preview images for the preview_screenshot AI tool.
// This is not the publish renderer (ADR 0004, milestone 2). It draws a labelled
// wireframe of the draft so the tool has a real image to return before Chromium
// and the compiled render bundle exist. See docs/12-ai-harness.md#tools.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import type { PageDoc } from '../../shared/page'
import { templates } from '../db/schema'
import type { ServiceCtx } from './context'
import { AppError } from './errors'
import { getPage } from './pages'
import { getTemplateRules } from './templates'

export const PREVIEW_DEVICES = { mobile: 390, tablet: 768, desktop: 1280 } as const
export type PreviewDevice = keyof typeof PREVIEW_DEVICES

const DEFAULT_WIDTHS = [PREVIEW_DEVICES.desktop, PREVIEW_DEVICES.mobile] as const
const MIN_WIDTH = 320
const MAX_WIDTH = 1920
const MAX_SHOTS = 3

export interface PreviewImage {
  width: number
  height: number
  mime: 'image/webp'
  bytes: number
  path?: string
}

export interface PreviewResult {
  kind: 'schematic'
  note: string
  images: PreviewImage[]
}

export function parsePreviewWidths(args: Record<string, unknown>): number[] {
  const widths: number[] = []
  if (typeof args.device === 'string' && args.device in PREVIEW_DEVICES) {
    widths.push(PREVIEW_DEVICES[args.device as PreviewDevice])
  }
  if (typeof args.width === 'number') widths.push(args.width)
  if (Array.isArray(args.widths)) {
    for (const w of args.widths) {
      if (typeof w === 'number') widths.push(w)
    }
  }
  const unique = [...new Set(widths.length ? widths : [...DEFAULT_WIDTHS])]
  if (unique.length > MAX_SHOTS) {
    throw new AppError('validation_failed', `Ask for at most ${MAX_SHOTS} widths at a time.`, [{ path: 'widths', message: 'Too many.' }])
  }
  for (const w of unique) {
    if (!Number.isInteger(w) || w < MIN_WIDTH || w > MAX_WIDTH) {
      throw new AppError('validation_failed', `Use a whole-pixel width between ${MIN_WIDTH} and ${MAX_WIDTH}.`, [{ path: 'width', message: 'Out of range.' }])
    }
  }
  return unique
}

export interface PreviewSession {
  id: string
  taskType: string
  targetType: 'page' | 'template' | 'brand'
  targetId: string
}

export async function renderSessionPreview(
  ctx: ServiceCtx,
  session: PreviewSession,
  args: Record<string, unknown>,
  opts: { filesDir?: string } = {},
): Promise<PreviewResult> {
  const widths = parsePreviewWidths(args)
  const { title, lines } = previewCopy(ctx, session)
  const outDir = opts.filesDir
  if (outDir) mkdirSync(outDir, { recursive: true })
  const images: PreviewImage[] = []
  for (const width of widths) {
    const buf = await sharp(wireframeSvg(width, title, lines, session.taskType)).webp({ quality: 80, effort: 3 }).toBuffer()
    const meta = await sharp(buf).metadata()
    const image: PreviewImage = { width, height: meta.height ?? Math.round(width * 0.75), mime: 'image/webp', bytes: buf.length }
    if (outDir) {
      const name = `${session.id.slice(0, 12)}-${width}.webp`
      writeFileSync(join(outDir, name), buf)
      image.path = name
    }
    images.push(image)
  }
  return {
    kind: 'schematic',
    note: 'Schematic wireframe, not the published page. The real renderer is not built yet.',
    images,
  }
}

function previewCopy(ctx: ServiceCtx, session: PreviewSession): { title: string; lines: string[] } {
  if (session.targetType === 'page') {
    const { page, doc } = getPage(ctx, session.targetId)
    return { title: page.title, lines: [`${page.template} page`, ...blockLines(doc)] }
  }
  if (session.targetType === 'template') {
    const row = ctx.db.select().from(templates).where(and(eq(templates.id, session.targetId), eq(templates.siteId, ctx.siteId))).get()
    const rules = row ? getTemplateRules(ctx, row.key) : null
    return {
      title: row?.label ?? 'Page type',
      lines: [
        `Key: ${row?.key ?? session.targetId}`,
        rules ? `Allowed: ${rules.allowedBlocks.join(', ') || 'none'}` : 'No rules loaded.',
        rules?.requiredBlocks.length ? `Required: ${rules.requiredBlocks.join(', ')}` : 'No required sections.',
      ],
    }
  }
  return { title: 'Brand and design', lines: [`Target: ${session.targetId}`, 'Token and theme preview will use the real renderer later.'] }
}

function blockLines(doc: PageDoc): string[] {
  if (!doc.blocks.length) return ['(no sections yet)']
  return doc.blocks.map((b, i) => {
    const heading = firstString(b.props, ['heading', 'text', 'title', 'caption'])
    return `${i + 1}. ${b.type}${heading ? `: ${heading}` : ''}`
  })
}

function firstString(props: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = props[k]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80)
  }
  return undefined
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wireframeSvg(width: number, title: string, lines: string[], taskType: string): Buffer {
  const pad = Math.round(width * 0.06)
  const inner = width - pad * 2
  const titleSize = width < 500 ? 22 : 32
  const bodySize = width < 500 ? 14 : 16
  const row = bodySize + 22
  const header = pad + titleSize + 28
  const height = Math.max(Math.round(width * 0.6), header + lines.length * row + pad + 36)
  const blocks = lines
    .map((line, i) => {
      const y = header + i * row
      return `<rect x="${pad}" y="${y - bodySize}" width="${inner}" height="${row - 8}" rx="6" fill="#f4f0ea" stroke="#c4b8a5"/>
  <text x="${pad + 12}" y="${y + 4}" font-size="${bodySize}" font-family="system-ui, sans-serif" fill="#1f1b16">${escapeXml(line)}</text>`
    })
    .join('\n  ')
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fffaf3"/>
  <text x="${pad}" y="${pad + titleSize}" font-size="${titleSize}" font-weight="600" font-family="system-ui, sans-serif" fill="#1f1b16">${escapeXml(title.slice(0, 80))}</text>
  <text x="${pad}" y="${pad + titleSize + 18}" font-size="11" font-family="system-ui, sans-serif" fill="#7a6f64">${escapeXml(taskType)} · schematic preview</text>
  ${blocks}
</svg>`
  return Buffer.from(svg)
}

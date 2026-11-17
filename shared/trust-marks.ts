// Recognise real trust marks already in the media library or on published pages,
// so a new draft can reuse them instead of inventing badges or leaving placeholders.
import { looksLikePlaceholder } from './checks'

export interface TrustMedia {
  id: string
  filename?: string | null
  alt?: string | null
  kind?: string | null
}

export interface TrustMarkItem {
  name: string
  logo?: { media: string; alt?: string; decorative?: boolean }
  note?: string
  href?: string
  badgeHtml?: string
  group?: string
}

export interface TrustStripSource {
  heading?: string
  intro?: string
  items?: TrustMarkItem[]
}

export interface TrustStripProps {
  heading: string
  intro: string
  items: TrustMarkItem[]
}

export type KnownTrustKind = 'candid' | 'charity_navigator' | 'kayak' | 'tripadvisor'

const KINDS: { kind: KnownTrustKind; pattern: RegExp; name: string; group: string; alt: string }[] = [
  { kind: 'candid', pattern: /\bcandid\b|\bguidestar\b/i, name: 'Candid', group: 'Rated by', alt: 'Candid seal' },
  { kind: 'charity_navigator', pattern: /charity[\s-]?navigator/i, name: 'Charity Navigator', group: 'Rated by', alt: 'Charity Navigator badge' },
  { kind: 'kayak', pattern: /\bkayak\b/i, name: 'Kayak', group: 'Recommended on', alt: 'Featured on Kayak' },
  { kind: 'tripadvisor', pattern: /trip[\s-]?advisor/i, name: 'Tripadvisor', group: 'Recommended on', alt: 'Recommended on Tripadvisor' },
]

const GROUP_ORDER = ['Rated by', 'Recommended on']

export function classifyTrustText(...parts: Array<string | null | undefined>): KnownTrustKind | null {
  const blob = parts.filter(Boolean).join(' ')
  if (!blob.trim()) return null
  for (const row of KINDS) if (row.pattern.test(blob)) return row.kind
  return null
}

export function classifyTrustMedia(media: TrustMedia): KnownTrustKind | null {
  return classifyTrustText(media.filename, media.alt)
}

export function isTrustMedia(media: TrustMedia): boolean {
  return classifyTrustMedia(media) !== null
}

function kindMeta(kind: KnownTrustKind) {
  return KINDS.find((row) => row.kind === kind)!
}

function cleanText(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text || looksLikePlaceholder(text)) return undefined
  return text
}

function isUsableItem(item: TrustMarkItem): boolean {
  const hasMark = Boolean(item.logo?.media || (item.badgeHtml && item.badgeHtml.trim()))
  if (!hasMark) return false
  if (!cleanText(item.name)) return false
  for (const value of [item.name, item.note, item.href, item.group, item.logo?.alt]) {
    if (typeof value === 'string' && looksLikePlaceholder(value)) return false
  }
  return true
}

function classifyItem(item: TrustMarkItem, mediaById: Map<string, TrustMedia>): KnownTrustKind | null {
  const media = item.logo?.media ? mediaById.get(item.logo.media) : undefined
  return classifyTrustText(item.name, item.note, item.href, media?.filename, media?.alt, item.logo?.alt)
}

function preferredMedia(kind: KnownTrustKind, media: TrustMedia[]): TrustMedia | undefined {
  const matches = media.filter((row) => classifyTrustMedia(row) === kind)
  return matches.find((row) => row.kind === 'svg') ?? matches[0]
}

function itemKey(item: TrustMarkItem, mediaById: Map<string, TrustMedia>): string {
  const kind = classifyItem(item, mediaById)
  if (kind) return `kind:${kind}`
  if (item.logo?.media) return `media:${item.logo.media}`
  const name = cleanText(item.name)?.toLowerCase()
  if (name) return `name:${name}`
  return `anon:${item.badgeHtml ?? ''}`
}

function logoFor(media: TrustMedia, kind: KnownTrustKind): { media: string; alt: string } {
  return { media: media.id, alt: cleanText(media.alt ?? undefined) ?? kindMeta(kind).alt }
}

/** Build a TrustStrip from existing published marks and matching library media, or null if none are real. */
export function collectTrustStrip(input: { media?: TrustMedia[]; existing?: TrustStripSource[] }): TrustStripProps | null {
  const media = input.media ?? []
  const mediaById = new Map(media.map((row) => [row.id, row]))
  const chosen = new Map<string, TrustMarkItem>()

  for (const strip of input.existing ?? []) {
    for (const raw of strip.items ?? []) {
      if (!isUsableItem(raw)) continue
      const kind = classifyItem(raw, mediaById)
      const upgrade = kind ? preferredMedia(kind, media) : raw.logo?.media ? mediaById.get(raw.logo.media) : undefined
      const item: TrustMarkItem = {
        name: cleanText(raw.name) ?? (kind ? kindMeta(kind).name : raw.name),
        group: cleanText(raw.group) ?? (kind ? kindMeta(kind).group : undefined),
        ...(cleanText(raw.note) ? { note: cleanText(raw.note) } : {}),
        ...(cleanText(raw.href) ? { href: cleanText(raw.href) } : {}),
        ...(raw.badgeHtml?.trim() ? { badgeHtml: raw.badgeHtml } : {}),
      }
      if (upgrade) item.logo = logoFor(upgrade, kind ?? classifyTrustMedia(upgrade) ?? 'candid')
      else if (raw.logo?.media) item.logo = { media: raw.logo.media, alt: cleanText(raw.logo.alt) ?? raw.name }
      if (!item.logo && !item.badgeHtml) continue
      const key = itemKey(item, mediaById)
      if (!chosen.has(key)) chosen.set(key, item)
    }
  }

  for (const kind of KINDS.map((row) => row.kind)) {
    if ([...chosen.values()].some((item) => classifyItem(item, mediaById) === kind)) continue
    const match = preferredMedia(kind, media)
    if (!match) continue
    const meta = kindMeta(kind)
    chosen.set(`kind:${kind}`, { name: meta.name, logo: logoFor(match, kind), group: meta.group })
  }

  const items = [...chosen.values()].sort((a, b) => {
    const ag = GROUP_ORDER.indexOf(a.group ?? '')
    const bg = GROUP_ORDER.indexOf(b.group ?? '')
    const g = (ag === -1 ? GROUP_ORDER.length : ag) - (bg === -1 ? GROUP_ORDER.length : bg)
    return g || a.name.localeCompare(b.name)
  })
  if (!items.length) return null

  const heading =
    (input.existing ?? []).map((s) => cleanText(s.heading)).find(Boolean) ?? 'Give with confidence'
  const intro =
    (input.existing ?? []).map((s) => cleanText(s.intro)).find(Boolean) ??
    'Independent marks, grouped so regulator ratings stay separate from travel recommendations.'

  return { heading, intro, items: items.slice(0, 8) }
}

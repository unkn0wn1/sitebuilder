// Site part documents: header, footer, menus and banner. Edited by hand by approvers and admins
// (no assistant, ADR 0012), approved like pages, and shown on every page.
import { z } from 'zod'
import { zodIssues, type FieldIssue } from './issues'
import { blockIdSchema } from './page'
import { imageRef } from './blocks/define'
import { richTextDoc, safeHref } from './richtext'

export const SITE_PART_KINDS = ['header', 'footer', 'menu', 'banner'] as const

/** How the header presents the menu. The menu tree itself does not change. */
export const HEADER_STYLES = ['simple', 'centred', 'mega', 'hamburger'] as const
export type HeaderStyle = (typeof HEADER_STYLES)[number]
export const HEADER_STYLE_LABELS: Record<HeaderStyle, string> = {
  simple: 'Classic bar',
  centred: 'Centred logo',
  mega: 'Mega menu',
  hamburger: 'Hamburger',
}
export const HEADER_STYLE_HELP: Record<HeaderStyle, string> = {
  simple: 'Logo and links in a row, with dropdowns for sub-items.',
  centred: 'Logo above the menu, centred.',
  mega: 'Wide dropdown panels for sub-items, still from the same menu tree.',
  hamburger: 'A Menu button on every screen, including computers.',
}
export type SitePartKind = (typeof SITE_PART_KINDS)[number]
export const CURRENT_SITE_PART_SCHEMA_VERSION = 1

const label = (max: number) => z.string().trim().min(1, { message: 'Add a label.' }).max(max, { message: `Keep it under ${max} characters.` })

/** A link to a page on this site (by id, so it follows moves) or to an address. */
export const linkTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), pageId: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('url'), url: safeHref }).strict(),
])
export type LinkTarget = z.infer<typeof linkTargetSchema>

// A child can be a featured photo tile in a mega panel. Additive fields, so stored menus stay valid.
const menuChild = z
  .object({ id: blockIdSchema, label: label(40), target: linkTargetSchema, image: imageRef.optional(), featured: z.boolean().optional() })
  .strict()
const menuItem = z
  .object({ id: blockIdSchema, label: label(40), target: linkTargetSchema, children: z.array(menuChild).max(12).default([]) })
  .strict()
  .refine((item) => item.children.filter((c) => c.featured).length <= 5, { message: 'Feature at most 5 tiles per menu item.', path: ['children'] })

const uniqueIds = (items: { id: string; children?: { id: string }[] }[]) => {
  const ids = items.flatMap((i) => [i.id, ...(i.children ?? []).map((c) => c.id)])
  return new Set(ids).size === ids.length
}

export const menuDocSchema = z
  .object({ schemaVersion: z.literal(1), items: z.array(menuItem).max(12, { message: 'Keep the menu to 12 items or fewer. Put the rest in sub-menus.' }) })
  .strict()
  .refine((d) => uniqueIds(d.items), { message: 'Menu item ids must be unique.' })

/** `icon: 'heart'` draws a small heart before the label (used on Donate buttons). */
const callToAction = z.object({ label: label(30), target: linkTargetSchema, icon: z.enum(['heart']).optional() }).strict()

export const headerDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    style: z.enum(['simple', 'centred', 'mega', 'hamburger']).default('simple'),
    menuKey: z.string().min(1).max(40).default('main'),
    cta: callToAction.nullable().default(null),
    /** A small link, for example "Report an ill or injured animal". A hamburger header draws it twice and CSS shows one. */
    utility: callToAction.nullable().default(null),
    appearance: z.enum(['light', 'dark']).default('light'),
    /** Transparent over a hero at the top of the page, solid once scrolled. That page ships the see-through bar in HTML, so it holds without JavaScript. Any other page stays the solid bar. */
    overHero: z.boolean().default(false),
  })
  .strict()

export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'bluesky', 'threads'] as const

export const footerDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    text: richTextDoc.nullable().default(null),
    contact: z
      .object({
        email: z.email({ message: 'Use a valid email address.' }).nullable().default(null),
        phone: z.string().trim().max(30).regex(/^[0-9 +()-]*$/, { message: 'Digits, spaces and + ( ) - only.' }).nullable().default(null),
        address: z.string().trim().max(200).nullable().default(null),
      })
      .strict()
      .default({ email: null, phone: null, address: null }),
    social: z.array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: z.url({ protocol: /^https$/, message: 'Use a full https:// address.' }) }).strict()).max(8).default([]),
    legalMenuKey: z.string().min(1).max(40).nullable().default(null),
    charityNumber: z.string().trim().max(40).nullable().default(null),
    appearance: z.enum(['light', 'dark']).default('light'),
    /** 'columns' shows the logo, a tagline and about text, a contact column and a links column with social icons. Additive; 'simple' keeps the old stacked footer. */
    layout: z.enum(['simple', 'columns']).default('simple'),
    tagline: z.object({ lead: z.string().trim().min(1).max(60), accent: z.string().trim().max(60).default('') }).strict().nullable().default(null),
    contactTitle: z.string().trim().max(40).nullable().default(null),
    /** A menu (by key) shown as arrow links in the third column. */
    linksTitle: z.string().trim().max(40).nullable().default(null),
    linksMenuKey: z.string().min(1).max(40).nullable().default(null),
    legalText: z.string().trim().max(200).nullable().default(null),
  })
  .strict()

export const bannerDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean().default(false),
    message: z.string().trim().max(160, { message: 'Keep the banner under 160 characters.' }).default(''),
    link: callToAction.nullable().default(null),
    tone: z.enum(['info', 'urgent', 'celebrate', 'accent']).default('info'),
  })
  .strict()
  .refine((d) => !d.enabled || d.message.length > 0, { message: 'Add a message, or switch the banner off.', path: ['message'] })

export const SITE_PART_SCHEMAS = {
  header: headerDocSchema,
  footer: footerDocSchema,
  menu: menuDocSchema,
  banner: bannerDocSchema,
} as const

export type SitePartDoc = z.infer<(typeof SITE_PART_SCHEMAS)[SitePartKind]>
export type HeaderDoc = z.infer<typeof headerDocSchema>
export type FooterDoc = z.infer<typeof footerDocSchema>
export type MenuDoc = z.infer<typeof menuDocSchema>
export type BannerDoc = z.infer<typeof bannerDocSchema>

export function defaultSitePartDoc(kind: SitePartKind): SitePartDoc {
  if (kind === 'menu') return { schemaVersion: 1, items: [] }
  return SITE_PART_SCHEMAS[kind].parse({ schemaVersion: 1 })
}

/** Migrate stored documents forward. No migrations yet; this is the hook (ADR 0010). */
export function migrateSitePartDoc(kind: SitePartKind, raw: unknown): unknown {
  return raw ?? defaultSitePartDoc(kind)
}

export function validateSitePartDoc<K extends SitePartKind>(
  kind: K,
  raw: unknown,
): { ok: true; doc: z.infer<(typeof SITE_PART_SCHEMAS)[K]> } | { ok: false; issues: FieldIssue[] } {
  const parsed = SITE_PART_SCHEMAS[kind].safeParse(migrateSitePartDoc(kind, raw))
  // The schema map is indexed by a generic kind, so the parsed value stays a union until it is tied back to K.
  return parsed.success ? { ok: true, doc: parsed.data as z.infer<(typeof SITE_PART_SCHEMAS)[K]> } : { ok: false, issues: zodIssues(parsed.error) }
}

/** Every link target in a site part, with a path for error messages. */
export function sitePartLinks(kind: SitePartKind, doc: SitePartDoc): { path: string; label: string; target: LinkTarget }[] {
  const out: { path: string; label: string; target: LinkTarget }[] = []
  if (kind === 'menu') {
    ;(doc as z.infer<typeof menuDocSchema>).items.forEach((item, i) => {
      out.push({ path: `items.${i}.target`, label: item.label, target: item.target })
      item.children.forEach((c, j) => out.push({ path: `items.${i}.children.${j}.target`, label: c.label, target: c.target }))
    })
  } else if (kind === 'header' || kind === 'banner') {
    const cta = kind === 'header' ? (doc as z.infer<typeof headerDocSchema>).cta : (doc as z.infer<typeof bannerDocSchema>).link
    if (cta) out.push({ path: kind === 'header' ? 'cta.target' : 'link.target', label: cta.label, target: cta.target })
    const utility = kind === 'header' ? (doc as z.infer<typeof headerDocSchema>).utility : null
    if (utility) out.push({ path: 'utility.target', label: utility.label, target: utility.target })
  }
  return out
}

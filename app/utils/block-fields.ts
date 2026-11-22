// Turn a section's Zod props schema into fields the inspector can render.
import type { z } from 'zod'
import { ref } from 'vue'
import { STARTER_BLOCKS } from '#shared/blocks/library'
import type { BlockDefinition } from '#shared/blocks/define'
import { createDefaultRegistry } from '#shared/blocks/registry'
import { ratioFromSize } from '#shared/crop'

export const blockRegistry = createDefaultRegistry()

export type FieldKind = 'text' | 'textarea' | 'enum' | 'boolean' | 'number' | 'image' | 'link' | 'media' | 'embed' | 'richtext' | 'list' | 'object' | 'unknown'

export interface FieldSpec {
  name: string
  path: string
  label: string
  kind: FieldKind
  optional: boolean
  max?: number
  options?: string[]
  item?: FieldSpec[]
  fields?: FieldSpec[]
}

/** One enabled plugin block, as GET /api/v1/plugins/catalog returns it. The client does not compile templates. */
export interface PluginCatalogBlock {
  type: string
  label: string
  category: BlockDefinition['category']
  trust: 'Official' | 'Self-installed'
  sample: Record<string, unknown>
  imageSlots: Record<string, { width: number; height: number }>
  fields: FieldSpec[]
}

export interface CatalogItem {
  type: string
  label: string
  category: BlockDefinition['category']
  headingProps?: string[]
  sample: Record<string, unknown>
  plugin?: boolean
  trust?: 'Official' | 'Self-installed'
}

const pluginCatalogState = ref<PluginCatalogBlock[]>([])

export function setPluginCatalog(blocks: PluginCatalogBlock[]) {
  pluginCatalogState.value = blocks
}

function pluginByType(type: string): PluginCatalogBlock | undefined {
  return pluginCatalogState.value.find((block) => block.type === type)
}

export function pluginSample(type: string): Record<string, unknown> | undefined {
  return pluginByType(type)?.sample
}

export function pluginTrust(type: string): PluginCatalogBlock['trust'] | undefined {
  return pluginByType(type)?.trust
}

/** A stored slash type whose plugin is off or was removed. Core types are never missing plugins. */
export function isMissingPlugin(type: string): boolean {
  if (!type.includes('/')) return false
  if (blockRegistry.get(type)) return false
  return !pluginByType(type)
}

function labelize(name: string): string {
  const words: Record<string, string> = {
    heading: 'Heading',
    subheading: 'Subheading',
    text: 'Text',
    content: 'Text',
    caption: 'Caption',
    attribution: 'Attribution',
    image: 'Photo',
    poster: 'Poster',
    video: 'Video',
    mode: 'Layout',
    slides: 'Slides',
    cta: 'Button',
    button: 'Button',
    tone: 'Look',
    layout: 'Layout',
    items: 'Items',
    cards: 'Cards',
    images: 'Photos',
    embed: 'Form or embed',
    title: 'Title',
    anchor: 'Address on the page',
    href: 'Link',
    label: 'Label',
    alt: 'Alt text',
    decorative: 'Decorative (no alt text)',
    media: 'Media',
    value: 'Number',
    question: 'Question',
    answer: 'Answer',
    intro: 'Introduction',
    amount: 'Amount',
    explanation: 'What this does',
    otherAmount: 'Other amount label',
    raised: 'Raised so far',
    goal: 'Goal',
    currency: 'Currency',
    endDate: 'Ends on',
    matchLine: 'Match line',
    hideWhenPassed: 'Hide after the end date',
    message: 'Message',
    eyebrow: 'Eyebrow',
    quote: 'Pull quote',
    before: 'Before photo',
    beforeCaption: 'Before caption',
    after: 'After photo',
    afterCaption: 'After caption',
    logo: 'Logo',
    note: 'Note',
    badgeHtml: 'Badge script or HTML',
    group: 'Group label',
  }
  return words[name] ?? name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

interface Zodish {
  def: {
    type: string
    innerType?: Zodish
    element?: Zodish
    entries?: Record<string, string>
    checks?: Array<{ _zod?: { def?: { check?: string; maximum?: number } } }>
  }
  shape?: Record<string, Zodish>
}

function unwrap(schema: Zodish): { schema: Zodish; optional: boolean } {
  let current = schema
  let optional = false
  while (current.def?.type === 'optional' || current.def?.type === 'default' || current.def?.type === 'nullable') {
    if (current.def.type === 'optional' || current.def.type === 'nullable') optional = true
    if (!current.def.innerType) break
    current = current.def.innerType
  }
  return { schema: current, optional }
}

function maxOf(schema: Zodish): number | undefined {
  for (const check of schema.def.checks ?? []) {
    if (check._zod?.def?.check === 'max_length' && typeof check._zod.def.maximum === 'number') return check._zod.def.maximum
  }
  return undefined
}

function isRichText(schema: Zodish): boolean {
  const shape = schema.shape
  return schema.def.type === 'object' && !!shape?.type && !!shape?.content && shape.type.def.type === 'literal'
}

function isImage(schema: Zodish): boolean {
  return schema.def.type === 'object' && !!schema.shape?.media
}

function isLink(schema: Zodish): boolean {
  return schema.def.type === 'object' && !!schema.shape?.href && !!schema.shape?.label
}

function describe(schema: Zodish, name: string, path: string): FieldSpec {
  const { schema: inner, optional } = unwrap(schema)
  const type = inner.def.type
  const base = { name, path, label: labelize(name), optional }

  if (isRichText(inner)) return { ...base, kind: 'richtext' }
  if (isImage(inner)) return { ...base, kind: 'image', fields: describeObject(inner, path) }
  if (isLink(inner)) return { ...base, kind: 'link', fields: describeObject(inner, path) }

  if (type === 'string') {
    const max = maxOf(inner)
    if (name === 'video' || /media/i.test(name)) return { ...base, kind: 'media', max }
    if (name === 'embed') return { ...base, kind: 'embed', max }
    return { ...base, kind: max && max > 160 ? 'textarea' : 'text', max }
  }
  if (type === 'enum') return { ...base, kind: 'enum', options: Object.keys(inner.def.entries ?? {}) }
  if (type === 'boolean') return { ...base, kind: 'boolean' }
  if (type === 'number') return { ...base, kind: 'number' }
  if (type === 'array' && inner.def.element) {
    const el = unwrap(inner.def.element).schema
    return { ...base, kind: 'list', item: el.def.type === 'object' ? describeObject(el, `${path}[]`) : [describe(inner.def.element, 'item', `${path}[]`)] }
  }
  if (type === 'object') return { ...base, kind: 'object', fields: describeObject(inner, path) }
  return { ...base, kind: 'unknown' }
}

function describeObject(schema: Zodish, prefix: string): FieldSpec[] {
  return Object.entries(schema.shape ?? {}).map(([key, value]) => describe(value, key, prefix ? `${prefix}.${key}` : key))
}

/** Field specs for a props schema. Plugin blocks use the same walk on the server. */
export function describeProps(schema: object): FieldSpec[] {
  return describeObject(schema as Zodish, '')
}

export function fieldsForBlock(type: string): FieldSpec[] {
  const def = blockRegistry.get(type)
  if (def) return describeObject(def.props as unknown as Zodish, '')
  return pluginByType(type)?.fields ?? []
}

/** Missing Hero layout is the single photo. Hiding a field does not remove its saved value. */
export function heroLayout(props: Record<string, unknown>): string {
  return typeof props.mode === 'string' && props.mode ? props.mode : 'image'
}

/** Fields the inspector shows for the current props. Other section types show every field. */
export function visibleFieldsForBlock(type: string, props: Record<string, unknown>): FieldSpec[] {
  const fields = fieldsForBlock(type)
  if (type !== 'Hero') return fields
  const mode = heroLayout(props)
  return fields.filter((field) => {
    if (field.name === 'image') return mode === 'image' || mode === 'video'
    if (field.name === 'poster' || field.name === 'video') return mode === 'video'
    if (field.name === 'slides') return mode === 'image-carousel' || mode === 'video-carousel'
    return true
  })
}

/** Slide subfields. A photo carousel hides the video id; a video carousel keeps it. */
export function visibleListItemFields(type: string, field: FieldSpec, props: Record<string, unknown>): FieldSpec[] {
  const items = field.item ?? []
  if (type !== 'Hero' || field.name !== 'slides') return items
  if (heroLayout(props) === 'video-carousel') return items
  return items.filter((sub) => sub.name !== 'video')
}

export function blockCatalog(): CatalogItem[] {
  const core = STARTER_BLOCKS.map((b) => ({
    type: b.type,
    label: b.label,
    category: b.category,
    headingProps: b.headingProps,
    sample: b.sample as Record<string, unknown>,
  }))
  const plugins = pluginCatalogState.value.map((block) => ({
    type: block.type,
    label: block.label,
    category: block.category,
    sample: block.sample,
    plugin: true as const,
    trust: block.trust,
  }))
  return [...core, ...plugins]
}

export function blockLabel(type: string): string {
  return blockRegistry.get(type)?.label ?? pluginByType(type)?.label ?? type
}

export function headingProp(type: string): string | undefined {
  return blockRegistry.get(type)?.headingProps?.[0]
}

export function imageSlotFor(type: string, path: string): { width: number; height: number; ratio: string } | null {
  const slots = blockRegistry.get(type)?.imageSlots ?? pluginByType(type)?.imageSlots
  if (!slots) return null
  const parts = path.split('.')
  const last = parts.at(-1) ?? ''
  const fromIndex = parts.length >= 3 && /^\d+$/.test(parts.at(-2) ?? '') ? `${parts[0]}.${last}` : ''
  const slot = slots[path] ?? (fromIndex ? slots[fromIndex] : undefined) ?? slots[last]
  if (!slot) return null
  return { width: slot.width, height: slot.height, ratio: ratioFromSize(slot.width, slot.height) }
}

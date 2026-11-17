// JSON Schema and short descriptions for the model's tool list. Inputs still go through
// the same validation as the GUI once runTool is called.
import type { ChatTool } from './ai-provider'

const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
})

const blockInput = object({ type: { type: 'string' }, props: { type: 'object' } }, ['type'])

const SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  list_templates: { description: 'List the page types this site allows.', parameters: object({}) },
  list_blocks: { description: 'List sections allowed on this page, with their prop schemas.', parameters: object({}) },
  get_page: { description: 'Read the current draft of this page.', parameters: object({}) },
  create_draft: {
    description: 'Set the title, page type and address on this new page.',
    parameters: object({ title: { type: 'string' }, template: { type: 'string' }, slug: { type: 'string' }, parentId: { type: ['string', 'null'] } }, ['title']),
  },
  add_block: {
    description: 'Add a section. Use sample-quality props that match the section schema.',
    parameters: object({ block: blockInput, afterBlockId: { type: 'string' }, index: { type: 'integer' } }, ['block']),
  },
  update_props: {
    description: 'Change props on an existing section. Only send the fields you are changing.',
    parameters: object({ blockId: { type: 'string' }, props: { type: 'object' }, unset: { type: 'array', items: { type: 'string' } } }, ['blockId', 'props']),
  },
  move_block: {
    description: 'Move a section to a new index (0 is the top).',
    parameters: object({ blockId: { type: 'string' }, toIndex: { type: 'integer' } }, ['blockId', 'toIndex']),
  },
  remove_block: {
    description: 'Remove a section from the page.',
    parameters: object({ blockId: { type: 'string' } }, ['blockId']),
  },
  set_seo: {
    description: 'Set search title, description, social image, canonical or noindex.',
    parameters: object({
      title: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      image: { type: ['string', 'null'] },
      canonical: { type: ['string', 'null'] },
      noindex: { type: 'boolean' },
    }),
  },
  set_meta: {
    description: 'Set the page title, address (slug) or parent.',
    parameters: object({ title: { type: 'string' }, slug: { type: 'string' }, parentId: { type: ['string', 'null'] } }),
  },
  search_media: {
    description: 'Search the media library by alt text.',
    parameters: object({ query: { type: 'string' } }),
  },
  request_upload: {
    description: 'Ask the person to upload a photo. You cannot upload a file yourself.',
    parameters: object({ purpose: { type: 'string' }, message: { type: 'string' }, blockId: { type: 'string' }, slot: { type: 'string' }, ratio: { type: 'string' } }),
  },
  crop_media: {
    description: 'Propose a crop for a photo. A person still has to approve it.',
    parameters: object({
      mediaId: { type: 'string' },
      blockId: { type: 'string' },
      slot: { type: 'string' },
      ratio: { type: 'string' },
      breakpoint: { type: 'string', enum: ['all', 'mobile', 'desktop'] },
      rect: object({ x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, ['x', 'y', 'width', 'height']),
    }, ['mediaId']),
  },
  list_embeds: { description: 'List registered donation forms and embeds, by name only.', parameters: object({}) },
  preview_screenshot: {
    description: 'Render a preview of the draft at a device width and return images to inspect.',
    parameters: object({ device: { type: 'string', enum: ['desktop', 'tablet', 'mobile'] }, width: { type: 'integer' } }),
  },
  run_checks: { description: 'Run speed, accessibility and SEO checks on the current draft.', parameters: object({}) },
  submit_for_review: {
    description: 'Hand the draft to an approver, with a short summary of the changes.',
    parameters: object({ summary: { type: 'string' } }),
  },
  remember: {
    description: 'Propose a memory entry for the site or this user. It is not saved until the person accepts.',
    parameters: object({ text: { type: 'string' }, scope: { type: 'string', enum: ['site', 'user'] } }, ['text']),
  },
}

export function chatToolsFor(names: readonly string[]): ChatTool[] {
  return names.flatMap((name) => {
    const spec = SCHEMAS[name]
    if (!spec) return []
    return [{ type: 'function' as const, function: { name, description: spec.description, parameters: spec.parameters } }]
  })
}

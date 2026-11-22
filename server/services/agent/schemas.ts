// Input schemas for every agent operation. The descriptions are written for an AI that has never seen this
// site: they say what a field means, what values are allowed, and what to do if unsure. They become the
// JSON Schema in MCP tools/list and in the OpenAPI file, so they are the documentation the model reads.
import { z } from 'zod'
import { AGENT_ACTIONS } from '../../../shared/agent/rules'
import { SITE_PART_KINDS, SOCIAL_NETWORKS } from '../../../shared/site-parts'

const id = (what: string, example: string) => z.string().trim().min(1).max(80).meta({ description: what, examples: [example] })

export const reason = z
  .string()
  .trim()
  .min(5, { message: 'Say why in a sentence (at least 5 characters).' })
  .max(500)
  .meta({
    description:
      'Who asked and what they asked, in one or two plain sentences of your own (see REASON in the server instructions). Never paste website text here.',
    examples: ['The owner asked in chat to take down the link to old-partner.example.org because the partnership ended.'],
  })

export const changeId = z
  .string()
  .trim()
  .max(80)
  .optional()
  .meta({
    description:
      'An open change id from an earlier edit, to add this edit to it (reviewed and published together). Leave out to start a new change; changes in review, published or discarded cannot be added to.',
    examples: ['chg_01KABCDEFGHJKMNPQRSTVWXYZ0'],
  })

const matchMode = z
  .enum(['exact', 'prefix', 'domain'])
  .default('exact')
  .meta({
    description:
      '"exact" (default): the link must be the same address (ignoring http/https, "www.", a trailing slash and upper/lower case in the domain). "prefix": the link must start with the address you give, for example https://example.org/old/ matches everything under /old/. "domain": every link to that domain, whatever the path; give just the domain, for example example.org.',
  })

const pageRef = {
  page_id: z.string().trim().max(80).optional().meta({ description: 'The page id from list_pages or get_page, for example pg_01K.... Give this or `path`.', examples: ['pg_01KABCDEFGHJKMNPQRSTVWXYZ0'] }),
  path: z.string().trim().max(300).optional().meta({ description: 'The page address on the site, for example "/privacy". Give this or `page_id`.', examples: ['/privacy'] }),
}

const scope = {
  ...pageRef,
  everywhere: z
    .boolean()
    .optional()
    .meta({ description: 'Set true to apply to every page and to the header, footer, menus and banner. Give this OR a page (page_id or path), never both. When you use it, also pass `expected_matches` so a surprise is caught before anything is changed.' }),
  expected_matches: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .meta({ description: 'How many matches you expect, from search_content or find_links. If the real number differs, nothing is changed and you get error `match_count_mismatch` with the real list. Strongly recommended.' }),
  skip_blocked: z
    .boolean()
    .optional()
    .meta({ description: 'Default false. A page that is waiting for approval or being published cannot be edited, and by default that stops the whole edit with an error naming the page. Set true to skip those pages instead; they are listed in `skipped` so you can tell the owner.' }),
}

const empty = z.object({}).strict()

// ---------------------------------------------------------------------------------------------------------------------
// Read

export const getSiteInput = empty
export const listPagesInput = z
  .object({
    query: z.string().trim().max(200).optional().meta({ description: 'Only pages whose title or address contains this text.', examples: ['privacy'] }),
    page_type: z.string().trim().max(60).optional().meta({ description: 'Only pages of this page type key, from list_page_types.', examples: ['standard'] }),
    state: z.enum(['draft', 'in_review', 'approved', 'published', 'unpublished']).optional().meta({ description: 'Only pages in this state. "published" = live. "approved" means a publish is running right now.' }),
    page: z.coerce.number().int().min(1).default(1).meta({ description: 'Page number of the results, starting at 1.' }),
    page_size: z.coerce.number().int().min(1).max(100).default(25).meta({ description: 'How many pages per result page (1 to 100).' }),
  })
  .strict()
export const getPageInput = z.object(pageRef).strict()
export const getSitePartInput = z
  .object({
    kind: z.enum(SITE_PART_KINDS).meta({ description: 'Which site-wide part: "menu", "footer", "header" or "banner".', examples: ['menu'] }),
    key: z.string().trim().max(40).optional().meta({ description: 'Which one, if the site has several of that kind (menus have a key such as "main" or "legal"). Leave out for the first one.', examples: ['main'] }),
  })
  .strict()
export const listComponentsInput = empty
export const listPageTypesInput = empty
export const searchContentInput = z
  .object({
    query: z.string().trim().min(1).max(200).meta({ description: 'The words to look for. Case-insensitive. Matches inside one run of text; text split by bold or a link is found run by run.', examples: ['0161 496 0000'] }),
    limit: z.coerce.number().int().min(1).max(200).default(50).meta({ description: 'Most results to return (1 to 200). The reply says if there were more.' }),
  })
  .strict()
export const findLinksInput = z
  .object({
    url: z.string().trim().min(1).max(2048).meta({ description: 'The address to look for, for example https://old-partner.example.org/ or a page address on this site such as /about. For match "domain", just the domain.', examples: ['https://old-partner.example.org/'] }),
    match: matchMode,
    limit: z.coerce.number().int().min(1).max(500).default(100).meta({ description: 'Most results to return (1 to 500).' }),
  })
  .strict()
export const listChangesInput = z
  .object({
    status: z.enum(['open', 'review', 'publishing', 'published', 'discarded', 'undone', 'failed']).optional().meta({ description: 'Only changes in this state.' }),
    limit: z.coerce.number().int().min(1).max(100).default(20).meta({ description: 'Most changes to return, newest first (1 to 100).' }),
  })
  .strict()
export const getChangeInput = z.object({ change_id: id('The change id.', 'chg_01KABCDEFGHJKMNPQRSTVWXYZ0') }).strict()
export const previewChangeInput = getChangeInput

// ---------------------------------------------------------------------------------------------------------------------
// Draft

const needsScope = (v: { page_id?: string; path?: string; everywhere?: boolean }) => (v.everywhere ? !v.page_id && !v.path : !!(v.page_id || v.path))
const scopeMessage = { message: 'Say where: give page_id or path for one page, or everywhere: true (not both).' }

export const editTextInput = z
  .object({
    find: z.string().min(1).max(500).meta({ description: 'The exact words to replace. Matching is case-sensitive unless `case_sensitive` is false. Text must sit inside one run of formatting: if it is partly bold or a link, search_content shows it in parts.', examples: ['0161 496 0000'] }),
    replace: z.string().max(2000).meta({ description: 'What to put instead. Use an empty string to delete the words. Plain text only: markdown and HTML are not interpreted.', examples: ['0161 496 0123'] }),
    ...scope,
    case_sensitive: z.boolean().default(true).meta({ description: 'Default true.' }),
    whole_word: z.boolean().default(false).meta({ description: 'Default false. True matches only whole words (so "cat" does not match "category").' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine(needsScope, scopeMessage)

export const removeLinkInput = z
  .object({
    url: z.string().trim().min(1).max(2048).meta({ description: 'The address of the link to take down.', examples: ['https://old-partner.example.org/'] }),
    match: matchMode,
    ...scope,
    skip_unremovable: z
      .boolean()
      .optional()
      .meta({ description: 'Default false. Some links cannot be removed on their own, for example a section that requires its button, or a menu item that has sub-items. By default that stops the edit and lists them. Set true to remove the others and list these in `could_not_remove` (the result then says `complete: false`).' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine(needsScope, scopeMessage)

export const replaceLinkInput = z
  .object({
    url: z.string().trim().min(1).max(2048).meta({ description: 'The address of the link to change.', examples: ['https://old.example.org/donate'] }),
    new_url: z.string().trim().min(1).max(2048).meta({ description: 'Where it should go instead: https://..., http://..., mailto:..., tel:..., or a path on this site such as /donate.', examples: ['https://new.example.org/donate'] }),
    match: matchMode,
    ...scope,
    change_id: changeId,
    reason,
  })
  .strict()
  .refine(needsScope, scopeMessage)

export const insertRichTextInput = z
  .object({
    ...pageRef,
    block_id: z.string().trim().min(1).max(40).meta({ description: 'The section to add text to: its `block_id` from get_page. It must be a section that holds rich text (a "RichText" section, or one with a rich-text prop such as FAQ answers).', examples: ['b_k3j9x2ab'] }),
    prop: z.string().trim().max(60).default('content').meta({ description: 'Which prop of the section holds the rich text. Default "content", which is right for "RichText" sections. get_page lists rich-text props under `rich_text[].prop`.' }),
    markdown: z.string().min(1).max(20000).meta({
      description:
        'The text to add, in simple markdown: blank lines separate paragraphs; "## Heading" (## ### ####); lines starting "- " are bullets; lines starting "1. " are numbered; **bold**, *italic*, [link text](https://address). Nothing else is interpreted (no HTML, no images, no tables).',
      examples: ['## Cookies\n\nWe use one analytics cookie, set by Plausible. It does not identify you.'],
    }),
    position: z
      .union([z.enum(['start', 'end']), z.object({ after_text: z.string().min(1).max(300) }).strict()])
      .default('end')
      .meta({ description: '"end" (default) adds after the existing text; "start" adds before it; { "after_text": "some words" } adds after the first paragraph, heading or list that contains those words.' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => !!(v.page_id || v.path), { message: 'Give page_id or path.' })

export const editComponentInput = z
  .object({
    ...pageRef,
    block_id: z.string().trim().min(1).max(40).meta({ description: 'The section to change: its `block_id` from get_page.', examples: ['b_k3j9x2ab'] }),
    props: z.record(z.string(), z.unknown()).default({}).meta({ description: 'Props to set, as a JSON object. Only the props you send are changed; others stay. A prop you send replaces the whole prop (for an array, send the whole new array). Shapes: see list_components, `props_schema`.', examples: [{ heading: 'Help us this winter' }] }),
    unset: z.array(z.string().max(60)).max(20).optional().meta({ description: 'Names of optional props to remove.', examples: [['subheading']] }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => !!(v.page_id || v.path), { message: 'Give page_id or path.' })

export const addComponentInput = z
  .object({
    ...pageRef,
    type: z.string().trim().min(1).max(60).meta({ description: 'The section type, from list_components, for example "RichText" or "CardGrid". The page type must allow it (list_page_types).', examples: ['RichText'] }),
    props: z.record(z.string(), z.unknown()).default({}).meta({ description: 'The props for the new section, matching `props_schema` from list_components. Required props must be present.', examples: [{ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] } }] }),
    after_block_id: z.string().trim().max(40).optional().meta({ description: 'Put the new section after this section (its block_id). Give this or `index`; if neither, it goes at the end.' }),
    index: z.number().int().min(0).max(100).optional().meta({ description: 'Position from the top, starting at 0.' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => !!(v.page_id || v.path), { message: 'Give page_id or path.' })

export const removeComponentInput = z
  .object({ ...pageRef, block_id: z.string().trim().min(1).max(40).meta({ description: 'The section to remove: its `block_id` from get_page.' }), change_id: changeId, reason })
  .strict()
  .refine((v) => !!(v.page_id || v.path), { message: 'Give page_id or path.' })

export const moveComponentInput = z
  .object({
    ...pageRef,
    block_id: z.string().trim().min(1).max(40).meta({ description: 'The section to move: its `block_id` from get_page.' }),
    to_index: z.number().int().min(0).max(100).meta({ description: 'Where it should end up, from the top, starting at 0.' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => !!(v.page_id || v.path), { message: 'Give page_id or path.' })

export const setPageDetailsInput = z
  .object({
    ...pageRef,
    title: z.string().trim().min(1).max(120).optional().meta({ description: 'The new page title (1 to 120 characters).' }),
    slug: z.string().trim().max(80).optional().meta({ description: 'The new address ending, lower-case letters, numbers and single dashes, for example "privacy-policy". Changing the address of a live page adds a redirect from the old one when it is published.' }),
    seo_title: z.string().trim().max(70).nullable().optional().meta({ description: 'Search-engine title, up to 70 characters. null clears it (the page title is used).' }),
    seo_description: z.string().trim().max(160).nullable().optional().meta({ description: 'Search-engine description, up to 160 characters. null clears it.' }),
    noindex: z.boolean().optional().meta({ description: 'True asks search engines not to list the page.' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => !!(v.page_id || v.path), { message: 'Give page_id or path.' })
  .refine((v) => [v.title, v.slug, v.seo_title, v.seo_description, v.noindex].some((x) => x !== undefined), { message: 'Give at least one thing to change.' })

export const createPageInput = z
  .object({
    title: z.string().trim().min(1).max(120).meta({ description: 'The page title (1 to 120 characters).', examples: ['Our volunteers'] }),
    page_type: z.string().trim().min(1).max(60).meta({ description: 'The page type key, from list_page_types.', examples: ['standard'] }),
    slug: z.string().trim().max(80).optional().meta({ description: 'The address ending, for example "volunteers". Default: made from the title.' }),
    parent_path: z.string().trim().max(300).optional().meta({ description: 'The address of the page this one sits under, for example "/about". Leave out for the top level.' }),
    sections: z
      .array(z.object({ type: z.string().trim().min(1).max(60), props: z.record(z.string(), z.unknown()).default({}) }).strict())
      .max(30)
      .default([])
      .meta({ description: 'The sections to start the page with, in order, each { "type", "props" } as for add_component. Leave empty for just the page type\'s starting sections.' }),
    change_id: changeId,
    reason,
  })
  .strict()

const newPageSection = z.object({ type: z.string().trim().min(1).max(60), props: z.record(z.string(), z.unknown()).default({}) }).strict()

export const MAX_PAGES_IN_BUILD = 12

export const createPagesInput = z
  .object({
    pages: z
      .array(
        z
          .object({
            ref: z.string().trim().regex(/^[a-z0-9_-]{1,30}$/).optional().meta({ description: 'A short name you invent for this page (lowercase letters, digits, - and _), so a later page can say parent_ref: "<this ref>". Not shown on the site.', examples: ['about'] }),
            title: z.string().trim().min(1).max(120).meta({ description: 'The page title (1 to 120 characters).', examples: ['Our volunteers'] }),
            page_type: z.string().trim().min(1).max(60).meta({ description: 'The page type key, from list_page_types.', examples: ['standard'] }),
            slug: z.string().trim().max(80).optional().meta({ description: 'The address ending, for example "volunteers". Default: made from the title.' }),
            parent_path: z.string().trim().max(300).optional().meta({ description: 'The address of an EXISTING page this one sits under, for example "/about". Give this or parent_ref, not both.' }),
            parent_ref: z.string().trim().max(30).optional().meta({ description: 'The `ref` of another page in THIS call that this one sits under. The parent must come earlier in the list. Give this or parent_path, not both.' }),
            sections: z.array(newPageSection).max(30).default([]).meta({ description: 'The sections to start the page with, in order, each { "type", "props" } as for add_component.' }),
            menu: z
              .object({
                menu_key: z.string().trim().max(40).default('main').meta({ description: 'Which menu. Default "main".' }),
                label: z.string().trim().min(1).max(40).optional().meta({ description: 'The words on the menu item. Default: the page title (cut to 40 characters).' }),
                under_label: z.string().trim().max(40).optional().meta({ description: 'Put the item under this existing top-level item (exact words, case-insensitive). Leave out for the top level.' }),
              })
              .strict()
              .optional()
              .meta({ description: 'Also add this page to a menu. This makes a menu edit inside the same change, which needs its own permission (edit_menu). Leave out to not touch any menu.' }),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PAGES_IN_BUILD)
      .meta({ description: `The pages to create, in order, 1 to ${MAX_PAGES_IN_BUILD}. All of them are created in ONE change, or none are.` }),
    change_id: changeId,
    reason,
  })
  .strict()

const menuRef = {
  menu_key: z.string().trim().max(40).default('main').meta({ description: 'Which menu. Default "main". Other menus (for example "legal") are listed by get_site_part with kind "menu".' }),
}
const itemRef = {
  item_id: z.string().trim().max(40).optional().meta({ description: 'The menu item id from get_site_part (kind "menu"). Give this or `label`.' }),
  label: z.string().trim().max(40).optional().meta({ description: 'The words on the menu item (case-insensitive, exact). If two items share the words you get an error listing their ids.' }),
}
const itemTarget = {
  url: z.string().trim().max(2048).optional().meta({ description: 'Where the item links: https://..., /path on this site, mailto: or tel:. Give this or `page_id`.' }),
  page_id: z.string().trim().max(80).optional().meta({ description: 'A page on this site to link to (follows the page if its address changes). Give this or `url`.' }),
}
const hasItem = (v: { item_id?: string; label?: string }) => !!(v.item_id || v.label)

export const removeMenuItemInput = z
  .object({ ...menuRef, ...itemRef, remove_children: z.boolean().optional().meta({ description: 'Default false. If the item has sub-items you must set true to remove them with it.' }), change_id: changeId, reason })
  .strict()
  .refine(hasItem, { message: 'Give item_id or label.' })
export const addMenuItemInput = z
  .object({
    ...menuRef,
    label: z.string().trim().min(1).max(40).meta({ description: 'The words on the new item (1 to 40 characters).' }),
    ...itemTarget,
    parent_item_id: z.string().trim().max(40).optional().meta({ description: 'Put it inside this item as a sub-item (the parent\'s id). Leave out for the top level. A menu has at most 12 top-level items and each item at most 12 sub-items.' }),
    position: z.number().int().min(0).max(12).optional().meta({ description: 'Position among its siblings, starting at 0. Default: the end.' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => !!(v.url || v.page_id) && !(v.url && v.page_id), { message: 'Give url or page_id, not both.' })
export const renameMenuItemInput = z
  .object({ ...menuRef, ...itemRef, new_label: z.string().trim().min(1).max(40).meta({ description: 'The new words (1 to 40 characters).' }), change_id: changeId, reason })
  .strict()
  .refine(hasItem, { message: 'Give item_id or label.' })

export const setBannerInput = z
  .object({
    enabled: z.boolean().optional().meta({ description: 'True shows the banner on every page; false hides it. A banner must have a message to be shown.' }),
    message: z.string().trim().max(160).optional().meta({ description: 'The banner words, up to 160 characters. Plain text.', examples: ['Our shop is closed on Monday for the bank holiday.'] }),
    link: z
      .union([
        z
          .object({
            label: z.string().trim().min(1).max(30),
            url: z.string().trim().max(2048).optional(),
            page_id: z.string().trim().max(80).optional(),
            icon: z.enum(['heart']).optional().meta({ description: 'Set "heart" to draw a small heart before the label.' }),
          })
          .strict(),
        z.null(),
      ])
      .optional()
      .meta({ description: 'A link on the banner: { "label": "Read more", "url": "https://..." } or { "label": ..., "page_id": ... }. Optional icon "heart". null removes the link.' }),
    tone: z.enum(['info', 'urgent', 'celebrate', 'accent']).optional().meta({ description: 'The look: "info" (calm), "urgent", "celebrate" or "accent".' }),
    change_id: changeId,
    reason,
  })
  .strict()
  .refine((v) => [v.enabled, v.message, v.link, v.tone].some((x) => x !== undefined), { message: 'Give at least one thing to change.' })

// ---------------------------------------------------------------------------------------------------------------------
// Decide

const needsChange = z.object({ change_id: id('The change to act on: the `change.id` returned by an edit tool.', 'chg_01KABCDEFGHJKMNPQRSTVWXYZ0') })
export const requestPublishInput = needsChange.extend({ note: z.string().trim().max(500).optional().meta({ description: 'A short note for the person who will approve it, saying what to look at.' }) }).strict()
export const publishChangeInput = needsChange.strict()
export const discardChangeInput = needsChange.strict()
export const undoChangeInput = needsChange.extend({ reason }).strict()

export type ActionName = (typeof AGENT_ACTIONS)[number]

// ---------------------------------------------------------------------------------------------------------------------
// Phase 5: footer and media

const nullableText = (max: number, description: string) => z.string().trim().max(max).nullable().optional().meta({ description })

export const setFooterInput = z
  .object({
    text_markdown: z.string().max(2000).nullable().optional().meta({ description: 'The footer words (about text), as markdown: paragraphs, **bold**, *italic*, [links](https://...). null or "" removes them. Leave out to keep them.', examples: ['We rescue and treat injured street animals in Udaipur.'] }),
    contact: z
      .object({
        email: z.string().trim().max(254).nullable().optional().meta({ description: 'Contact email. null or "" removes it.' }),
        phone: z.string().trim().max(30).nullable().optional().meta({ description: 'Contact phone: digits, spaces and + ( ) - only. null or "" removes it.' }),
        address: z.string().trim().max(200).nullable().optional().meta({ description: 'Postal address on one line. null or "" removes it.' }),
      })
      .strict()
      .optional()
      .meta({ description: 'Contact details. Only the fields you give change.' }),
    social: z
      .array(z.object({ network: z.enum(SOCIAL_NETWORKS).meta({ description: `One of: ${SOCIAL_NETWORKS.join(', ')}.` }), url: z.string().trim().max(2048).meta({ description: 'The full https:// address of the profile.' }) }).strict())
      .max(8)
      .optional()
      .meta({ description: 'The FULL list of social links, in order (it replaces the list). Read it first with get_site_part kind "footer" and send it back with your change. [] removes them all.' }),
    layout: z.enum(['simple', 'columns']).optional().meta({ description: '"simple" is the stacked footer. "columns" shows the logo, tagline, about text, a contact column and a links column. Leave out to keep the current layout.' }),
    tagline: z
      .object({ lead: z.string().trim().min(1).max(60).meta({ description: 'The first words of the tagline.' }), accent: z.string().trim().max(60).optional().meta({ description: 'Words shown in the accent colour after the lead.' }) })
      .strict()
      .nullable()
      .optional()
      .meta({ description: 'The tagline in the columns footer. null removes it.' }),
    contact_title: nullableText(40, 'Heading over the contact column. null or "" removes it.'),
    links_menu_key: z.string().trim().max(40).nullable().optional().meta({ description: 'The key of an existing menu shown as the links column. null or "" removes it. Use get_site_part with kind "menu" for the keys.' }),
    links_title: nullableText(40, 'Heading over the links column. null or "" removes it.'),
    legal_text: nullableText(200, 'The small print line, for example "© 2026 Animal Aid". null or "" removes it.'),
    charity_number: nullableText(40, 'The registered charity number, exactly as the person gave it. null or "" removes it.'),
    change_id: changeId,
    reason,
  })
  .strict()

export const listMediaInput = z
  .object({
    search: z.string().trim().max(200).optional().meta({ description: 'Only photos whose file name or alt text contains this.', examples: ['dog'] }),
    kind: z.enum(['image', 'video']).optional().meta({ description: 'Only images or only videos.' }),
    page: z.coerce.number().int().min(1).default(1).meta({ description: 'Page number of the results, starting at 1.' }),
    page_size: z.coerce.number().int().min(1).max(100).default(25).meta({ description: 'How many per result page (1 to 100).' }),
  })
  .strict()

const altText = z.string().trim().min(1).max(250).meta({ description: 'What the photo shows, for people who cannot see it, in one plain sentence (up to 250 characters). Describe only what is visible. Required unless decorative is true.', examples: ['A brown street dog with a bandaged leg resting on a blanket.'] })
const decorative = z.boolean().optional().meta({ description: 'True if the photo adds nothing for someone who cannot see it (a pattern, a texture). Then no alt text is needed.' })

export const importMediaInput = z
  .object({
    url: z.string().trim().min(1).max(2048).meta({ description: 'The public https:// address of the image FILE itself (ends in .jpg, .png, .webp, .avif or similar), not the page it appears on. JPEG, PNG, WebP, AVIF or SVG, up to 25 MB.', examples: ['https://example.org/photos/rescued-dog.jpg'] }),
    alt: altText.optional(),
    decorative,
    filename: z.string().trim().min(1).max(120).optional().meta({ description: 'A file name to show in the library. Default: the last part of the address.' }),
    reason,
  })
  .strict()

export const getMediaImportInput = z.object({ import_id: id('The import_id that import_media returned.', 'job_01KABCDEFGHJKMNPQRSTVWXYZ0') }).strict()

export const setAltTextInput = z
  .object({
    media_id: id('The media_id from list_media or get_media_import.', 'med_01KABCDEFGHJKMNPQRSTVWXYZ0'),
    alt: altText.optional(),
    decorative,
    reason,
  })
  .strict()

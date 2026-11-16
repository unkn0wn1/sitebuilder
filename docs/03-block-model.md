# Block model

Draft. The page model is the heart of the system. The editor, the chat agent, the validator and the static generator all work on the same JSON.

## Borrowed from Puck

[Puck](https://puckeditor.com) stores a page as JSON with a list of `{ type, props }` items and a root. That shape is simple, easy for an AI to read and write, and easy to validate. We keep close to it so ideas and tooling can be borrowed, but we do not depend on Puck.

## Page document (sketch)

```json
{
  "id": "pg_01J...",
  "slug": "winter-appeal",
  "locale": "en",
  "template": "campaign",
  "title": "Winter appeal",
  "seo": {
    "description": "Help keep injured street animals warm this winter.",
    "image": "media_01J..."
  },
  "blocks": [
    {
      "id": "b1",
      "type": "Hero",
      "props": {
        "heading": "Keep them warm this winter",
        "subheading": "Your gift pays for blankets, food and treatment.",
        "image": { "media": "media_01J...", "alt": "A rescued puppy wrapped in a blanket" },
        "cta": { "label": "Donate now", "href": "#donate" }
      }
    },
    {
      "id": "b2",
      "type": "RichText",
      "props": { "content": "<p>Simple, sanitised rich text.</p>" }
    },
    {
      "id": "b3",
      "type": "DonationEmbed",
      "props": { "provider": "virtuous", "formId": "abc123", "anchor": "donate" }
    }
  ]
}
```

Notes:

- `id` on every block, so the agent and the diff view can refer to a block exactly.
- Blocks are a flat list at first. Nested layouts (columns, sections with children) are an open question.
- Rich text is a small, sanitised subset (paragraphs, headings, lists, links, bold, italic). No raw HTML.
- Images refer to media by id. The renderer turns that into a full `srcset`. See [05-image-pipeline.md](05-image-pipeline.md).

## Block definition (sketch)

Each block type has a Vue component and a definition with its prop schema and rules:

```ts
defineBlock({
  type: 'Hero',
  label: 'Hero',
  category: 'Headers',
  props: {
    heading: text({ required: true, maxLength: 80 }),
    subheading: text({ maxLength: 160 }),
    image: image({ required: true, slot: { width: 1280, height: 720 }, altRequired: true }),
    video: video({ optional: true, maxSizeMb: 4 }),
    cta: link({ optional: true }),
  },
  allowedIn: ['home', 'campaign', 'standard'],
  clientJs: false,
})
```

The prop schema is the single source of truth for:

- the editor form fields,
- validation of every save (from the editor or the agent),
- the tool descriptions given to the AI,
- image slot sizes for the crop step.

The schema format (JSON Schema, Zod or Valibot) is still to be decided. Whatever it is, it must be able to produce JSON Schema for the AI tool definitions.

## Brand constraints

Blocks never take raw colours, fonts or spacing. They take tokens from the brand pack (for example `tone: "primary" | "neutral" | "accent"`). That keeps every page on-brand whoever, or whatever, edits it.

## Versions and states

- Every save creates a new immutable version of the page document.
- A page has a pointer to its current draft and its current published version.
- States: `draft`, `in_review`, `approved`, `published`.
- Rollback means making an old version the new draft and approving it.

## Starter blocks (MVP)

Hero (image or video), RichText, Image, Gallery, Quote, Stats, CardGrid, CallToAction, Video, FAQ, DonationEmbed, Embed (allow-listed), plus the header and footer from the shell.

## Open questions

- Flat block list only, or allow container blocks with children (sections, columns) from the start?
- Schema library: JSON Schema directly, Zod or Valibot?
- How do templates work: a fixed starting set of blocks, or rules about which blocks may appear and in what order?
- How are reusable sections (for example the same donate panel on many pages) handled?

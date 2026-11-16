# Block model

Draft, with v1 choices decided in [ADR 0008](decisions/0008-editor-shape.md) (flat sections) and [ADR 0010](decisions/0010-zod-versioned-blocks-structured-rich-text.md) (Zod, versions, structured rich text). The page model is the heart of the system. The editor, the chat agent, the validator and the static generator all work on the same JSON.

## Borrowed from Puck

[Puck](https://puckeditor.com) stores a page as JSON with a list of `{ type, props }` items and a root. That shape is simple, easy for an AI to read and write, and easy to validate. We keep close to it so ideas and tooling can be borrowed, but we do not depend on Puck.

## Page document (sketch)

```json
{
  "schemaVersion": 1,
  "title": "Winter appeal",
  "seo": {
    "title": null,
    "description": "Help keep injured street animals warm this winter.",
    "image": "med_01J...",
    "canonical": null,
    "noindex": false
  },
  "blocks": [
    {
      "id": "b_7f3k",
      "type": "Hero",
      "v": 1,
      "props": {
        "heading": "Keep them warm this winter",
        "subheading": "Your gift pays for blankets, food and treatment.",
        "image": { "media": "med_01J...", "alt": "A rescued puppy wrapped in a blanket" },
        "cta": { "label": "Donate now", "href": "#donate" }
      }
    },
    {
      "id": "b_2m9q",
      "type": "RichText",
      "v": 1,
      "props": {
        "content": {
          "type": "doc",
          "content": [
            { "type": "paragraph", "content": [
              { "type": "text", "text": "Your gift pays for " },
              { "type": "text", "text": "blankets", "marks": [{ "type": "bold" }] },
              { "type": "text", "text": "." }
            ] }
          ]
        }
      }
    },
    {
      "id": "b_4k1z",
      "type": "DonationEmbed",
      "v": 1,
      "props": { "embed": "emb_01J...", "anchor": "donate" }
    }
  ]
}
```

Notes:

- `id` on every block (given by the server), so the agent and the diff view can refer to a block exactly.
- `schemaVersion` is the page document format; `v` is the version of that block type when it was written. Both are migrated forward on read (see below).
- Slug, path, parent, locale and template live on the page record, not in the document. See [13-data-model.md](13-data-model.md).
- **Blocks are a flat list in v1** ([ADR 0008](decisions/0008-editor-shape.md)). Layout variety comes from options on a block (for example `layout: "image-left"`). Nested containers may come later behind a `schemaVersion` bump.
- **Rich text is structured JSON**, not HTML: paragraphs, headings (levels 2 to 4), bullet and numbered lists, and text with bold, italic and links (`https:`, `http:`, `mailto:`, `tel:` or a site path). The renderer produces the HTML, so there is nothing to sanitise and nowhere to hide a script.
- Donation forms are picked by registered embed id, never by pasting code.
- Images refer to media by id. The renderer turns that into a full `srcset`. See [05-image-pipeline.md](05-image-pipeline.md).

## Block definition (sketch)

Each block type has a Vue component and a definition with its prop schema and rules:

```ts
defineBlock({
  type: 'Hero',
  version: 1,
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
  migrations: {
    // 1: (props) => ({ ...props, layout: 'centred' }),  // from v1 to v2
  },
})
```

The prop schema is the single source of truth for:

- the editor form fields,
- validation of every save (from the editor or the agent),
- the tool descriptions given to the AI,
- image slot sizes for the crop step.

The schema format is **Zod**, which can also produce JSON Schema for the AI tool definitions ([ADR 0010](decisions/0010-zod-versioned-blocks-structured-rich-text.md)).

## Schema versions and migrations

- When a block's props change in a way old content would not pass, its `version` goes up by one and it registers a migration from the old version.
- Stored blocks are **migrated forward on read**: before validation, rendering, diffing or rollback. Upgrades also migrate stored drafts and live versions in bulk.
- Migrations must be pure functions with tests. A block type is never removed while content uses it; it is deprecated (hidden from the palette) first.
- Template rule changes (for example a newly required block) do not break existing pages. Those pages are flagged and the rule is enforced at their next submission.

## Brand constraints

Blocks never take raw colours, fonts or spacing. They take tokens from the brand pack (for example `tone: "primary" | "neutral" | "accent"`). That keeps every page on-brand whoever, or whatever, edits it.

## Versions and states

- Every edit is an operation in an edit log; snapshots of the draft are saved as versions, with autosaves coalesced so history stays readable. Sealed versions never change. See [13-data-model.md](13-data-model.md#versions-drafts-and-autosave).
- A page has a pointer to its current draft and its current published version.
- States: `draft`, `in_review`, `approved`, `published`, `unpublished`, defined once in [13-data-model.md](13-data-model.md#page-workflow-states).
- Page rollback means making an old version the new draft and approving it. Site rollback follows release manifests ([ADR 0005](decisions/0005-rollback-and-approval.md)).

## Templates (page types)

A template is a set of rules, not a fixed layout:

- **Allowed blocks:** which block types may be added.
- **Required blocks:** which must be present before submission (for example a campaign page must have a donation form).
- **Starting blocks:** the blocks a new page of this type begins with.
- Order is not enforced in v1.

## Starter blocks (MVP)

Hero (image or video), RichText, Image, Gallery, Quote, Stats, CardGrid, CallToAction, Video, FAQ, DonationEmbed, Embed (allow-listed), plus the header and footer from the shell.

## Open questions

- How are reusable sections (for example the same donate panel on many pages) handled? Likely a site-part-like record referenced by id, after v1.

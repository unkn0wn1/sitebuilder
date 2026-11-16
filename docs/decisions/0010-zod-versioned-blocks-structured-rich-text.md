# 0010: Zod block schemas with versions, and structured rich text

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The schema library (JSON Schema, Zod or Valibot) was open. Page documents and blocks had no version, so changing a block's props would break old pages and old versions used for rollback. Rich text was stored as an HTML string, which needs sanitising everywhere it is rendered.

## Decision

- **Zod** for block prop schemas and API validation. Zod can produce JSON Schema for the AI tool definitions.
- Each **page document** has a `schemaVersion`. Each **block type** has a `version`, and each stored block records the version it was written with (`v`).
- A block definition can register **migrations** (`from` version to `from + 1`). Blocks are migrated forward **on read**, before validation, rendering or diffing, and in bulk on upgrade. Rolling back to an old version migrates it forward first.
- **Rich text is structured JSON**, not HTML: a small tree of paragraphs, headings (levels 2 to 4), bullet and numbered lists, and text runs with bold, italic and links. Links are limited to `https:`, `http:`, `mailto:`, `tel:` and site-relative paths. The renderer turns the tree into HTML, so there is no HTML to sanitise and no way to store a script.
- Pasted HTML in the editor is converted into this tree on the way in. Anything that does not fit is dropped.

## Consequences

- Content and schemas can evolve without breaking history.
- Cross-site scripting through rich text is removed by design, not by a sanitiser.
- The editor needs a rich text component that speaks this format (TipTap or ProseMirror with a matching schema is the likely choice).

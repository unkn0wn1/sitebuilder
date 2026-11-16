# 0008: Editor shape for v1

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The first editor sketch had four regions (block panel, canvas, properties under the canvas, AI panel). On a 1366 pixel laptop that leaves the canvas narrower than a tablet. Inline editing, nested layouts and mobile use were open questions.

## Decision

- **Left rail, tabbed:** Assistant (the AI panel, where allowed), Add (section palette), Outline (reorder). One tab open at a time. Collapses to icons.
- **Canvas in the middle**, rendered with the real block components, with the **Desktop, Tablet, Mobile switch in the editor toolbar** (1280, 768, 390 pixels), not only on the Preview screen.
- **Right inspector, tabbed:** Section (fields for the selected section), Page (slug, parent, template, SEO), History. It slides away when nothing is selected.
- **Inline text editing on the canvas** for headings and body text. Images, links and options are edited in the inspector.
- **Flat list of sections in v1.** No nested containers. Layout variety comes from sections with fixed internal layouts (for example a "Text and image" section with a `layout: "image-left" | "image-right"` option).
- **New page** opens as a full-width conversation with the assistant (or a template picker), then turns into the editor layout once the first draft exists.
- **Mobile scope:** a small, deliberate mobile mode for **approving** (review screen with preview and changes) and **quick text fixes** (find a page, tap text, edit, submit). No section palette, drag and drop or assistant on phones in v1.
- **The builder has its own neutral look.** Only the canvas and previews use the site's theme.
- Staff-facing words follow the glossary in [04-gui.md](../04-gui.md#glossary): "Section" not "Block", "Live" not "Published".

## Consequences

- The canvas can show a true desktop width on a normal laptop.
- Flat sections keep the editor, the diff, the AI tools and the renderer simple. Nested layouts can come later behind a schema version bump.
- Inline editing makes "fix a typo" a few seconds' job, at the cost of some editor complexity.

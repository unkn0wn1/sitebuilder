# 0014: Build our own Vue editor

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Milestone 3 needs a visual editor. The options were to build our own Vue editor, or start from an existing one (Gissen or Page Composer). Puck is the quality bar in this space, but it is React-only ([ADR 0001](0001-nuxt.md)). The editor shape is already decided ([ADR 0008](0008-editor-shape.md)). The Phase 1 spike is written up in [docs/spikes/002-editor-base.md](../spikes/002-editor-base.md).

## Decision

Build our own Vue editor on top of the existing page document, `applyOps`, and the block registry. Do not depend on Gissen or Page Composer in v1. Continue to borrow UX ideas from Puck. Stay fully open source; do not use Puck's paid AI layer for comparison.

## Consequences

- Milestone 3 implements the canvas, outline, inspector, inline text and device switch in-tree, rendering the same block components the publish bundle will use.
- We own the document model end to end, so the AI tools, validation, versions and conflicts stay one path.
- We take on the cost of drag and drop, inline editing and accessibility ourselves. The spike suggests the first version (select, reorder, inline headings, device widths) is small. Richer drag and drop can be added later.
- Revisit third-party editors only if a Vue library becomes mature and can consume our document (or a thin adapter) without forcing nesting or a new source of truth.

# 0006: Custom code lives in a `site/` layer, outside core

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

There is no plugin marketplace (see [00-vision.md](../00-vision.md#non-goals)), but sites will still need some code of their own: a full theme, an organisation-specific block, or a block variant made with the reference URL feature ([07-ai-agent.md](../07-ai-agent.md)). If that code lives inside core, every site becomes a fork, and every upgrade becomes a merge.

## Decision

- Each install has a **`site/` folder**, a Nuxt layer that core loads last. It may contain only:
  - `site/blocks/` extra block definitions and their renderers,
  - `site/themes/` extra themes (tokens and block renderer overrides),
  - `site/migrations/` block migrations for its own blocks.
- `site/` is its own git repository (or folder) owned by the organisation. Core upgrades never touch it.
- Code in `site/` is **reviewed code, not runtime plugins**. Nothing is installed from the builder UI. Adding to `site/` means a code change and a recompile (ADR 0004).
- Site blocks use the same `defineBlock` API, and must pass the same schema, accessibility and speed checks in CI as core blocks.
- Core keeps a **stable, versioned block API** (`defineBlock`, prop helpers, theme token names). Breaking changes to it are announced in release notes with a migration note.
- The reference URL feature writes its output as a change to `site/`, never to core.

## Consequences

- Upgrades are "pull new core, recompile". No merges into a fork.
- Organisations own their customisations outright.
- Core has to treat the block API as a public contract and version it carefully.
- Good site blocks can be offered upstream later, by normal contribution.

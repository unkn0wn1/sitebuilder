# Spike: editor base

Prototype for the Phase 1 editor-base spike in [docs/09-roadmap.md](../../docs/09-roadmap.md). Findings and the decision are in [docs/spikes/002-editor-base.md](../../docs/spikes/002-editor-base.md) and [ADR 0014](../../docs/decisions/0014-first-party-vue-editor.md).

A small Vue app that edits our existing page document through the same `applyOps` functions the API uses: outline, canvas, device widths, inline heading edit, move up and down. It is enough to show that a first-party editor can sit on our model without Gissen or Page Composer.

## Run

From the repo root:

```bash
npx vite --config spikes/editor-base/vite.config.ts
npx vite build --config spikes/editor-base/vite.config.ts
```

`dist/` is generated and not committed. This is not the production builder GUI (that is milestone 3).

# Spike: editor base

**Date:** 17 November 2026. Code in [`spikes/editor-base/`](../../spikes/editor-base/). Decision: [ADR 0014](../decisions/0014-first-party-vue-editor.md).

## What we asked

Should we build our own Vue editor, or start from an existing one (Gissen or Page Composer)? A related question: is Puck's paid AI layer acceptable for a quick comparison, or should the spike stay fully open source?

## What we looked at

| Option | What it is (as of 17 November 2026) | Fit |
| --- | --- | --- |
| Build our own | A Vue canvas, outline and inspector on top of our existing page document and `applyOps` | Direct fit. We already have the document model, validation, versions, conflicts and AI tools. |
| [Gissen](https://gissen.dev) | MIT, Vue 3, Puck-like, "headless" editor. npm `gissen` 0.1.0-alpha.7, last published 27 September 2026. The README still marks it pre-alpha, with unstable APIs. About 37 GitHub stars, one main maintainer. | Closest Vue equivalent of Puck, and still too young to bet the builder on. |
| [Page Composer](https://github.com/virgilvox/vue-page-composer) (`vue-page-composer`) | MIT, Vue and Nuxt, also Puck-like, with an inspector, undo, an outline, an optional iframe canvas and a Nuxt SSR module. 0.7.1, last published 29 May 2026. No further releases in the six months since. 0 GitHub stars, one maintainer. | More complete on paper, but it looks unmaintained, and its document model (a node map, zones, `$bind` data binding, repeaters) is not ours. |
| [Puck](https://github.com/puckeditor/puck) | The React editor we already borrowed our `{ type, props }` shape from. | We cannot use it. The stack is Vue ([ADR 0001](../decisions/0001-nuxt.md)). |

We did not use Puck's paid AI layer. The spike stayed fully open source. Puck cannot host our editor, and we already have our own task-scoped tool model.

## What we built

A small first-party Vue app that:

- Loads a page in our existing document format.
- Renders sections on a canvas with a device switch (1280, 768 and 390 pixels), matching [ADR 0008](../decisions/0008-editor-shape.md).
- Selects a section from the canvas or the outline.
- Moves sections with `move_block` and edits a heading with `update_props`, through the same `applyOps` path the API uses.
- Builds with Vite, using the shared block registry.

It is a few hundred lines. It is not the production GUI (milestone 3 still has to add the rail tabs, the real inspector, inline body text, autosave, history, the AI panel, and the real render bundle on the canvas). It was enough to show that the hard part for v1 is already in our model, not in the chrome around it.

## Recommendation

**Build our own Vue editor.** Do not take a dependency on Gissen or Page Composer for v1.

Reasons, in short:

- Our v1 editor is a flat list of sections, our own ops, our Zod schemas, conflict detection, and AI tools that already call those ops. Adopting either library means an adapter into a different document model, plus features we have deliberately postponed (nesting, data binding, repeaters).
- The layout is already decided (left rail, canvas, right inspector, device switch, inline text). We would be fighting someone else's chrome, or hiding most of it.
- Both Vue options are young, each with a single maintainer. Gissen is still alpha. Page Composer has not shipped in six months. A locked private CMS is a poor place to absorb that risk.
- The spike showed that a useful canvas on our ops is small. The time in milestone 3 is better spent on inline editing, the real render bundle, and the review flow than on wrapping an unstable library.

Keep watching both projects. If one matures and stays true to "your components, JSON out", it could still help a later, richer editor (nested layout, more drag and drop). That is a later decision, not a v1 one. Continue to borrow good UX from Puck, as we already do.

On Puck's paid AI layer: leave it. This spike should stay open source, and we would learn little from a React-only, paid add-on when our tool list and scoping rules are already written.

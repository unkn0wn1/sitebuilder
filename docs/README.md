# Docs

The design is written here first, then built. Everything in this folder is a draft and expected to change.

| Doc | What it covers |
| --- | --- |
| [00-vision.md](00-vision.md) | What we are building and why |
| [01-principles.md](01-principles.md) | The rules every decision is checked against |
| [02-architecture.md](02-architecture.md) | Components and how they fit together |
| [03-block-model.md](03-block-model.md) | The JSON page and block model |
| [04-gui.md](04-gui.md) | The builder interface: layout, states, patterns, screen sketches, glossary |
| [05-image-pipeline.md](05-image-pipeline.md) | Uploads, resizing, srcset, crops |
| [06-setup-wizard.md](06-setup-wizard.md) | Brand, shell and menus, allowed templates |
| [07-ai-agent.md](07-ai-agent.md) | The chat agent and its guardrails |
| [08-hosting.md](08-hosting.md) | nginx, Cloudflare, publishing |
| [09-roadmap.md](09-roadmap.md) | Phases and the first pilot |
| [10-essentials.md](10-essentials.md) | CMS feature inventory with priorities and GUI placement (to discuss) |
| [11-theming.md](11-theming.md) | Themes: switching the whole site's look (draft) |
| [12-ai-harness.md](12-ai-harness.md) | How the AI is wrapped and kept on remit (draft) |
| [13-data-model.md](13-data-model.md) | Entities, states, versions, autosave, concurrent edits, releases |
| [14-api.md](14-api.md) | The HTTP API contract, errors and operations |
| [15-security.md](15-security.md) | Builder, public site, origin, secrets and AI security |
| [16-operations.md](16-operations.md) | Install, jobs, email, backups, monitoring, upgrades, AI outages |
| [17-testing-and-budgets.md](17-testing-and-budgets.md) | Test layers, performance budgets, checks before review, AI evals |
| [18-user-journeys.md](18-user-journeys.md) | The ten core journeys the GUI must make easy |
| [open-questions.md](open-questions.md) | Decisions still to make |
| [spikes/](spikes/) | Phase 1 spike write-ups (sample render, editor base) |
| [decisions/](decisions/) | Short architecture decision records (ADRs) |

## What is locked in

Each with an ADR in [decisions/](decisions/):

- Nuxt (Vue 3, Vite, TypeScript): [ADR 0001](decisions/0001-nuxt.md)
- No Varnish, Cloudflare mandatory: [ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md)
- Static output served by nginx: [ADR 0003](decisions/0003-static-output.md)
- Compile once, render only changed pages: [ADR 0004](decisions/0004-incremental-publish.md)
- Rollback follows releases; approval and self-approval rules: [ADR 0005](decisions/0005-rollback-and-approval.md)
- Custom code in a `site/` layer: [ADR 0006](decisions/0006-site-layer.md)
- One site per install, operator role, Cloudflare Access: [ADR 0007](decisions/0007-single-site-install.md)
- Editor shape for v1: [ADR 0008](decisions/0008-editor-shape.md)
- SQLite with Drizzle, job table: [ADR 0009](decisions/0009-sqlite-drizzle-and-jobs.md)
- Zod, versioned blocks, structured rich text: [ADR 0010](decisions/0010-zod-versioned-blocks-structured-rich-text.md)
- Named tracking integrations: [ADR 0011](decisions/0011-named-tracking-integrations.md)
- Where the AI panel appears: [ADR 0012](decisions/0012-ai-panel-screens-v1.md)
- Renditions at upload time: [ADR 0013](decisions/0013-renditions-at-upload.md)
- Build our own Vue editor: [ADR 0014](decisions/0014-first-party-vue-editor.md)

Everything else in these docs is a draft, but 13 to 18 are the working basis for the v1 code.

## Conventions

- UK English, plain words, short sentences.
- A decision that is locked in gets an ADR in `decisions/`, numbered in order.
- Anything undecided goes in `open-questions.md` or in an "Open questions" section of the relevant doc.

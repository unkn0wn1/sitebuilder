# Docs

The design is written here first, then built. Everything in this folder is a draft and expected to change.

| Doc | What it covers |
| --- | --- |
| [00-vision.md](00-vision.md) | What we are building and why |
| [01-principles.md](01-principles.md) | The rules every decision is checked against |
| [02-architecture.md](02-architecture.md) | Components and how they fit together |
| [03-block-model.md](03-block-model.md) | The JSON page and block model |
| [04-gui.md](04-gui.md) | The builder interface (draft, open questions) |
| [05-image-pipeline.md](05-image-pipeline.md) | Uploads, resizing, srcset, crops |
| [06-setup-wizard.md](06-setup-wizard.md) | Brand, shell and menus, allowed templates |
| [07-ai-agent.md](07-ai-agent.md) | The chat agent and its guardrails |
| [08-hosting.md](08-hosting.md) | nginx, Cloudflare, publishing |
| [09-roadmap.md](09-roadmap.md) | Phases and the first pilot |
| [10-essentials.md](10-essentials.md) | CMS feature inventory with priorities and GUI placement (to discuss) |
| [open-questions.md](open-questions.md) | Decisions still to make |
| [decisions/](decisions/) | Short architecture decision records (ADRs) |

## What is locked in

Only these, each with an ADR:

- Nuxt (Vue 3, Vite, TypeScript): [ADR 0001](decisions/0001-nuxt.md)
- No Varnish, Cloudflare mandatory: [ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md)
- Static output served by nginx: [ADR 0003](decisions/0003-static-output.md)

Everything else in these docs is a draft or a sketch for discussion.

## Conventions

- UK English, plain words, short sentences.
- A decision that is locked in gets an ADR in `decisions/`, numbered in order.
- Anything undecided goes in `open-questions.md` or in an "Open questions" section of the relevant doc.

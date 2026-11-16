# sitebuilder

> Working name. The project will be renamed as it takes shape.

**Want a super fast, easy to update site? This is for you.**

An AI-assisted site builder for organisations that want a beautiful, very fast website they own, without needing a developer for every new page.

Staff describe the page they want to a chat agent. The agent asks a few questions, builds a draft only from the site's approved blocks and brand, and goes back and forth until the person is happy. A human approves it, and the site publishes as static HTML served by nginx behind Cloudflare.

## Status

**Pre-alpha, design phase.** The architecture is being written up in [`docs/`](docs/README.md) before any real code. The Nuxt app in this repo is a bare skeleton that builds, nothing more.

The repo is private for now. The intention is to open source it once the design settles. The licence is still to be decided (see [open questions](docs/open-questions.md)), so there is no LICENSE file yet.

## One thing, done well

sitebuilder does one job: build and update fast, beautiful websites. WordPress and friends try to do everything (plugins, shops, forums, memberships) and pay for it in speed, security and complexity. We deliberately do not.

Not in scope: a plugin marketplace, payments, ecommerce, memberships or user accounts for visitors, forums or comments, a built-in CRM or email marketing. Those are better done by dedicated tools and embedded where needed. See [docs/00-vision.md](docs/00-vision.md#non-goals).

## Core ideas

- **Simple as possible.** Fewest moving parts that do the job well.
- **Speed first.** Static output, tiny pages, images resized automatically, a built-in speed advisor.
- **Guardrails by design.** The AI never writes HTML or CSS. It can only assemble approved blocks inside a locked brand, and nothing goes live without human approval.
- **Own your site.** Self-hostable on one small server, with no platform lock-in.
- **No payments built in.** Donation and payment providers are embedded (for example Virtuous forms).

## Stack (locked in so far)

- [Nuxt](https://nuxt.com) (Vue 3, Vite, TypeScript)
- Tailwind CSS, with Flowbite / flowbite-vue planned for the builder UI
- Static generation, served by nginx
- Cloudflare in front (mandatory), purged on publish

## Repo layout

```
app/            Builder UI (Nuxt app): editor, preview, chat panel, wizard
server/         Nitro API: pages, versions, approvals, media, publish
shared/         Types shared by app and server (page and block model)
public/         Static assets for the builder itself
docs/           Architecture and design docs, plus decision records
```

The layout will grow (for example a block library and renderer as Nuxt layers or packages) once the docs settle. See [docs/02-architecture.md](docs/02-architecture.md).

## Getting started

Needs Node 22 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm run generate   # static output in .output/public
npm run typecheck
```

## Docs

Start at [docs/README.md](docs/README.md).

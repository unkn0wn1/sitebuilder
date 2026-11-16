# sitebuilder

> Working name. The project will be renamed as it takes shape.

**Want a super fast, easy to update site? This is for you.**

An AI-assisted site builder for organisations that want a beautiful, very fast website they own, without needing a developer for every new page.

Staff describe the page they want to a chat agent. The agent asks a few questions, builds a draft only from the site's approved blocks and brand, and goes back and forth until the person is happy. A human approves it, and the site publishes as static HTML served by nginx behind Cloudflare.

## Status

**Pre-alpha.** The v1 design is written up in [`docs/`](docs/README.md), with decisions in [`docs/decisions/`](docs/decisions/README.md). Work on milestone M1 has started with the backend: database, services and the `/api/v1` API, with unit tests. There is no editor GUI yet, no AI model calls and no real publish renderer (publishing records releases but does not write HTML yet). See the [roadmap](docs/09-roadmap.md).

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

- [Nuxt](https://nuxt.com) 4 (Vue 3, Vite, TypeScript strict), Nitro for the API
- Tailwind CSS v4 for the builder UI
- SQLite via Drizzle ORM, with a jobs table for background work ([ADR 0009](docs/decisions/0009-sqlite-drizzle-and-jobs.md))
- Zod schemas for blocks, page documents and API input, with versioned blocks ([ADR 0010](docs/decisions/0010-zod-versioned-blocks-structured-rich-text.md))
- Static HTML output, served by nginx
- Cloudflare in front (mandatory), purged by cache tag on publish ([ADR 0004](docs/decisions/0004-incremental-publish.md))

## Repo layout

```
app/              Builder UI (Nuxt app): editor, preview, chat panel, wizard (not built yet)
server/api/v1/    HTTP API, thin routes over the services (docs/14-api.md)
server/services/  Business logic: auth, pages and ops, reviews, publish, jobs, AI tools
server/db/        Drizzle schema, SQL migrations, migration runner
server/plugins/   Start-up: Access guard, database, job worker
shared/           Code shared by app and server: block registry, page model, ops, checks, roles
scripts/          Seed script
tests/            Unit tests (vitest)
docs/             Architecture and design docs, plus decision records
```

See [docs/02-architecture.md](docs/02-architecture.md).

## Getting started

Needs Node 22 or newer.

```bash
npm install
npm run seed       # creates .data/sitebuilder.db with an admin, page types and a sample page
npm run dev        # http://localhost:3000, API at /api/v1
npm test           # unit tests
npm run test:api   # builds, then runs HTTP tests against the built server
npm run check      # typecheck, unit tests and API tests
npm run typecheck
npm run build      # production server in .output
```

`npm run seed` prints a one-off admin password unless you set `SEED_ADMIN_PASSWORD` (and optionally `SEED_ADMIN_EMAIL`). Change it after signing in.

Server settings (environment variables, none are committed):

| Variable | What it does |
| --- | --- |
| `SITEBUILDER_DB_PATH` | Database file. Default `.data/sitebuilder.db`. |
| `SITEBUILDER_SECRET_KEY` | 32 random bytes, base64. Encrypts stored secrets such as the AI key. Needed before secrets can be saved. |
| `SITEBUILDER_ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain, like `https://<team>.cloudflareaccess.com`. Required in production. |
| `SITEBUILDER_ACCESS_AUD` | Cloudflare Access application audience (AUD) tag. Required in production. |
| `SITEBUILDER_MEDIA_DIR` | Where uploads and renditions are stored. Default: `media` next to the database. |
| `SITEBUILDER_MAIL_OUTBOX` | Folder where emails are written instead of sent (default `.data/outbox` outside production). SMTP sending is not built yet. |
| `SITEBUILDER_ALLOW_NO_ACCESS` | Set to `1` to run in production without Cloudflare Access (testing only). |
| `SITEBUILDER_ORIGIN` | The builder's public origin, for the CSRF check, if the proxy headers are not reliable. |
| `SITEBUILDER_WORKER` | Set to `0` to stop the in-process job worker. |
| `SITEBUILDER_INSECURE_COOKIES` | Set to `1` to allow session cookies over plain HTTP in production (local testing only). |

## Docs

Start at [docs/README.md](docs/README.md).

# Skewstone

The repository is still called `sitebuilder`.

**Want a super fast, easy to update site? This is for you.**

An AI-assisted site builder for organisations that want a beautiful, very fast website they own, without needing a developer for every new page.

Staff describe the page they want to a chat agent. The agent asks a few questions, builds a draft only from the site's approved blocks and brand, and goes back and forth until the person is happy. A human approves it, and the site publishes as static HTML served by nginx behind Cloudflare.

## Status

Skewstone includes the Nuxt builder UI, AI chat assistant with model calls (OpenAI-compatible providers and optional Sign in with xAI), static publish renderer, Cloudflare cache-tag purging, Google Workspace mail, S3/local backups, signed declarative plugin catalogue, public sandbox demo mode, VitePress documentation (`docs-site/`), and Docker Compose install. See [`docs/`](docs/README.md), decisions in [`docs/decisions/`](docs/decisions/README.md), and the [roadmap](docs/09-roadmap.md).

Open source under the [MIT licence](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), the live site at [skewstone.com](https://skewstone.com), the docs at [docs.skewstone.com](https://docs.skewstone.com), and the public demo at [demo-admin.skewstone.com](https://demo-admin.skewstone.com).

## One thing, done well

Skewstone does one job: build and update fast, beautiful websites. General-purpose CMS platforms try to do everything (third-party plugin marketplaces, shops, forums, memberships) and pay for it in speed, security and complexity. We deliberately do not.

Not in scope: an open third-party plugin marketplace, payments, ecommerce, memberships or user accounts for visitors, forums or comments, a built-in CRM or email marketing. Official plugins come from a small curated catalogue, each one signed by the Skewstone maintainers. Nothing third-party, and nothing is installed unless an admin chooses it. A plugin is declarative (a checked manifest, templates and CSS, no server code and no visitor JavaScript). New code blocks still go through review, and the agent cannot install a plugin. See [docs/00-vision.md](docs/00-vision.md#non-goals).

## Core ideas

- **Simple as possible.** Fewest moving parts that do the job well.
- **Speed first.** Static output, tiny pages, images resized automatically, a built-in speed advisor.
- **Guardrails by design.** The AI never writes HTML or JavaScript. It may draft section CSS through the same sanitiser and scope as a person, and a person must approve it. It does not write site-wide CSS. It can only assemble approved blocks inside a locked brand, and nothing goes live without human approval. It may propose a declarative plugin, which a person approves before it exists. The agent cannot install a plugin.
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
app/              Builder UI (Nuxt app): pages, editor, preview, chat panel, approvals, settings
server/api/v1/    HTTP API, thin routes over the services (docs/14-api.md)
server/services/  Business logic: auth, pages and ops, reviews, publish, jobs, AI tools, plugins
server/db/        Drizzle schema, SQL migrations, migration runner
server/plugins/   Start-up: Access guard, database, job worker
shared/           Code shared by app and server: block registry, page model, ops, checks, roles
plugins/          Official declarative plugin manifests and assets
site/             Marketing site for skewstone.com
docs-site/        VitePress documentation site for docs.skewstone.com
scripts/          Seed, install, plugin signing, demo golden/sweep, and restore scripts
deploy/           Docker Compose install, nginx origin config
spikes/           Phase 1 prototypes (sample render, editor base). Not the production app
tests/            Unit, HTTP API, and Playwright end-to-end tests
docs/             Architecture and design docs, plus decision records
```

See [docs/02-architecture.md](docs/02-architecture.md).

## Getting started

Needs Node 22 or newer.

Production installs use Docker Compose (see [`deploy/install.sh`](deploy/install.sh) and [operations](docs/16-operations.md#install)).

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
| `SITEBUILDER_SITE_ROOT` | Where `releases/` and the `current` symlink live. Default: next to the database. |
| `SITEBUILDER_CLOUDFLARE_ZONE_ID` | Cloudflare zone id, used to purge the public site by cache tag. |
| `SITEBUILDER_CLOUDFLARE_TOKEN` | Optional. Cloudflare API token, if not stored as the `cloudflare_token` secret. |
| `SITEBUILDER_MAIL_OUTBOX` | Folder where emails are written instead of sent. Always used when set (tests and local debugging). The default in development, if Google Workspace is not connected, is `.data/outbox`. |
| `SITEBUILDER_GOOGLE_OAUTH_CLIENT_ID` | Optional. Google OAuth client id, if not stored in Settings. |
| `SITEBUILDER_GOOGLE_OAUTH_CLIENT_SECRET` | Optional. Google OAuth client secret, if not stored in Settings. |
| `SITEBUILDER_ALLOW_NO_ACCESS` | Set to `1` to run in production without Cloudflare Access (testing only). |
| `SITEBUILDER_ORIGIN` | The builder's public origin, for the CSRF check, if the proxy headers are not reliable. |
| `SITEBUILDER_WORKER` | Set to `0` to stop the in-process job worker. |
| `SITEBUILDER_INSECURE_COOKIES` | Set to `1` to allow session cookies over plain HTTP in production (local testing only). |
| `SITEBUILDER_BACKUP_DIR` | Local folder for backup archives (tests and a last-resort dev path). |
| `SITEBUILDER_BACKUP_S3_ENDPOINT` | S3-compatible endpoint for off-site backups (R2, B2, AWS S3). |
| `SITEBUILDER_BACKUP_S3_BUCKET` | Backup bucket. |
| `SITEBUILDER_BACKUP_S3_REGION` | Backup region (use `auto` for R2). |
| `SITEBUILDER_BACKUP_S3_ACCESS_KEY_ID` | Backup access key. |
| `SITEBUILDER_BACKUP_S3_SECRET_ACCESS_KEY` | Backup secret key. |
| `SITEBUILDER_BACKUP_S3_PREFIX` | Optional key prefix inside the bucket. |
| `SITEBUILDER_ENABLE_XAI_OAUTH` | Set to `1` to offer Sign in with xAI in Settings > AI. Off by default. See [ADR 0016](docs/decisions/0016-xai-oauth.md). |
| `SITEBUILDER_XAI_OAUTH_CLIENT_ID` | Optional. OAuth client id for Sign in with xAI. If unset, the public Grok CLI / Hermes client is used (not a Skewstone-registered app). |

## Sign in with xAI (optional)

Off unless `SITEBUILDER_ENABLE_XAI_OAUTH=1`. When the flag is on, Settings > AI offers **Sign in with xAI** next to the API key field. The builder starts a device-code login, shows a short code and a verification link, and polls until you approve it in the browser (or cancel). Refresh tokens are stored encrypted with `SITEBUILDER_SECRET_KEY` and are refreshed automatically. Cost caps still apply. If xAI refuses your subscription tier, paste an API key instead.

xAI does not currently offer a public way to register our own OAuth client. The default client id is the public one used by Grok CLI and Hermes Agent; set `SITEBUILDER_XAI_OAUTH_CLIENT_ID` if you have your own. Details: [ADR 0016](docs/decisions/0016-xai-oauth.md).

## Docs

Start at [docs/README.md](docs/README.md).

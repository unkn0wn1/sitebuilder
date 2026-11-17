# Roadmap

Draft. Timings are rough guesses for one developer with AI help, not commitments. The v1 design decisions are in [decisions/](decisions/) (ADRs 0004 to 0015).

## Phase 0: Design (done for v1)

- Architecture, data model, API, security, operations, testing and GUI written up in `docs/`.
- v1 decisions recorded as ADRs. Remaining questions in [open-questions.md](open-questions.md).
- Repo skeleton that builds.

## Phase 1: Backend foundation and spike (2 to 3 weeks)

**Milestone M1: content API works end to end without a GUI.**

- Database schema and migrations (SQLite, Drizzle, `site_id` everywhere) ([13-data-model.md](13-data-model.md)).
- Users, roles, sessions, sign-in ([15-security.md](15-security.md)).
- Block registry with versions and migrations, structured rich text, starter block schemas.
- Pages with operations, autosave coalescing, conflicts, undo, versions, restore.
- Reviews pinned to versions, self-approval rules, audit log.
- Job table and worker.
- Task-scoped AI tool permission check, and the page builder tools as server functions (no model calls yet).
- API routes from [14-api.md](14-api.md) with tests. Seed script.
- **Spike:** render one sample page with a compiled render bundle and Vue's server renderer, serve it from nginx behind Cloudflare, measure against the budgets ([17-testing-and-budgets.md](17-testing-and-budgets.md)). Test a Virtuous embed and a near full-screen video hero.
- **Spike:** decide whether to build our own Vue editor or start from an existing one.

Progress (17 November 2026): M1 is complete for the backend, the remaining AI tools, and both spikes. The content API, schema, auth, pages, site parts, reviews, settings, media, jobs, Access checks and AI tool permissions (including create draft, crop proposal, upload request and a schematic preview screenshot) are in, with unit tests and HTTP-level API tests. Real model calls (bring-your-own OpenAI-compatible provider, encrypted key, cost caps, bound sessions, Assistant tab with streaming) are in; tests use a mock provider. The [sample-page render spike](spikes/001-render-sample.md) met the performance budgets on a Vue server-rendered page with a video hero and a Virtuous-style embed island. The [editor-base spike](spikes/002-editor-base.md) led to [ADR 0014](decisions/0014-first-party-vue-editor.md): we will build our own Vue editor. Google Workspace mail (ADR 0015) is in for milestone 2. The publish renderer is also in: Vue server-renders only the changed pages, inlines the default theme CSS, writes Cache-Tag and per-page CSP maps, and purges Cloudflare by tag. Docker Compose is the supported install, and nightly encrypted backups (with a restore command) are in. The GUI editor and real model calls are in. Settings > AI and wiring photo Change/crop in the inspector to the media library are still to come.

## Phase 2: Publishing and media (3 to 4 weeks)

**Milestone M2: an approved page is live in seconds, and can be rolled back.**

- Render bundle compile step and incremental renderer with the dependency map ([ADR 0004](decisions/0004-incremental-publish.md)).
- Releases with manifests, symlink switch, site rollback ([ADR 0005](decisions/0005-rollback-and-approval.md)).
- Cloudflare purge by cache tag, redirects map, sitemap.xml, robots.txt, per-page CSP.
- Image pipeline: uploads, sharp renditions as jobs, crops, alt text ([ADR 0013](decisions/0013-renditions-at-upload.md)).
- Email through Google Workspace and the Gmail API, behind a mail-transport interface ([ADR 0015](decisions/0015-gmail-workspace-mail.md)). SMTP or Postmark can be added later.
- Docker Compose install and backup and restore.

## Phase 3: Editor and approvals (4 to 6 weeks)

**Milestone M3: Asha can make and edit a page by hand, and Spencer can approve it on his phone.**

- Builder shell, Pages list, editor layout ([ADR 0008](decisions/0008-editor-shape.md)), inline text, inspector, device switch, autosave, undo, history.
- Submit panel with checks, review screen with changes view and comments, publish progress.
- Site parts (header, footer, menus), Media, Forms and embeds.
- Setup wizard, Settings.
- Mobile mode for approving and quick text fixes.
- Speed advisor on preview.

## Phase 4: The assistant (3 to 4 weeks)

**Milestone M4: a new donation page from a conversation, approved and live.**

- Model adapter (OpenAI-compatible, Grok default), agent loop with limits and cancel, streaming to the panel.
- Context building, memory, agent profile, usage and caps.
- Screenshot self-check and checks tool.
- Template and Brand and design tasks for admins.
- AI evals in CI.

## Phase 5: First pilot, a demo site (about 4 weeks)

The first pilot is a demo of a charity website (Animal Aid Unlimited), built to show what the approach can do:

- **Two or three alternative designs** of the whole site, built from the same content with different themes (see [11-theming.md](11-theming.md)), so people can compare and pick a favourite.
- Real content (stories, photos, video) from the charity's existing material.
- A near full-screen **video hero** on the home page, compressed hard and with a poster fallback, without hurting the speed scores.
- Embedded donation forms (Virtuous).
- A live demo of a member of staff asking the assistant for a new donation page and approving it.

## Phase 6: Open-source release

- Licence decision, contribution guide, docs site, public demo.
- Multilingual support (the data model is locale-aware from the start).
- Hardened install script and upgrade guide.

## Later

- Crop wizard for per-breakpoint art direction.
- Video transcoding in the pipeline.
- Scheduled publishing, reusable sections, A/B tests, multi-site.
- Reference URL design feature.
- In-app TOTP, magic links, SSO without Cloudflare Access.
- Optional connectors (CRMs, donation platforms) where they help.

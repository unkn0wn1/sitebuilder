# Open questions

Decisions still to make. v1 decisions made on 17 Nov 2026 are recorded as ADRs 0004 to 0013 in [decisions/](decisions/). Each doc also has its own "Open questions" section.

## Still open

1. **Licence:** MIT everywhere, or AGPL for the builder app (with MIT for the block library and renderer)? To decide before the first public release. Also: font and starter image licences must allow redistribution.
2. **Name:** working name "sitebuilder". The repo stays private under unkn0wn1 for now.
3. **Pilot coexistence:** does the pilot site need to run alongside the existing WordPress site (some pages on a subpath or subdomain), or is a full switch the goal? Affects redirects and import.
4. **AI costs:** who pays model costs during the pilot, and the default monthly cap.
5. **Languages:** which languages beyond English for the pilot, and when? Also whether the builder UI itself needs translating for staff.
6. **Editor base:** build our own Vue editor, or start from an existing one (for example Gissen or Page Composer)? Settled in the Phase 1 spike.
7. **Spike scope:** is Puck's paid AI layer acceptable for a quick comparison, or should the spike stay fully open source?
8. **Developer reviewer** for code changes to a site's `site/` layer (reference URL feature, custom blocks): project maintainers, a hosting partner, or the organisation's own technical admin?
9. **Must list length:** is the v1 must list in [10-essentials.md](10-essentials.md) still too long?
10. **News or posts** in v1, or soon after?

## Answered

- **TLS and CDN:** Cloudflare in front is mandatory, no Varnish ([ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md)).
- **Where the repo lives:** private repo under unkn0wn1.
- **AI provider default:** Grok for the pilot, any OpenAI-compatible provider by config ([12-ai-harness.md](12-ai-harness.md#bring-your-own-model)).
- **Publishing approach:** compile once, render changed pages ([ADR 0004](decisions/0004-incremental-publish.md)).
- **Rollback and self-approval** ([ADR 0005](decisions/0005-rollback-and-approval.md)).
- **Custom code and upgrades:** `site/` layer ([ADR 0006](decisions/0006-site-layer.md)).
- **Single or multi-site, install method, Cloudflare Access, operator role** ([ADR 0007](decisions/0007-single-site-install.md)).
- **GUI shape, inline editing, flat sections, mobile scope** ([ADR 0008](decisions/0008-editor-shape.md)).
- **SQLite or Postgres, background jobs** ([ADR 0009](decisions/0009-sqlite-drizzle-and-jobs.md)).
- **Schema library, rich text format, block versioning** ([ADR 0010](decisions/0010-zod-versioned-blocks-structured-rich-text.md)).
- **Tracking slot** ([ADR 0011](decisions/0011-named-tracking-integrations.md)).
- **AI panel for approvers on Site parts:** no; Site parts have no AI panel ([ADR 0012](decisions/0012-ai-panel-screens-v1.md)).
- **Renditions at upload or generate time:** upload time ([ADR 0013](decisions/0013-renditions-at-upload.md)).
- **Streaming UI for the assistant:** tool calls applied live, progress streamed ([04-gui.md](04-gui.md#assistant-states)).
- **Cloudflare purge by tag on cheaper plans:** available on all plans since April 2025 ([08-hosting.md](08-hosting.md#cloudflare-purge-plans-and-limits)).

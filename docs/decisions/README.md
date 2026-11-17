# Decision records

Short records of decisions that are locked in. Each has a status, the context, the decision and the consequences. To change one, add a new record that supersedes it.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-nuxt.md) | Nuxt as the framework | Accepted |
| [0002](0002-no-varnish-cloudflare-mandatory.md) | No Varnish, Cloudflare mandatory | Accepted |
| [0003](0003-static-output.md) | Static output served by nginx | Accepted |
| [0004](0004-incremental-publish.md) | Compile once, render only changed pages on publish | Accepted |
| [0005](0005-rollback-and-approval.md) | Rollback follows releases, and approval rules for small teams | Accepted |
| [0006](0006-site-layer.md) | Custom code lives in a `site/` layer, outside core | Accepted |
| [0007](0007-single-site-install.md) | One site per install, operator role, Cloudflare Access in front of the builder | Accepted |
| [0008](0008-editor-shape.md) | Editor shape for v1 | Accepted |
| [0009](0009-sqlite-drizzle-and-jobs.md) | SQLite with Drizzle, and a job table instead of a queue service | Accepted |
| [0010](0010-zod-versioned-blocks-structured-rich-text.md) | Zod block schemas with versions, and structured rich text | Accepted |
| [0011](0011-named-tracking-integrations.md) | Tracking through named integrations, not a raw script slot | Accepted |
| [0012](0012-ai-panel-screens-v1.md) | Where the AI panel appears in v1 | Accepted |
| [0013](0013-renditions-at-upload.md) | Image renditions are made at upload time with sharp | Accepted |
| [0014](0014-first-party-vue-editor.md) | Build our own Vue editor, do not depend on Gissen or Page Composer in v1 | Accepted |
| [0015](0015-gmail-workspace-mail.md) | Send mail through Google Workspace and the Gmail API | Accepted |
| [0016](0016-xai-oauth.md) | Optional Sign in with xAI (device code, off by default) | Accepted |

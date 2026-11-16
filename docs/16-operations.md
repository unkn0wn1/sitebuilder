# Operations

**Draft, v1 baseline.** How the builder is installed, kept running, backed up and upgraded. Hosting and publishing are in [08-hosting.md](08-hosting.md).

## Install

- **Supported path: Docker Compose** on one small VPS ([ADR 0007](decisions/0007-single-site-install.md)):
  - `builder`: the Nuxt app (GUI, API) and the job worker,
  - `nginx`: serves `current/` and media to Cloudflare,
  - volumes: `data/` (SQLite database), `media/` (originals and renditions), `releases/` (release folders and the `current` symlink),
  - an environment file with `SITEBUILDER_SECRET_KEY`, the builder origin, the Cloudflare Access audience tag and SMTP host settings.
- An install script creates the environment file and secret key, checks the Cloudflare setup (zone, token, Access, origin lock), and starts the containers.
- A plain systemd install is documented for people who prefer it, but is not the tested path.

## Background jobs

From [ADR 0009](decisions/0009-sqlite-drizzle-and-jobs.md):

- A `jobs` table and one worker loop inside the builder process. It polls every second, claims the oldest due job by setting a lease (`lease_until`), runs it, and records `done` or the error.
- **Retries** with backoff (30 seconds, 2 minutes, 10 minutes), up to the job's maximum attempts. A job whose lease runs out (for example after a crash) is claimed again.
- **Concurrency:** `publish`, `render_preview` and `run_checks` share one lane with concurrency 1. `media_renditions` has its own lane with concurrency 1. Light jobs (`send_email`, `purge_cache`) run in a third lane.
- **Headless Chromium** (for checks and AI screenshots) runs inside the builder container, one instance at a time. The server should have at least 2 GB of RAM; 4 GB is comfortable.
- The GUI follows a job through `GET /api/v1/jobs/:id` (publish progress, upload processing).

## Email

Outbound email is needed for invites, password resets and approvals, so it is part of v1.

- **SMTP** settings in Settings > Integrations and in the setup wizard: host, port, user, password (stored as a secret), from address. Any provider works (for example Postmark, Amazon SES, Mailgun, or the organisation's Google Workspace relay).
- Emails are sent through `send_email` jobs, so a slow mail server never blocks a request, and failures retry.
- v1 emails:

| Email | To | Priority |
| --- | --- | --- |
| Invite | New user | must |
| Password reset | User | must |
| Review requested | All approvers (except the submitter) | must |
| Sent back, with the comment | Submitter | must |
| Published | Submitter | must |
| Publish failed | Approver who approved, admins | must |
| Emergency rollback done | Approvers and admins | must |
| Backup failed, disk nearly full | Operators | must |

- Users can turn off the non-security emails in their notification settings. In-app notifications always happen.
- Plain, short, in the organisation's name, with one button linking into the builder. No tracking pixels.

## Backups and restore

- **What:** the SQLite database (taken with SQLite's online backup API, safe while running), `media/originals`, and the site configuration. Renditions and releases are not backed up; they are rebuilt.
- **The secret key is not in the backup.** It is backed up once, separately, at install (the installer prints instructions). See [15-security.md](15-security.md#secrets).
- **When:** nightly as a `backup` job, kept 14 nightly and 8 weekly copies.
- **Where:** off-site, to any S3-compatible bucket (for example Cloudflare R2 or Backblaze B2). Encrypted before upload.
- **Restore:** a documented command that downloads a backup, restores the database and originals, regenerates renditions, recompiles the render bundle and re-renders the whole site. Tested in CI on every release, and the docs ask operators to do a test restore twice a year.
- **Export** (Settings > Backups, for "own your site"): one archive with all content as JSON (pages, versions, site parts, templates, brand, media metadata) plus media originals. The export format has its own version number and is documented.

## Monitoring

- `GET /api/v1/health` for uptime checks (any external monitor).
- Settings > System (operators): builder version, disk space, database size, job queue, last publish, last backup, Cloudflare token check.
- Alerts by email to operators: backup failed, disk over 85 per cent, a job failed after all retries, Cloudflare token rejected.
- Structured JSON logs to stdout (Docker collects them). Errors carry a reference id that is also shown to the user.

## Upgrades

- Releases follow semantic versioning. Release notes say what changed in the block API ([ADR 0006](decisions/0006-site-layer.md)).
- Upgrade: take a backup, pull the new image, start it. On start the builder runs database migrations, migrates section documents forward where a section type changed, recompiles the render bundle with the site layer, and re-renders the whole site as a release (which can be rolled back).
- If a migration fails, the builder does not start and the previous image can be run again against the backup.

## When the AI provider is down

The builder must be fully usable without the AI.

- If the provider times out, errors, or the key is rejected, the current AI turn stops cleanly: changes already made stay in the draft (each tool call is its own valid operation), and the panel says what happened.
- The panel then shows "The assistant isn't available right now. Everything else works as normal." with a retry button. Editing, preview, review and publish are unaffected.
- After 3 failures in 5 minutes the builder stops trying for 2 minutes (a simple circuit breaker) to avoid long waits.
- When a monthly cost cap is reached, the panel says so and the rest of the builder carries on.

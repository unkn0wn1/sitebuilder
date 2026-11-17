# Operations

**Draft, v1 baseline.** How the builder is installed, kept running, backed up and upgraded. Hosting and publishing are in [08-hosting.md](08-hosting.md).

## Install

- **Supported path: Docker Compose** on one small VPS ([ADR 0007](decisions/0007-single-site-install.md)):
  - `builder`: the Nuxt app (GUI, API) and the job worker,
  - `nginx`: serves `current/` and media to Cloudflare,
  - volumes: `data/` (SQLite database), `media/` (originals and renditions), `releases/` (release folders and the `current` symlink),
  - an environment file with `SITEBUILDER_SECRET_KEY`, the builder origin and the Cloudflare Access audience tag. Google Workspace mail is connected in the setup wizard or Settings, not with SMTP host settings.
- An install script (`deploy/install.sh --dir /srv/sitebuilder`) creates the data, media and site folders, writes an environment file and a secret key, then prints the `docker compose` command to build and start the containers. Fill in the Cloudflare Access audience and zone id in `.env` before starting. The public hostname and the builder hostname share the nginx container; Access should be enabled only on the builder hostname.
- Back up `SITEBUILDER_SECRET_KEY` separately, at install. It is not included in site backups.
- A plain systemd install is documented in `deploy/systemd.md` for people who prefer it, but is not the tested path.


## Background jobs

From [ADR 0009](decisions/0009-sqlite-drizzle-and-jobs.md):

- A `jobs` table and one worker loop inside the builder process. It polls every second, claims the oldest due job by setting a lease (`lease_until`), runs it, and records `done` or the error.
- **Retries** with backoff (30 seconds, 2 minutes, 10 minutes), up to the job's maximum attempts. A job whose lease runs out (for example after a crash) is claimed again.
- **Concurrency:** `publish`, `render_preview` and `run_checks` share one lane with concurrency 1. `media_renditions` has its own lane with concurrency 1. Light jobs (`send_email`, `purge_cache`) run in a third lane.
- **Publish:** the worker renders only the changed pages into a new release folder (hard-link copy of the previous one), switches the `current` symlink, and enqueues a `purge_cache` job. Purge is by Cloudflare cache tag and is skipped until `SITEBUILDER_CLOUDFLARE_ZONE_ID` and a Cloudflare API token (`cloudflare_token` secret or `SITEBUILDER_CLOUDFLARE_TOKEN`) are set. Release folders live under `SITEBUILDER_SITE_ROOT` (default: next to the database).
- **Headless Chromium** (for checks and AI screenshots) runs inside the builder container, one instance at a time. The server should have at least 2 GB of RAM; 4 GB is comfortable.
- The GUI follows a job through `GET /api/v1/jobs/:id` (publish progress, upload processing).

## Email

Outbound email is needed for invites, password resets and approvals, so it is part of v1. The transport is decided in [ADR 0015](decisions/0015-gmail-workspace-mail.md).

- **v1: Google Workspace**, through the Gmail API. In the setup wizard or Settings > Integrations, add a Google OAuth client (id and secret) and connect a Workspace account such as `noreply@`. No app passwords, and no SMTP settings in v1. SMTP or Postmark can be added later behind the same mail-transport interface.
- The OAuth client needs the Gmail API enabled and this redirect URI: `{builder origin}/api/v1/settings/mail/google/callback`. The scopes are send-only, plus reading the account's email so Settings can show who is connected. Refresh and access tokens are stored encrypted at rest and are never shown again.
- The from address defaults to the connected account and can be set in Settings (it must be a send-as address Google will accept).
- Settings has a **test-send**, so the operator can confirm mail works before inviting anyone.
- Emails (except the test-send) are sent through `send_email` jobs, so a slow Gmail call never blocks a request, and failures retry. If the connection expires, reconnect it in Settings.
- In development, messages are written to a file outbox unless a Workspace account is connected. `SITEBUILDER_MAIL_OUTBOX` always forces the outbox, including in tests.
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
- **Restore:** stop the builder, then `npx tsx scripts/restore.ts --file path.sbk` (or `--name` to fetch from the configured store). The command restores the database and originals, remakes image renditions, and re-renders the whole site into a new release. Operators should do a test restore twice a year. The secret key must already be in the environment.
- **On demand:** an operator or admin can start a backup with `POST /api/v1/backups`. `GET /api/v1/backups` lists recent jobs and stored archives.
- **Export** (Settings > Backups, for "own your site"): still to come. The backup archive is already enough to restore this install; a portable JSON export will follow.

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

# 0007: One site per install, operator role, Cloudflare Access in front of the builder

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Multi-site, how the software is installed, who runs it, and how the builder login is protected were all open. A hosting partner (for example Castlegate) may run the server for an organisation without doing its content.

## Decision

- **One site per install in v1.** Every table still has a `site_id` column from day one, so multi-site later is a feature, not a rewrite. In v1 there is exactly one row in `sites`.
- **Install with Docker Compose:** a builder container (Nuxt and Nitro, which also runs the job worker) and an nginx container, sharing volumes for releases, media and the database. A plain systemd install is documented too, but Compose is the supported path.
- **Roles:** Editor, Approver, Admin, plus **Operator**. The operator manages System (health, upgrades, backups, logs, integrations) and cannot edit or publish content. An admin can do everything except operator-only server tasks. One person can hold both.
- **Cloudflare Access is required in front of the builder** hostname in production. It is free for small teams and adds a second factor (email code or Google or Microsoft sign-in) before anyone reaches the builder login. The builder refuses to start in production mode unless an Access audience tag is configured or an explicit `SITEBUILDER_ALLOW_NO_ACCESS=1` override is set (for development and unusual installs).
- The builder still has its **own login** (email and password, scrypt hashed) as a second layer. TOTP inside the app is later.

## Consequences

- Simple to install and back up: one server, two containers, three volumes.
- The schema is ready for multi-site.
- A hosting partner can be given exactly the access they need.
- Cloudflare Access becomes part of setup, alongside the Cloudflare zone already required by ADR 0002.

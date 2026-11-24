# 0020 addendum: the public demo was built as sandboxes

- **Status:** Accepted
- **Date:** 2026-11-24
- **Amends:** the “Not in v1” paragraph of ADR 0020. That record lives on the plugins branch and is not copied here.

## Context

ADR 0020 left a public admin demo unbuilt. It asked for a reset that does not wipe another visitor, preferred a per-visitor sandbox, and kept an hourly restore as the backstop. It also locked mail, AI calls that spend a key, and the agent gateway.

## Decision

Built on 2026-11-24, sandbox first:

- Each visitor gets a file copy of the golden database, media, and published site. The demo does not start a Node process per visitor.
- Reset restores only the caller’s copy. The sign-in is shared and public: `demo@skewstone.com` / `skewstone-demo`. That password is published on purpose and is not a secret.
- An hourly sweep is the backstop for copies nobody reset. A live builder closes the files and then deletes them. A stale builder is cleaned by the sweep itself.
- Locks on that install: plugin installs, user changes, backups, secrets, mail, AI calls and AI settings, the agent gateway, the public hostname, and indexing.

## Consequences

Marketing, docs, and the plugins host are not in demo mode. Every other production builder still requires Cloudflare Access, as amended in [ADR 0007](0007-single-site-install.md).

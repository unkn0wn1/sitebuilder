# 0002: No Varnish, Cloudflare mandatory

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The research suggested nginx plus Varnish as a self-host reference stack, with a CDN optional. Published sites are static files. Visitors are often spread across several countries.

## Decision

- **Do not use Varnish.** nginx serves the static files directly.
- **Cloudflare in front of every site is mandatory.** Publishing purges the changed URLs through the Cloudflare API.

## Consequences

- One less service to install, configure, secure and purge. Varnish would also need a separate TLS terminator.
- Static files from nginx are already very fast, and Cloudflare caches at the edge close to visitors, so Varnish would add complexity for minimal gain.
- Free TLS, DDoS protection and edge caching for every site.
- One supported hosting setup to document and test.
- Sites that cannot use Cloudflare are not supported at first. Other CDNs could be added later as purge adapters.
- If dynamic pages are ever added, Varnish can be reconsidered in a new ADR.

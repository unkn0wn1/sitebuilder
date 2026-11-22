# Hosting

Draft. The public site should be boringly simple to host.

## Reference stack

```
Visitor -> Cloudflare (mandatory) -> nginx -> static files on disk
```

- **nginx** serves the generated HTML, CSS, JS and media from disk, with Brotli or gzip, HTTP/2 or HTTP/3, and long cache headers on hashed assets.
- **Cloudflare** sits in front of every site. It caches at the edge close to visitors, handles TLS at the edge, and absorbs attacks. It is not optional.
- **No Varnish.** See below.

The builder (Nuxt app, Nitro API and job worker) runs on the same server as nginx, in its own container, behind its own hostname and login, with **Cloudflare Access required** in front ([ADR 0007](decisions/0007-single-site-install.md)). Install is by Docker Compose ([16-operations.md](16-operations.md#install)).

**Only Cloudflare can reach the origin:** the web ports are firewalled to Cloudflare's IP ranges and nginx requires Authenticated Origin Pulls. See [15-security.md](15-security.md#the-origin-server).

## Why Cloudflare is mandatory

- Visitors are often spread across countries. One origin server alone means slow pages for distant visitors.
- Edge caching makes a small, cheap origin server plenty.
- Free TLS, DDoS protection and bot filtering for organisations that cannot afford an incident.
- A good API for targeted cache purge.

Making it mandatory also keeps the project simple: one supported setup to document and test, not a matrix of CDNs. Other CDNs could be added later as purge adapters if people ask.

## Why no Varnish

Varnish is great for caching dynamic pages in front of an app server. Here the origin is already static files on nginx, which are served from the OS page cache at very high speed, and Cloudflare caches at the edge on top. Varnish would add another service to run, configure, secure and purge, and its own TLS story, for very little gain. See [ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md).

## Publishing

From [ADR 0004](decisions/0004-incremental-publish.md) and [ADR 0005](decisions/0005-rollback-and-approval.md):

1. Approver clicks **Approve and publish**. A `publish` job is queued (one at a time).
2. The renderer works out which pages are affected (the approved page, plus any page whose dependencies changed; every page for header, footer, menu or theme changes) and renders them with the compiled render bundle.
3. A new release folder is made as a hard-link copy of the previous one, the changed pages are written into it, and sitemap.xml, `redirects.map` and the search index (if enabled) are regenerated. The release manifest records every version it contains.
4. The `current` symlink is switched to the new release in one step, and the database "published" pointers are updated to match.
5. Cloudflare is purged **by cache tag**: each HTML page is served with `Cache-Tag: page-<id>`, and every page also carries `shell`. A page publish purges its own tag (plus the tags of pages that list it); a header, footer, menu or theme change purges `shell`.
6. The last 10 releases are kept on disk for instant rollback. Media lives in a shared folder outside the releases.

```
/srv/sitebuilder/
  releases/
    2026-11-16T10-00-00Z/
    2026-11-16T11-30-00Z/
  current -> releases/2026-11-16T11-30-00Z
  media/      (shared, append-only, served at /media/)
  data/       (SQLite database)
```

### Cloudflare purge: plans and limits

Verified on 17 Nov 2026 against Cloudflare's docs: since **April 2025, every purge method (by URL, tag, prefix, hostname, and purge everything) is available on all plans, including Free** ([changelog](https://developers.cloudflare.com/changelog/post/2025-04-01-purge-for-all/), [purge docs](https://developers.cloudflare.com/cache/how-to/purge-cache/)). Earlier docs here assumed tags and prefixes needed certain plans; that is no longer true.

Rate limits still differ by plan. For tag, prefix, hostname and purge everything, the Free plan allows 5 requests a minute (bucket of 25) with up to 100 tags or prefixes per request; Pro allows 5 a second. A normal publish uses one or two requests, so Free is enough for a typical charity. The purge job batches tags and retries on a rate-limit reply.

### Site rollback

An admin can switch `current` back to any kept release. The database pointers are reset to that release's manifest in the same step, Cloudflare is purged with `shell`, and the action is logged and emailed ([ADR 0005](decisions/0005-rollback-and-approval.md)).

## Cache headers (starting point)

- HTML: short browser cache, long edge cache, purge on publish (for example `Cache-Control: public, max-age=0, s-maxage=86400`), plus the `Cache-Tag` header. Cloudflare holds it and the purge keeps it fresh.
- HTML error responses (404 and 410) are `Cache-Control: no-store`. They are not cached at the edge, so a missing address that is published later is not stuck behind an old 404.
- The builder writes `cache-tags.map` and `csp.map` into each release so nginx can send those headers (see `deploy/nginx.conf`). Theme CSS is inlined in the HTML, following the sample-page spike.
- Hashed assets and media renditions: `public, max-age=31536000, immutable`.

## Server

One small VPS (for example OVH or Hetzner) is enough for most organisations: nginx, the builder, SQLite and media on local disk, automatic security updates, monitoring and off-site backups (database plus media originals). 2 vCPU and 4 GB of RAM is comfortable, because the speed checks run headless Chromium. Anyone running it can hand this to a hosting partner as a simple ops contract, using the Operator role ([ADR 0007](decisions/0007-single-site-install.md), [16-operations.md](16-operations.md)).

## Decided

- Purge by cache tag (available on all plans since April 2025).
- Docker Compose with an install script ([ADR 0007](decisions/0007-single-site-install.md)).
- Builder on the same server, separate container.
- Cloudflare Access in front of the builder is required in production.

## Open questions

- Redirects: nginx map only in v1. Mirror them as Cloudflare rules later if needed.

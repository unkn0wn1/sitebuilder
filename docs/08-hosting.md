# Hosting

Draft. The public site should be boringly simple to host.

## Reference stack

```
Visitor -> Cloudflare (mandatory) -> nginx -> static files on disk
```

- **nginx** serves the generated HTML, CSS, JS and media from disk, with Brotli or gzip, HTTP/2 or HTTP/3, and long cache headers on hashed assets.
- **Cloudflare** sits in front of every site. It caches at the edge close to visitors, handles TLS at the edge, and absorbs attacks. It is not optional.
- **No Varnish.** See below.

The builder (Nuxt app and Nitro API) can run on the same server as nginx for small sites, behind its own hostname and login, ideally restricted further (for example Cloudflare Access).

## Why Cloudflare is mandatory

- Visitors are often spread across countries. One origin server alone means slow pages for distant visitors.
- Edge caching makes a small, cheap origin server plenty.
- Free TLS, DDoS protection and bot filtering for organisations that cannot afford an incident.
- A good API for targeted cache purge.

Making it mandatory also keeps the project simple: one supported setup to document and test, not a matrix of CDNs. Other CDNs could be added later as purge adapters if people ask.

## Why no Varnish

Varnish is great for caching dynamic pages in front of an app server. Here the origin is already static files on nginx, which are served from the OS page cache at very high speed, and Cloudflare caches at the edge on top. Varnish would add another service to run, configure, secure and purge, and its own TLS story, for very little gain. See [ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md).

## Publishing

1. Approver clicks **Approve and publish**.
2. The generator renders the changed pages (or the whole site, if the shell or menus changed) into a new release folder.
3. The `current` symlink is switched to the new release in one step. nginx serves from `current`.
4. The API calls the Cloudflare purge API for the changed URLs. For shell or menu changes, it purges everything (or by cache tag or prefix, where the plan supports it).
5. Old releases are kept for quick rollback (for example the last 10).

```
/var/www/site/
  releases/
    2026-11-16T10-00-00/
    2026-11-16T11-30-00/
  current -> releases/2026-11-16T11-30-00
```

## Cache headers (starting point)

- HTML: short edge cache with purge on publish (for example `Cache-Control: public, max-age=0, s-maxage=86400`), so Cloudflare holds it and the purge keeps it fresh.
- Hashed assets and media renditions: `public, max-age=31536000, immutable`.

## Server

One small VPS (for example OVH or Hetzner) is enough for most organisations: nginx, the builder, SQLite and media on local disk, automatic security updates, monitoring and off-site backups (database plus media). Anyone running it can hand this to a hosting partner as a simple ops contract.

## Open questions

- Is Cloudflare purge by URL enough, or do we rely on cache tags or prefixes (which need certain plans)?
- Should we provide a ready-made install script or Docker Compose file for the server?
- Builder on the same server as the public site, or separate by default?
- Cloudflare Access in front of the builder: recommended or required?

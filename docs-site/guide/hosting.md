---
title: Hosting and install
---

# Hosting and install

One install runs one site. Production is a builder process (the API, the editor, and the job worker) and nginx for the published files. Docker Compose is the supported install. See `deploy/` in the repository.

Cloudflare is required in front of the public site. The builder hostname is behind Cloudflare Access, except the public demo described below.

The Skewstone public hosts, when you use the bundle in `deploy/skewstone/`, are:

| Host | What it serves |
| --- | --- |
| `skewstone.com` | Marketing page |
| `docs.skewstone.com` | These docs |
| `plugins.skewstone.com` | Plugin package files |
| `demo.skewstone.com` | The published demo site |
| `demo-admin.skewstone.com` | The demo builder |

`www.skewstone.com` redirects to `https://skewstone.com`. The same files also answer on the preview ports in that bundle, so a private host header still works.

The public demo is the builder with demo mode on. Each visitor gets a separate copy of the database, media, and published files. Marketing, docs, and the plugin files are ordinary static sites and do not run that process.

Backups, restores, and the Access setup for a normal install are in `docs/16-operations.md` in the repository.

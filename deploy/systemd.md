# systemd install (not the tested path)

Docker Compose is the supported install ([ADR 0007](../docs/decisions/0007-single-site-install.md)). This note is for people who prefer to run the builder and nginx as host services.

1. Install Node 22, nginx, and (for production) unattended-upgrades.
2. Create a `sitebuilder` user and `/srv/sitebuilder/{data,media,site}`.
3. Build the app (`npm ci && npm run build`) and copy `.output` plus production `node_modules` to `/srv/sitebuilder/app`.
4. Put the environment file at `/srv/sitebuilder/.env` (see `env.example`). The same `SITEBUILDER_DB_PATH`, `SITEBUILDER_MEDIA_DIR` and `SITEBUILDER_SITE_ROOT` layout as Compose is recommended.
5. Run `node .output/server/index.mjs` under systemd (`Restart=always`, `User=sitebuilder`, `EnvironmentFile=/srv/sitebuilder/.env`).
6. Point nginx at `deploy/nginx.conf.template` (substitute the hostnames), with the same `current` reload watcher as `nginx-entrypoint.sh`.
7. Put Cloudflare in front, with Access on the builder hostname.

Upgrades, backups and restores are the same commands as in the Compose install, pointed at these directories. This path is documented, not tested in CI.

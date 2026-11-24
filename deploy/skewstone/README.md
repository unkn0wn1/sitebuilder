# Skewstone public hosts

This bundle is the edge and the demo builder for skewstone.com. It does not create DNS records, open a tunnel, or publish plugin packages. Containers 115 and 116 are out of scope. Do not run install commands against them from here.

| Host | Port | What it serves |
| --- | --- | --- |
| skewstone.com and any other Host on this port | 8081 | Static marketing files in `/srv/skewstone/marketing` |
| www.skewstone.com | 8081 | Redirects to `https://skewstone.com` |
| docs.skewstone.com | 8082 | VitePress output in `/srv/skewstone/docs` |
| plugins.skewstone.com | 8083 | The plugins tree in `/srv/skewstone/plugins` |
| demo.skewstone.com | 8084 | The published demo, from nginx, not from Node |
| demo-admin.skewstone.com | 8085 | The builder, proxied to `127.0.0.1:3000` |

Each listen is `default_server`, so a private origin on that port is served in place. Canonical links in the pages stay on the public hostnames.

Marketing, docs, and plugins are indexable. The demo site and the demo builder send `X-Robots-Tag: noindex, nofollow`. Port 8084 answers `/robots.txt` itself and does not use the copy inside a published snapshot.

## Layout

Include `nginx.conf` from the `http { }` block. Copy `deploy/cloudflare-real-ip.conf` to `/etc/nginx/cloudflare-real-ip.conf`. Only the demo builder includes that file. It then replaces `X-Forwarded-For` with the socket address and clears `CF-Connecting-IP`. `X-Forwarded-Proto` keeps an incoming value, and falls back to the local scheme, so a TLS tunnel still marks the demo cookie Secure.

`cloudflared-ingress.example.yml` is an example of the five hostnames plus www. It has no tunnel id, token, or credentials.

Static files land in `/srv/skewstone/marketing`, `/srv/skewstone/docs`, and `/srv/skewstone/plugins`. The plugins tree is rsynced from the plugins release. This repository does not build or sign those packages.

## Demo builder

The compose file runs only the builder, with demo mode on, the agent gateway off, and no mail, AI key, Access audience, or production Cloudflare token. It publishes `127.0.0.1:3000:3000` and mounts `/var/lib/skewstone/demo` at the same path in the container, which is the tree nginx reads.

```sh
openssl rand -base64 32
cp deploy/skewstone/env.example deploy/skewstone/.env
```

Put the generated secret in `.env` on that machine. Do not commit `.env`. Build from a checkout so the Dockerfile can see the source:

```sh
docker compose -f deploy/skewstone/docker-compose.yml build
docker compose -f deploy/skewstone/docker-compose.yml up -d
```

Build the golden snapshot on a checkout (`npm run demo:golden`) and mount it at `/var/lib/skewstone/demo`, or run the same command in the image after the source copy. The directory needs to be writable by the `node` user in the image and readable by nginx. `site/current` stays a relative symlink.

Copy `docker-compose.yml` and `.env` to `/srv/skewstone` for the timer. Install `skewstone-demo-sweep.service` and `skewstone-demo-sweep.timer`. The timer runs `docker compose exec -T builder npm run demo:sweep` once an hour. If the builder is alive it closes expired sandboxes itself. If the heartbeat is stale, the sweep deletes them.

## Rollback

Stop the demo compose project and put the previous marketing, docs, and plugins directories back. The product compose file in `deploy/docker-compose.yml` is a different stack. Leave it alone.

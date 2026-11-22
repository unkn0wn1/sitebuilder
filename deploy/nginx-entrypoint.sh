#!/bin/sh
# Substitute the hostnames, make sure nginx can start before the first publish,
# watch the current symlink and the live maps, then run nginx in the foreground.
set -eu
TEMPLATE=/etc/nginx/templates/default.conf.template
OUT=/etc/nginx/conf.d/default.conf
SITE=/var/lib/sitebuilder/site
CURRENT="$SITE/current"

if [ ! -e "$CURRENT" ]; then
  if ! mkdir -p "$SITE/releases/.bootstrap" 2>/dev/null; then
    echo "site/current is missing and the site volume is not writable." >&2
    echo "The installer should create an empty bootstrap release (see prepareInstallDir)." >&2
    exit 1
  fi
  for f in redirects.map redirect-status.map cache-tags.map csp.map; do
    : > "$SITE/releases/.bootstrap/$f"
  done
  ln -s releases/.bootstrap "$CURRENT"
fi

export PUBLIC_HOST="${PUBLIC_HOST:-_}"
export BUILDER_HOST="${BUILDER_HOST:-builder.localhost}"
# Only substitute our host variables, not nginx's $uri and friends.
envsubst '${PUBLIC_HOST} ${BUILDER_HOST}' < "$TEMPLATE" > "$OUT"

# Stamp of the four maps nginx reads from the live release. A missing file is
# its own stamp so `set -eu` does not end the watcher. `stat -c` is busybox.
# The inode changes on every atomic rename, so a same-second, same-size rewrite still counts.
map_stamp() {
  stamp=
  for name in redirects.map redirect-status.map cache-tags.map csp.map; do
    if part=$(stat -c '%i %Y %s' "$CURRENT/$name" 2>/dev/null); then
      stamp="${stamp}${name} ${part};"
    else
      stamp="${stamp}${name} missing;"
    fi
  done
  printf '%s' "$stamp"
}

# Test first. A failed test or reload is logged and does not stop the loop.
reload_nginx() {
  if ! nginx -t; then
    echo "nginx -t failed; not reloading" >&2
    return 1
  fi
  if ! nginx -s reload; then
    echo "nginx reload failed" >&2
    return 1
  fi
}

prev=$(readlink "$CURRENT" 2>/dev/null || true)
prev_maps=$(map_stamp)
(
  while sleep 2; do
    now=$(readlink "$CURRENT" 2>/dev/null || true)
    maps=$(map_stamp)
    if [ "$now" != "$prev" ] || [ "$maps" != "$prev_maps" ]; then
      if reload_nginx; then
        prev=$now
        prev_maps=$maps
      fi
    fi
  done
) &

exec nginx -g 'daemon off;'

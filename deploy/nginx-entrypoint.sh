#!/bin/sh
# Substitute the hostnames, make sure nginx can start before the first publish,
# watch the current symlink, then run nginx in the foreground.
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

prev=$(readlink "$CURRENT" 2>/dev/null || true)
(
  while sleep 2; do
    now=$(readlink "$CURRENT" 2>/dev/null || true)
    if [ "$now" != "$prev" ]; then
      prev=$now
      nginx -s reload 2>/dev/null || true
    fi
  done
) &

exec nginx -g 'daemon off;'

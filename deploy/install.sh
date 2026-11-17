#!/usr/bin/env bash
# Supported install path: prepare a directory, then start Docker Compose (ADR 0007).
# Usage: ./deploy/install.sh --dir /srv/sitebuilder [--origin https://builder.example.org] ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v node >/dev/null; then
  echo "Node 22 or newer is needed to run the installer." >&2
  exit 1
fi
npx tsx scripts/install.ts "$@"

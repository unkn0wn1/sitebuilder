# 0003: Static output served by nginx

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Speed and simplicity are the top principles. Rendering pages on each request needs an app server running for the public site, adds failure points and is slower than serving files.

## Decision

Published sites are **fully static**: HTML, CSS, JS and media generated at publish time and served by plain **nginx**. Deploys are atomic (build into a new release folder, then switch a symlink).

## Consequences

- Very fast pages and a tiny attack surface for the public site.
- The public site keeps working if the builder is down.
- Rollback is switching the symlink back to an earlier release.
- Anything dynamic (donation forms, search, sign-ups) must come from embeds or small client-side islands, not server code on the public site.
- Publish time grows with site size. Partial rebuilds of changed pages are needed for larger sites.

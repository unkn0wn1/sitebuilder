# 0004: Compile once, render only changed pages on publish

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The vision promises a page is live "a few seconds" after approval. Running a full `nuxt generate` on every publish is a whole Vite build plus prerender. On a small VPS that takes tens of seconds to minutes and grows with the number of pages. ADR 0003 already noted that partial rebuilds would be needed.

## Decision

Split publishing into two separate steps:

1. **Compile (rare).** The block library, the active theme and the site's own layer (ADR 0006) are compiled once into a **render bundle**: a server-side render function for each block plus hashed CSS and the few client JS islands. This happens at install, on upgrade, on a theme switch, and when the brand pack changes tokens. It is the only step that runs Vite.
2. **Render (every publish).** A publish renders only the affected pages to HTML with Vue's server renderer (`renderToString`) using the compiled bundle, writes them into a new release folder, and switches the `current` symlink.

Rules:

- **Dependency map.** Each rendered page records what it depends on: its own version, the site parts it uses (header, footer, menus), the titles and URLs of pages it links to or lists, the media it uses, and the bundle id. A publish re-renders every page whose dependencies changed. A header, footer or menu change re-renders every page.
- **Release assembly.** A new release starts as a hard-link copy of the previous release (cheap, no extra disk), then changed files are overwritten. sitemap.xml, the redirects map and the search index (if enabled) are regenerated on every publish.
- **Publish queue.** Publishes run one at a time through the job runner (ADR 0009). Two approvers clicking at once get two queued jobs, run in order.
- **Cache purge** by Cloudflare cache tag (each HTML response carries `Cache-Tag: page-<id>` plus `shell`). Purge by tag is available on all Cloudflare plans since April 2025. See [08-hosting.md](../08-hosting.md).
- **Targets:** a single page publish under 10 seconds end to end; a full re-render of 500 pages under 5 minutes on a 2 vCPU VPS.

## Consequences

- "Live in seconds" is realistic, and publish time grows with the size of the change, not the size of the site.
- The editor preview and the publish use the same render bundle, so preview is true to output.
- We own a small renderer instead of relying on `nuxt generate`. `nuxt generate` stays useful for the compile step and for tests.
- A bug in the dependency map can leave a stale page. Mitigation: a "Re-render whole site" admin action, and a nightly full re-render job that compares output.

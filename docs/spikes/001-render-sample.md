# Spike: render a sample page

**Date:** 17 November 2026. Code in [`spikes/render-sample/`](../../spikes/render-sample/).

## What we asked

Can we render one sample page with a compiled render bundle and Vue's server renderer, serve it from nginx behind Cloudflare, and stay within the budgets in [17-testing-and-budgets.md](../17-testing-and-budgets.md)? Does a Virtuous embed and a near full-screen video hero still fit?

## What we built

A small prototype, not the production publisher:

- Block render functions written as Vue `h()` components, standing in for the compiled render bundle in [ADR 0004](../decisions/0004-incremental-publish.md).
- `renderToString` from `vue/server-renderer` writes static HTML, plus a tiny theme CSS file and a 0.5 KB (gzip) client island that lazy-loads a Virtuous embed.
- A near full-screen video hero (`min-height: 100svh`) with `preload="none"`, a poster, and the video hidden when the visitor prefers reduced motion.
- A dependency map for the page (version, site parts, media, bundle id), in the shape a publish job will need.
- An example `nginx.conf` with `Cache-Tag` headers (`page-home shell` and `media`).

nginx itself was not installed in the environment we used, and we do not have a Cloudflare zone for this repo, so the live CDN path was not exercised. File sizes were measured on the rendered output. Lighthouse ran against a local static server on 17 November 2026 at 8:52 IST (Asia/Calcutta), using Lighthouse 13.6.0's mobile profile with simulated slow 4G.

## Results

| Measure | Budget | Spike result | Pass |
| --- | --- | --- | --- |
| Lighthouse performance (mobile) | 95 or more | 100 | Yes |
| Largest Contentful Paint | under 2.5 s | 0.9 s | Yes |
| Cumulative Layout Shift | under 0.05 | 0 | Yes |
| Total Blocking Time | under 100 ms | 0 ms | Yes |
| HTML per page (gzip) | under 50 KB | 1.1 KB | Yes |
| CSS (gzip, whole site) | under 30 KB | 1.1 KB | Yes |
| Our JavaScript (gzip, excluding third-party embeds) | under 20 KB | 0.5 KB | Yes |
| Hero image at 640 px (AVIF) | under 120 KB | 1.4 KB | Yes |
| Fonts | at most 2 families, 4 files, self-hosted | 0 files (system-ui) | Yes |

The video hero itself has no formal budget. The spike file is 30 KB for a 4 second, 854×480, hard-compressed loop. Accessibility also scored 100, including a skip link, a labelled hero, and a reduced-motion fallback.

The poster and video are generated from a simple gradient, not a photograph or real footage, so the image and video byte counts will be higher on a real appeal. The HTML, CSS and our own JS have a lot of headroom. Re-measure with real footage and a live Virtuous form during the pilot.

## Virtuous embed

The island uses the official pattern: `https://cdn.virtuoussoftware.com/virtuous.embed.min.js` with `data-vform` and `data-orgId`, loaded only when the donation section is close to the viewport. Placeholder ids were used, so the live form did not appear (and should not, on a spike). A visible fallback link is in the HTML if the script fails. The third-party script is excluded from the JS budget, as the budgets already say. The form must be placed directly on the page, not in an iframe, and the site's domain has to be on the organisation's Virtuous trusted-domain list when this goes live.

## What this means for milestone 2

- Vue's server renderer is the right tool for the publish step. The compile step (Vite, real block SFCs, hashed CSS) is still to build; this spike only proved the render half.
- Keep our own JS to a small island. A page with no interactive section should ship no JavaScript at all, by omitting the island.
- Inline the small theme CSS in the HTML, or otherwise avoid a render-blocking stylesheet. Lighthouse flagged about 140 ms for the external CSS, even though the overall score was 100.
- Always ship a poster, load the video with `preload="none"`, and honour reduced motion. Compress the video hard. Re-test against the 120 KB poster budget with a real still.
- Put `Cache-Tag` on HTML (`page-<id>` and `shell`) and on media, as already decided. The test server had no cache headers; that is why Lighthouse complained about cache lifetimes. The nginx example sets them.
- A live measurement behind Cloudflare is still outstanding. It needs a zone and should be done when we have somewhere to park the spike output.

## Not done here, on purpose

The production publish job, incremental re-render, release symlinks, and Cloudflare purge. Those stay on milestone 2.

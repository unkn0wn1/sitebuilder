# Spike: render a sample page

Prototype for the Phase 1 publish-path spike in [docs/09-roadmap.md](../../docs/09-roadmap.md). Findings are in [docs/spikes/001-render-sample.md](../../docs/spikes/001-render-sample.md).

This is not the production renderer (that is milestone 2). It checks that Vue's server renderer, a small CSS theme, a near full-screen video hero and a Virtuous-style embed island can meet the budgets in [docs/17-testing-and-budgets.md](../../docs/17-testing-and-budgets.md).

## Run

From the repo root, with Node 22 and ffmpeg:

```bash
npx tsx spikes/render-sample/scripts/make-media.ts
npx tsx spikes/render-sample/scripts/measure.ts
# optional: python3 -m http.server 8765 --bind 127.0.0.1 -d spikes/render-sample/out
```

`out/` is generated and not committed. Posters and the compressed hero video in `media/` are committed so the measure script can run without ffmpeg. `nginx.conf` is the intended production shape; it was not executed in this environment.

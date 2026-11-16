# Roadmap

Draft. Timings are rough guesses for one developer with AI help, not commitments.

## Phase 0: Design (now)

- Write up the architecture in `docs/` and settle the main open questions.
- Repo skeleton that builds (done).

## Phase 1: Spike (2 to 3 weeks)

- Build one sample page end to end: a few blocks, the JSON model, a static generate, served by nginx behind Cloudflare.
- Measure page weight and Lighthouse scores.
- Test a Virtuous donation form embed and a near full-screen video hero for speed.
- Decide whether to build our own Vue editor or start from an existing one.

## Phase 2: Core (6 to 8 weeks)

- Block definitions and schemas, starter block library.
- Content API with versions and states.
- Image pipeline (sharp, renditions, srcset, required-size crop approval).
- Static publish with atomic deploy and Cloudflare purge.
- Setup wizard, first pass.

## Phase 3: Editor, agent and approvals (4 to 6 weeks)

- Page editor with preview and the desktop, tablet and mobile toolbar.
- Chat agent with tool calling.
- Approval flow with diff and rollback.
- Speed advisor on preview.

## Phase 4: First pilot, a demo site (about 4 weeks)

The first pilot is a demo of a charity website (Animal Aid Unlimited), built to show what the approach can do:

- **Two or three alternative designs** of the whole site, built from the same content with different brand packs and templates, so people can compare and pick a favourite.
- Real content (stories, photos, video) from the charity's existing material.
- A near full-screen **video hero** on the home page, compressed hard and with a poster fallback, without hurting the speed scores.
- Embedded donation forms (Virtuous).
- A live demo of a member of staff asking the agent for a new donation page and approving it.

## Phase 5: Open-source release

- Licence decision, contribution guide, docs site, public demo.
- Multilingual support (the data model is locale-aware from the start).
- Install script or Docker Compose.

## Later

- Crop wizard for per-breakpoint art direction.
- Video transcoding in the pipeline.
- Scheduled publishing, A/B tests, multi-site.
- Optional connectors (CRMs, donation platforms) where they help.

# Principles

Every design decision is checked against these. When two pull in different directions, the earlier one usually wins.

## 1. As simple as possible

- Fewest moving parts that do the job well. Every new service, dependency or layer has to earn its place.
- Prefer one way of doing a thing over a configurable choice of three.
- If a feature can wait, it waits. Ship a small thing that works.
- Example: no Varnish, because nginx serving static files behind Cloudflare is already fast (see [ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md)).

## 2. Speed is a feature

- Published pages are static HTML. No server rendering on each request.
- No client-side JavaScript on a page unless a block genuinely needs it (for example a donation form embed), and then only on that page.
- Images are resized and converted automatically. Nobody should be able to upload a 6 MB photo and ship it to a phone.
- The speed advisor tells people, in plain English, what is slowing a page down before it goes live.
- Performance budgets are part of the design, not an afterthought.

## 3. Guardrails by design, not by policy

- The AI never writes HTML, CSS or JavaScript. It can only call tools that add, edit or move approved blocks.
- Every change is validated against the block schemas and the locked brand.
- Nothing is published without a human approving it.
- Every save is a new version. Anything can be rolled back.
- Third-party scripts only load from an allow-list of domains.

## 4. The AI has one remit

- The AI builds and edits this site's pages and content inside the builder. Nothing else.
- It is **not a general-purpose chatbot**. Off-remit requests (general questions, writing emails, coding help, anything unrelated to the site) are politely declined and redirected back to what it can do.
- Scope is enforced by the system prompt **and** the tool set: it only has tools for site content, so it cannot do anything else even if asked cleverly.
- See [12-ai-harness.md](12-ai-harness.md).

## 5. Own your site

- Self-hostable on one small server.
- Content is plain JSON that can be exported at any time.
- Bring your own AI model key, so the organisation controls cost and provider.
- No lock-in to a hosted platform, a page builder vendor or a single agency.

## 6. Beautiful by default

- The starter blocks and templates should look modern and polished out of the box.
- The brand wizard should make it hard to produce something ugly or off-brand.

## 7. Borrow good ideas

- Reuse proven open-source parts for the hard bits (Nuxt, sharp, Lighthouse).
- Borrow good designs (for example Puck's `{ type, props }` block shape) rather than inventing new ones.
- Keep compatible with other tools where it costs little.

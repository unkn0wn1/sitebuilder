# 0018: Agent gateway: one REST API and one MCP server, drafts first, rules decide what goes live

- **Status:** Accepted, updated 2026-11-20 (phases 0 to 3 built, see [agent-gateway-plan.md](../agent-gateway-plan.md))
- **Date:** 2026-11-20

## Context

People want to say "take this link down" or "add our analytics provider to the privacy policy" to an AI assistant, at any hour, and have it happen on the site. The builder already has everything an AI needs to do that safely: drafts, versions, approval pinned to a version, releases and rollback, and an audit log. What it lacked was a door that is not a browser session.

Three things made this a decision rather than a feature:

1. **An AI can be wrong, and can be fooled.** Text it reads (a page, a form entry, an email) can try to instruct it. Whatever it is told, the server must be the thing that says no.
2. **Approval was designed for people.** ADR 0005 says editors cannot approve their own work. An agent acting for an admin at 3am needs a narrow, explicit way to publish without a second person.
3. **Cloudflare Access cannot sign in an AI connector** (ADR 0007). The builder host sits behind it.

## Decision

**One gateway, two doors.** A single operation table (`server/services/agent/operations.ts`) defines every tool: its name, REST route, input schema, handler and written documentation. It feeds the MCP server at `/agent/mcp` (streamable HTTP, stateless, JSON replies), the REST API at `/agent/v1`, the OpenAPI file and the generated tool reference. They cannot drift because there is one source.

**Drafts by default.** Every edit tool saves a draft inside a *change* (a titled set of edits across pages and site parts, with the agent's stated reason). Nothing is live until the change is published. The agent can ask for a preview that returns the exact diff and what the rules would do.

**Rules per token decide what goes live.** A token carries rules: which actions (`edit_text`, `remove_link`, `add_link`, `edit_sections`, `edit_page_details`, `create_page`, `edit_menu`, `edit_banner`, `undo_change`), on which targets (page types, address globs, header/footer/menu/banner), with which result (`publish`, `review`, `deny`) and limits (sections, words, new links, link domains, per hour). The decision is a pure function (`shared/agent/rules.ts`), table-tested. A change publishes by itself only if every part of it is covered by a publish rule whose limits hold. There is **no partial publishing**.

**Decision order, fixed and documented:** a matching deny rule refuses; then the *floor* (below) forces a person; then always-allow; then per-action publish rules; anything else goes to review.

**The floor and the never-list are not configurable.**
- Never-list, refused even as a draft: `DonationEmbed` and `Embed` sections, the props `embed`, `source` and `campaignId`; and everything outside page content (theme, settings, users, tokens, secrets, code and scripts), which has no tool at all.
- Floor, always a person even with always-allow: the change touches a money section (`ImpactTiers`, `DonationProgress`, `MatchBanner`); the page or part has someone else's unpublished work; the standard submission checks fail.

**Always-allow** is a per-token switch for an emergency window. It needs the site name typed and the admin's password, lasts one to seven days or is **permanent** (no end date, added in the 20 Nov 2026 update), and never covers the never-list or the floor. Deny rules still win.

**Approval by rule is a first-class, visible event.** When a rule publishes, the review is approved by `agent:<token id>` with the rule named in the decision comment, the release is not marked self-approved by a person, the audit action is `review.approved_by_rule`, and the owner and admins are notified with the diff.

**Tokens** are random 256-bit secrets starting `sbt_`, stored only as a SHA-256 hash, shown once. A token has an owner (an admin), an access level (`read` or `draft`), rules, rate limits, an optional expiry and IP allow-list, and can be paused, revoked or put in always-allow. A token acts as its owner but cannot manage tokens, users or settings, and cannot do anything a rule or the never-list forbids. There is one kill switch for all agents.

**Safety nets.** Per-token rate limits (defaults 120 reads and 30 edits a minute, 10 publishes an hour and 30 a day) kept in SQLite. Three blocked attempts (deny rule, never-list, forbidden) in ten minutes pause the token and notify the owner. Every blocked attempt is audited. An agent cannot edit a page that is waiting for a person's approval (that would withdraw their review).

**Undo.** `undo_change` rebuilds the pre-change content as a new change that goes through the same rules (so a token needs an `undo_change` rule to undo by itself). It is refused if anyone has published over the change since. An admin can undo any agent change in one call (`POST /api/v1/agent/changes/:id/undo`); that publishes at once and is not held to the token's rules.

**Off by default.** The routes answer 404 unless `SITEBUILDER_AGENT_GATEWAY=1`. The gateway never reads cookies and never accepts a browser session; the admin screens' API (`/api/v1/agent/*`) is the other way round and only accepts a signed-in admin.

**Cloudflare Access.** The agent paths live under `/agent/`. Access cannot sign in a connector, so either give that path a Bypass policy in Cloudflare (a second Access application for `<builder host>/agent` with a Bypass, Everyone policy; the more specific application wins) and set `SITEBUILDER_AGENT_ACCESS=bypass` so the in-app Access check also lets `/agent/` through, or serve the gateway on its own hostname. The bearer token, the rules, the rate limits and the audit log are then the only protection for that path, which is why they are strict. Details are in [agent-gateway.md](../agent-gateway.md#cloudflare-access).

**Documentation for the AI is part of the interface.** Each tool carries a description with what it does, when to use it, when not to, preconditions, whether the effect is draft or live, who is permitted, what it returns and how its errors are recovered from. Every input field has a description and the examples are validated by tests. The MCP server also sends server instructions and offers resources (guides) and prompts (step-by-step recipes). A test fails if the generated reference in `docs/` is stale.

## Alternatives considered

- **Give the AI the builder's own session.** Rejected: all-or-nothing, no per-task limits, and tied to a person's browser login.
- **Let an agent publish whatever its token allows, with no floor.** Rejected: money sections and other people's unpublished work are exactly where a wrong, fast publish hurts most.
- **Infer the action from the diff** (is this change "just text"?). Rejected for v1: each tool declares what it does, which is simple to explain and test. The diff still supplies the numbers for the limits.
- **A separate tool server from the app.** Rejected: it would need its own database access and copy the service rules. The gateway is a thin layer over the services.
- **OAuth first.** Deferred to phase 4, and on 20 Nov 2026 Spencer confirmed bearer tokens are fine for now. A static bearer token already works for clients that can send a header (Claude Code, Cursor, MCP Inspector, scripts, Claude connectors that have request headers enabled).

## Consequences

- A new path prefix (`/agent/`) and, in production, a Cloudflare Access bypass for it. The risk accepted is a public endpoint guarded by a bearer token and rate limits.
- Three tables (`agent_tokens`, `agent_changes`, `agent_calls`), migrations `0003_agent_gateway.sql` and `0004_agent_always_allow_permanent.sql`, and an `agent` actor type in the audit log.
- Approval has a second legitimate source (a rule on a token) and a second one-step undo (an admin). ADR 0005 is amended.
- A model that is instructed by page content can still do whatever its token's rules allow. The rules, not the model, are the control: keep rules narrow, keep the default (drafts for approval) for anything legal, and read the audit log.
- A change that touches several pages queues one publish job per page or part. The decision is made once, but the jobs run one after another.
- Unpublishing or deleting a page is not available to an agent. An admin must.

## Update 20 Nov 2026

Spencer reviewed the gateway and made two decisions.

1. **Bearer tokens are the authentication for now. OAuth (phase 4) is deferred.** Nothing in the design blocks it later: sign-in is one function (`authenticateAgent`) that turns a credential into a token row, and rules, limits and audit hang off the token. Revisit when a connector screen that cannot send a header is needed.
2. **Always-allow gets a permanent option** next to the 1 to 7 day ones.
   - **Same confirmation:** the site name typed exactly and the admin's password, every time it is switched on, by an admin only.
   - **Stored as its own flag** (`always_allow_permanent`, migration 0004), not as a far-future date, so it cannot be mistaken for a timed one and cannot silently end.
   - **Revocable:** switching it off (API `DELETE`, or `agent-token.ts always-allow-off`) or revoking the token clears it. Both are audited (`agent.token.always_allow_on` with `permanent: true`, `agent.token.always_allow_off` with `wasPermanent`).
   - **Visible as permanent:** `alwaysAllow: { permanent: true, until: null }` in the token list, `ALWAYS-ALLOW: PERMANENT (no end date)` in the command line list, and `you.always_allow` plus `you.always_allow_meaning` for the AI.
   - **Nothing else widens.** The decision order is unchanged. Deny rules, the never-list (donation forms and embeds, embed props), the floor (money sections, someone else's unpublished work, failing checks), rate limits, the IP list, the token's own expiry and the kill switch all still win over it. A test covers each.
   - **Cost accepted:** a permanent token can publish any wording or link change that no rule covers, with no one reading it first, until someone turns it off. The mitigations are the floor, the audit log, the owner and admin notification on every publish, one-call undo, and the advice to prefer timed and to keep deny rules on legal pages.

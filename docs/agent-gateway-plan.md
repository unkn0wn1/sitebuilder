# Agent gateway: phased plan

**Status:** phases 0 to 3 built on branch `feat/agent-gateway` (local, not deployed). Phases 4 to 6 are planned. This is the engineering version of the plan Page. The reasoning is in [ADR 0018](decisions/0018-agent-gateway.md). How to use it is in [agent-gateway.md](agent-gateway.md).

## The idea

One agent gateway in front of the services sitebuilder already has, exposed twice: a versioned REST API and an MCP server (streamable HTTP). Both call the same operation table, so they cannot drift apart.

- Every agent write lands as a **draft change**.
- A change goes live by itself only when a rule on the token covers every part of it. Anything else waits for a person.
- Some things are **never** open to an agent, whatever the token says.
- Every change is written to the audit log with a diff, and can be undone in one call.

## Decisions taken (the defaults for the plan's open questions)

| Question | Default used | Where to change it |
| --- | --- | --- |
| Cloudflare Access: bypass or separate host? | One path prefix, `/agent/`, that can be bypassed (or given its own hostname) in Cloudflare. The app's own token check protects it. `SITEBUILDER_AGENT_ACCESS=bypass` makes the in-app Access check skip that prefix | ADR 0018, env var |
| Always allow? | Per token, off by default. Timed (1 to 7 days) or permanent (no end date, added 20 Nov 2026 at Spencer's request). Needs the site name and the admin password. Revocable, audited, shown as permanent in listings. Never covers the never-list, the floor, checks or rate limits. Explicit deny rules still win | Token settings |
| Money and the Together page | Never auto-published. An agent can draft changes to money sections, but a person approves. Donation forms and embeds cannot be touched at all | `shared/agent/rules.ts` |
| Legal pages | A rule you can add. Off by default, with word caps | Token rules |
| Who is told | Published by rule: the token's owner and all admins (in-app, plus the email job with the diff). Sent for review: the usual approver notice, and an email to the token's owner | `server/services/agent/changes.ts` |
| Build me a site | Pages inside this install (one site per install, ADR 0007) | n/a |
| Prompt record | The agent's stated reason, stored on every change and audit entry, labelled as the agent's words | n/a |
| Off by default? | Yes. Routes answer 404 unless `SITEBUILDER_AGENT_GATEWAY=1` | env var |

## Phases

Sizes are rough days of focused work for one developer, plus or minus half.

| Phase | What ships | Size | Status |
| --- | --- | --- | --- |
| 0. Decide | ADR 0018, amendments to ADR 0005 and 0007, rule engine as a pure table-tested function | 3 days | **Built** |
| 1. Tokens and read-only | Token table (hashed, scoped, expiring, pausable, IP allow-list), bearer sign-in, agent actor in the audit log, REST plus MCP read tools, search and link finder, off-by-default switch | 5 to 6 days | **Built** |
| 2. Drafting | Changes (drafts across pages and site parts), write tools, dry run with diff and rule decision, rate limits kept in SQLite, review request | 9 to 10 days | **Built** (text, links, sections, page details, new pages, menu and banner). Rendered preview links are not built |
| 3. Rules, auto-publish, undo | Rule engine in the live path, approval by rule, audit diff, one-call undo, owner notifications, pause and auto-pause, always-allow, token admin API and CLI | 9 to 10 days | **Built** (API and CLI). The Settings screen for tokens and rules is not built |
| 4. OAuth for connectors | Discovery metadata, PKCE, refresh tokens, consent screen with rules picker, client registration, ChatGPT and Claude connector tests | 6 to 7 days | **Deferred** (20 Nov 2026: bearer tokens confirmed for now). Use a static bearer token (Claude Code, scripts, header connectors) |
| 5. Build me a site | Multi-page changes in one go, media import by address, more menu and footer tools, build-guide prompts, first-publish confirmation | 9 to 10 days | Planned |
| 6. Hardening | Prompt-injection red-team page, limit tuning, published OpenAPI, Slack or webhook alerts, Settings screen, rendered previews | 5 days | Planned |

Total is about 46 to 51 days. The 3am flow (phases 0 to 3) is what this branch contains.

## What each phase is tested with

- **Automated:** the rule engine is table-tested (every action, target and limit). Service tests cover tokens, scopes, search, link removal, text edits, decisions, publish and undo against an in-memory database. Protocol tests drive the MCP server as JSON-RPC.
- **Claude Code against the demo (next step):** `claude mcp add --transport http sitebuilder-demo https://<host>/agent/mcp --header "Authorization: Bearer sbt_..."`, then the scripted prompts in [agent-gateway.md](agent-gateway.md#prompts-to-try).
- **MCP Inspector:** to read tool names, schemas and error text as a client sees them.
- **Claude and ChatGPT connectors:** phase 4, deferred. Bearer tokens are the supported way for now.

## Known limits of what is built

- Publishing a change that touches several pages queues one publish job per page or site part. The decision to publish is made once for the whole change (no partial publishing), but the jobs run one after another, so for a few seconds some parts can be live before others.
- No rendered preview link yet. `preview_change` returns the diff, the checks and the rule decision.
- Rich text edits work inside a single run of text. Text that is split by bold or a link must be edited in each run, or replaced with `insert_rich_text` or `edit_component`.
- Token and rule management is by REST (signed-in admin) and the `agent-token` script. There is no Settings screen yet.
- There is no `unpublish_page` tool. A page an agent created can only be taken down by an admin, and an agent cannot undo a change that created a page.
- An agent will not edit a page that is waiting for approval, and will not publish over someone else's unpublished edits on the same page. It reports the page and stops.
- Admin undo of an agent change is by REST only (`POST /api/v1/agent/changes/:id/undo`), and is refused if the page was published again since.
- OpenAPI is public at `/agent/v1/openapi.json` (it contains no secrets). Tools still need a bearer token.

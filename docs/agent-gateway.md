# Agent gateway

Let an AI assistant read this site and change it, safely. It can fix a phone number, take a link down at 3am, or add a paragraph to the privacy policy, and the site owner decides how much of that happens without a person.

- Why and how it is built: [ADR 0018](decisions/0018-agent-gateway.md)
- Phases and what is built: [agent-gateway-plan.md](agent-gateway-plan.md)
- Every tool, input field and error, as the AI reads it: [agent-gateway-tools.md](agent-gateway-tools.md) (generated)
- REST description: [agent-gateway-openapi.json](agent-gateway-openapi.json) (generated; also served at `/agent/v1/openapi.json`)

## The short version

1. The AI connects with a **token** you make. The token says what it may do.
2. Every edit it makes is saved as a **draft inside a change**. The live site does not move.
3. It asks for a **preview**: exactly what differs, and whether a rule would let it go live.
4. It then **publishes** (only if a rule on its token allows exactly this kind of change) or **asks a person** to approve.
5. Everything is in the **audit log**, and any change can be **undone in one call**.
6. Some things are **never** open to an agent: donation forms and embeds, form bindings, the theme, settings, code. No setting changes that.

## Turn it on

It is off by default. The routes answer 404 until you set:

| Variable | Meaning |
| --- | --- |
| `SITEBUILDER_AGENT_GATEWAY=1` | Switch the gateway on (REST at `/agent/v1`, MCP at `/agent/mcp`). |
| `SITEBUILDER_AGENT_ACCESS=bypass` | Make the app's own Cloudflare Access check skip `/agent/`. Only needed if the builder is behind Access. See below. |
| `SITEBUILDER_AGENT_ALLOWED_ORIGINS` | Optional comma list. If set, a browser request from any other origin is refused. Servers and command-line tools send no origin and are not affected. |

The gateway never uses cookies and never accepts a browser login. Only a bearer token works.

### Cloudflare Access

The builder host is behind Cloudflare Access ([ADR 0007](decisions/0007-single-site-install.md)). Access cannot sign in an AI connector, so the agent path needs its own way in. Pick one.

**A. A bypass for one path (simplest).**

1. In Cloudflare Zero Trust, Access, Applications, add a *self-hosted* application for your builder hostname with the path `agent` (for example `builder.example.org/agent`).
2. Give it one policy: action **Bypass**, include **Everyone**.
3. Leave the existing application for the whole host as it is. Cloudflare uses the most specific application, so only `/agent` is open and everything else stays behind Access.
4. Set `SITEBUILDER_AGENT_ACCESS=bypass` on the builder, so the app's own Access check agrees.
5. Check with curl that `https://builder.example.org/agent/v1/site` answers `401` (token needed, not an Access page) and `https://builder.example.org/api/v1/pages` still answers an Access sign-in.

**B. Its own hostname.** Point a second hostname (for example `agent.example.org`) at the same server, and give that hostname a Bypass policy (or no Access application). Only `/agent/` is useful there.

Bypass switches off Cloudflare's Access logging for those requests. The protection for `/agent/` is then the token, its rules, the rate limits and the audit log in the builder, so keep tokens narrow and expiring. If your client can send custom headers, a Cloudflare *Service Auth* policy with a service token is stronger than Bypass: it needs the extra headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`, which most AI connector screens cannot send, so it is not the default.

## Make a token

A token has an **owner** (an admin; the token acts as them), an **access level** (`read` or `draft`), **rules**, optional **expiry** and **IP allow-list**, and **rate limits**. The secret starts `sbt_`, is shown once, and is stored only as a hash. The allow-list is checked against the last `X-Forwarded-For` entry. The shipped nginx overwrites that header with `$remote_addr` after Cloudflare real-ip (`deploy/cloudflare-real-ip.conf`) and clears `CF-Connecting-IP`. The app does not read `CF-Connecting-IP`. Anyone who runs without that nginx must overwrite `X-Forwarded-For` the same way. Appending, or trusting `CF-Connecting-IP` in the app, is not what this build does.

From the command line, on the server:

```bash
npm run agent-token -- presets
npm run agent-token -- create --name "Claude, emergencies" --preset takedown --days 90
npm run agent-token -- create --name "Claude, copy edits" --preset copy-editor --admin you@example.org
npm run agent-token -- create --name "Reader" --preset read-only
npm run agent-token -- list
npm run agent-token -- always-allow agt_... --days 3 --site-name "Example charity"     # 1 to 7 days
npm run agent-token -- always-allow agt_... --permanent --site-name "Example charity"  # no end date
npm run agent-token -- always-allow-off agt_...
npm run agent-token -- revoke agt_...
npm run agent-token -- pause-all     # the kill switch for every token
npm run agent-token -- resume-all
```

Or by the admin API (signed in as an admin, with the usual `Origin` header): `POST /api/v1/agent/tokens` with `{ "name", "access", "rules", "expiresAt", "ipAllow", "limits" }`. There is no Settings screen yet.

### Presets

| Preset | Access | What it may publish by itself |
| --- | --- | --- |
| `read-only` | read | Nothing. It cannot change anything. |
| `drafts` | draft | Nothing. Every change waits for a person. The safest way to let an AI help. |
| `takedown` | draft | Taking links down (up to 50 sections, 10 an hour), and undoing its own changes within 24 hours. Everything else waits for a person. |
| `copy-editor` | draft | The above, plus small wording changes (up to 10 sections and 200 words, no new links, 20 an hour). |

### Rules

A rule is a plain object:

```json
{
  "id": "legal-words",
  "label": "Small wording changes on legal pages",
  "actions": ["edit_text"],
  "targets": { "pageTemplates": ["legal"], "pagePaths": ["/privacy", "/terms/*"] },
  "result": "publish",
  "limits": { "maxSections": 3, "maxWords": 120, "maxPerHour": 5 }
}
```

- **actions**: any of the list below, or `"*"` for all.
- **targets**: leave out for everything. `pageTemplates` (page type keys), `pagePaths` (`/exact` or `/folder/*`), `siteParts` (`header`, `footer`, `menu`, `banner`). Page targets and site-part targets are alternatives: a rule with only `pagePaths` does not match the menu.
- **result**: `publish` (may go live by itself), `review` (a person must approve; the same as having no rule), `deny` (refused).
- **limits**: `maxSections`, `maxWords`, `allowNewLinks` (default false), `allowedLinkDomains`, `maxPerHour`, `allowMoneyPages` (default false), `maxNewPages` (for `create_page`, default 1), `withinHours` (for `undo_change`).

| Action | Used by | Meaning |
| --- | --- | --- |
| `edit_text` | `edit_text`, `insert_rich_text` | Change words in existing text. |
| `remove_link` | `remove_link` | Take links out. The words stay, or the button or menu item goes. |
| `add_link` | `replace_link` | Add a link, or point one somewhere new. |
| `edit_sections` | `edit_component`, `add_component`, `remove_component`, `move_component` | Anything beyond plain text. |
| `edit_page_details` | `set_page_details` | Title, address, search settings. |
| `create_page` | `create_page`, `create_pages` | New pages. More than one in a change needs a rule with `maxNewPages`, or a person. |
| `edit_menu` | `remove_menu_item`, `add_menu_item`, `rename_menu_item`, `set_menu_item_tile` | Menu items. Photo tiles only on a sub-item of the draft header's menu, and only while that header is mega. |
| `edit_banner` | `set_banner` | The site-wide banner. |
| `edit_footer` | `set_footer` | Footer words, contact details, social links, tagline, layout, links menu, legal menu, charity number. Not its colours or logo. |
| `edit_header` | `set_header` | The small header link, whether the header is see-through over the hero, and the heart on the existing Donate button. Not that button's words or target, and not colours or the logo. |
| `undo_change` | `undo_change` | Undo a change the token made. |

`list_media`, `import_media`, `get_media_import` and `set_alt_text` need no rule: the media library is open to any token with draft access (decided 21 Nov 2026). A photo is only live once a published page uses it. Imports run in the background: `import_media` returns an `import_id`, and `get_media_import` says when it is done.

**How a change is decided**, always in this order:

1. A matching `deny` rule refuses it. This happens when the draft is made, not at publish time, and counts as a blocked attempt.
2. **The floor.** A person is needed, whatever the rules or always-allow say, if: the change touches a money section (`ImpactTiers`, `DonationProgress`, `MatchBanner`); the page or part has someone else's unpublished work (publishing would publish it too); the standard submission checks fail.
3. **Always-allow**, if switched on (and, for a timed one, not ended): it publishes without a matching rule.
4. Otherwise every action in every part of the change must be covered by a `publish` rule whose limits hold. If one part is not, the **whole change** goes to review. It never publishes half.

Each tool declares its action, so "take this link down" is `remove_link` even when it removes a menu item. Link, word and section counts come from comparing the draft with what is live.

### Always-allow

Always-allow lets a token publish a change that **no rule covers**, so a trusted assistant does not have to ask every time. It is off by default and is set per token. There are two kinds:

| Kind | Length | Use it for |
| --- | --- | --- |
| **Timed** | 1 to 7 days | An emergency window or a campaign week. It switches itself off. |
| **Permanent** | No end date | A token you fully trust to run the site day to day. It stays on until someone switches it off or the token is revoked or expires. |

Either kind needs the **site name typed exactly** and **your password**, every time it is switched on. Switching it on again replaces the earlier setting (timed to permanent, permanent to timed). It cannot be switched on by a token or by a non-admin.

**What permanent does not change.** It is exactly the same switch, with no end date. These still win, always:

- A matching **deny** rule.
- The **never-list**: donation forms and embeds, the embed, source and campaign props, theme, settings, users, tokens, code. These are refused even as drafts.
- The **floor**: a money section (`ImpactTiers`, `DonationProgress`, `MatchBanner`), someone else's unpublished work on the same page or part, and failing checks. A person approves these.
- Rate limits, the IP list, the token's own expiry, pausing and the kill switch.

**Seeing it.** A permanent setting is labelled **permanent** (no end date) wherever it is shown: the token list (`alwaysAllow: { permanent: true, until: null }`), the command line (`ALWAYS-ALLOW: PERMANENT (no end date)`), and to the assistant itself (`you.always_allow` and `you.always_allow_meaning` from `get_site`). A timed one shows its end time.

**Switching it on or off.**

```bash
npm run agent-token -- always-allow agt_... --permanent --site-name "Example charity"   # asks for your password (hidden), or set SITEBUILDER_ADMIN_PASSWORD
npm run agent-token -- always-allow-off agt_...
```

Or by the admin API: `POST /api/v1/agent/tokens/:id/always-allow` with `{ "permanent": true, "siteName", "password" }` (or `{ "days": 1 to 7, ... }`; give exactly one of the two), and `DELETE` on the same address switches it off.

**Audit.** Switching it on is `agent.token.always_allow_on` (with `permanent: true` or the end time), switching it off is `agent.token.always_allow_off` (with whether it was permanent), and each change it publishes by always-allow is recorded as such in the audit log and the notification. Revoking a token clears it.

**Our advice.** Prefer timed. If you use permanent, give the token an IP list and an expiry date you will remember, keep the deny rules (for example on legal pages), and read the audit log.

## Connect a client

The MCP address is `https://<host>/agent/mcp` and the token goes in an `Authorization: Bearer sbt_...` header.

**Claude Code**

```bash
claude mcp add --transport http sitebuilder https://builder.example.org/agent/mcp \
  --header "Authorization: Bearer sbt_..."
```

**Locally while developing.** Seed once (`SEED_SAMPLE_PAGES=1 npm run seed`), make a token (`npm run agent-token -- create --name Local --preset takedown`), and start the app with `SITEBUILDER_AGENT_GATEWAY=1 SITEBUILDER_ALLOW_NO_ACCESS=1 npm run dev` (or the built server, `node .output/server/index.mjs`; it needs the same two variables and the same `SITEBUILDER_DB_PATH` as the token command, if you set one). Then:

```bash
claude mcp add --transport http sitebuilder-local http://localhost:3000/agent/mcp \
  --header "Authorization: Bearer sbt_..."
```

**A client configured by JSON** (Cursor and similar):

```json
{ "mcpServers": { "sitebuilder": { "url": "https://builder.example.org/agent/mcp", "headers": { "Authorization": "Bearer sbt_..." } } } }
```

**claude.ai and ChatGPT connectors.** These screens normally use OAuth. **A bearer token is the supported way for now and OAuth (phase 4) is deferred** (decided 20 Nov 2026, see [ADR 0018](decisions/0018-agent-gateway.md#update-20-nov-2026)). As of this writing Claude's custom connectors can send a fixed header (choose *No sign in*, then add `Authorization: Bearer sbt_...` under Request headers), but that is a beta for some organisations only. Check what your plan shows. Until OAuth is built, the reliable options are Claude Code, a client that accepts headers, or REST.

**MCP Inspector** (to read exactly what an AI sees): `npx @modelcontextprotocol/inspector`, choose *Streamable HTTP*, enter the URL and the header.

**REST** (scripts, other tools):

```bash
curl -s https://builder.example.org/agent/v1/site -H "Authorization: Bearer sbt_..."
curl -s "https://builder.example.org/agent/v1/links?url=https%3A%2F%2Fold-partner.example.org%2F&match=domain" -H "Authorization: Bearer sbt_..."
curl -s -X POST https://builder.example.org/agent/v1/edits/remove-link -H "Authorization: Bearer sbt_..." -H "content-type: application/json" \
  -d '{"url":"https://old-partner.example.org/","match":"domain","everywhere":true,"expected_matches":5,"reason":"Owner asked at 3am to take the old partner down."}'
```

### What the AI is told

On connect the MCP server sends instructions, and offers:

- **Tools**: 29 of them, each with a long description (what, when, when not, before, effect, permission, returns, errors, example) and a full input schema with a description and example on every field.
- **Resources**: guides at `sitebuilder://guide/overview`, `tools`, `rules`, `content-model`, `markdown`, `errors`, and `sitebuilder://you` (its own live permissions).
- **Prompts and recipes**, with the same text as resources at `sitebuilder://recipe/<name>`: `take_a_link_down`, `update_policy_text`, `change_words`, `edit_a_section`, `create_a_page`, `publish_or_ask`, `undo_a_change`, `menu_and_banner`, `when_you_are_refused`.

All of it is reproduced in [agent-gateway-tools.md](agent-gateway-tools.md) so a person can read what the AI reads.

## The 3am takedown, as it looks

> *You, in Claude:* "The partnership with Old Partner ended tonight. Take every link to old-partner.example.org off the website."

1. `get_site`: token may publish `remove_link` by itself.
2. `find_links` with `match: domain`: "7 links on 4 pages, plus the footer and the menu."
3. `remove_link` with `everywhere: true`, `expected_matches: 7`: one change with a diff for 4 pages, the footer and the menu. Words stay; buttons and menu items go. One link is the required button of a call-to-action, so it is listed under `could_not_remove` and the AI offers to remove that section instead.
4. `preview_change`: `goes_live`, "Allowed by rule 'Take links down'".
5. The AI tells you the summary and, with your yes, calls `publish_change`. Within seconds the pages are rebuilt and the cache purged. You and the admins get an email with the diff.
6. In the morning: "Put it back." `undo_change` (if the token has an undo rule) or an admin presses undo.

## Changes

| Status | Meaning |
| --- | --- |
| `open` | Drafts exist; nothing sent. The agent can keep editing (by passing `change_id`) or discard. |
| `review` | Sent to a person. Nothing is live. If they send it back it returns to `open` with their feedback. |
| `publishing` | Approved (by a person or by rule); the publish jobs are running. |
| `published` | Live. |
| `failed` | Publishing failed. A person can retry from the builder. |
| `discarded` | Thrown away before it was sent. Drafts are put back. |
| `undone` | An undo of it went live. |

Every edit returns the whole change: the diff per page or site part, before and after text, `if_you_publish` (what would happen right now and why), `problems_to_fix`, and `next_steps`, so the AI never has to guess the next call.

An agent will not edit a page that is **waiting for approval** (it would withdraw the review). It will not publish over **someone else's unpublished edits** on the same page. An agent can undo its **own** change that created pages: everything else is put back, then those pages go offline (they stay as drafts). It cannot take offline pages other people or other tokens made, or pages someone has published since. This only happens when a rule lets `undo_change` go live; otherwise the undo is refused and an admin undoes it from Settings > Agents > Changes, which always works.

## Audit, notifications and undo

- Everything an agent does is an audit event with actor type `agent` and the token's name: edits (`agent.change.edited`), approvals by rule (`review.approved_by_rule`), discards, undo, blocked attempts (`agent.call.blocked`), token changes (`agent.token.*`), and automatic pauses.
- The agent's `reason` is saved on the change and the audit entry. It is **the agent's words, not proof of what a person said**: the builder cannot see the chat.
- When a change is **published by rule**, the token's owner and all admins are notified (in the app, and by email with the diff and how to undo it). When a change is **sent for review**, approvers and admins get the usual "waiting for approval" notice and the token's owner gets an email with the diff.
- Admin API: `GET /api/v1/agent/changes` (all agent changes), `GET /api/v1/agent/changes/:id`, and **`POST /api/v1/agent/changes/:id/undo` with `{ "reason" }`**: restores the earlier content and publishes it now. Pages the change created are taken offline (the reply lists them in `pagesTakenOffline`). A menu or footer that had never been published is put back to its draft from before the change. It is refused if the page was published again since; use the whole-site rollback ([ADR 0005](decisions/0005-rollback-and-approval.md)) then.
- **Pause everything:** `POST /api/v1/agent/pause` with `{ "paused": true }`, or `npm run agent-token -- pause-all`. Every token then answers `agent_paused` until resumed.

## Limits and automatic protection

| What | Default |
| --- | --- |
| Reads | 120 a minute per token |
| Edits | 30 a minute per token |
| Publishes | 10 an hour and 30 a day per token |
| Blocked attempts | 3 in 10 minutes pauses the token and notifies the owner |
| Failed sign-ins | 20 a minute per address |

Per-token limits can be changed when the token is made or edited.

## How text and links are found

- **Text** is the words a visitor reads: headings, paragraphs, buttons, captions, SEO description, menu labels. Not amounts, ids, image settings or code. Rich text is searched one run at a time, so a phrase that is partly bold or a link is found in parts.
- **Links** are found in four places: rich-text link marks, button props (`{ label, href }`) in any section, menu items, header, footer and banner (a link to a page by id, or an address), and footer social links. A link to a page on this site matches its address.
- **Matching an address**: `exact` ignores `http`/`https`, `www.`, a trailing slash and the case of the domain; `prefix`; `domain`.
- **Removing a link** unmarks it in rich text (the words stay), deletes an optional button or link, removes a menu item or card, and **refuses** to remove what a section requires (for example a call-to-action's button, or a menu item with sub-items) and says so, instead of breaking the section.

## Safety model

- **The server is the control, not the model.** Content the AI reads (a page, a message) can try to instruct it. It can still only do what its token's rules and the never-list allow, and anything uncertain goes to a person.
- Tokens are hashed at rest, scoped, expiring if you set it, revocable, and tied to an address list if you set one. A token cannot manage tokens, users or settings.
- The gateway ignores cookies, so a signed-in browser cannot be used to reach it, and a token cannot be used to reach the builder.
- Keep rules narrow. Put legal pages on the `drafts` preset unless you have decided otherwise. Prefer short expiry.
- The floor and the never-list cannot be switched off by any setting.

## Troubleshooting

| You see | Meaning |
| --- | --- |
| `404 not_found` on `/agent/...` | The gateway is off. Set `SITEBUILDER_AGENT_GATEWAY=1`. |
| An Access sign-in page or `403 Sign in through Cloudflare Access first` | Access is blocking `/agent/`. See [Cloudflare Access](#cloudflare-access). |
| `401 unauthenticated` | Token missing, wrong, expired or revoked. |
| `403 agent_paused` | The token was paused (by an admin, or after 3 blocked attempts) or all agents are paused. |
| `403 forbidden` | The token is read-only, or the call came from an address not on its list. |
| `403 rule_denied` or `never_list` | A rule or the never-list forbids it. See the message. |
| A change "goes to review" | No publish rule covers it, a limit is exceeded, or the floor applies. `if_you_publish.reasons` says which. |
| `409 match_count_mismatch` | The site changed since the AI looked. It should look again. |
| `invalid_state` naming a page | The page is waiting for approval or being published. |

## Prompts to try

Against a demo site first, with a `drafts` token:

1. "Find every place we link to https://example.org and tell me, don't change anything."
2. "Change the phone number 0161 496 0000 to 0161 496 0123 everywhere. Show me the diff first."
3. "Add a short paragraph to the privacy page saying we use Plausible analytics, which sets no cookies. Don't publish: send it for approval."
4. "Take down every link to old-partner.example.org" (with a `takedown` token: it should publish after you say yes).
5. "Undo that last change."
6. "Add a donation form to the about page." (It must refuse and say why.)
7. "Create a page called Our volunteers with this text: ..." (It must create a draft and ask for approval.)

## What is not built yet

OAuth for connector screens (deferred on purpose: bearer tokens are fine for now), a Settings screen for tokens and rules, rendered preview links, unpublishing or deleting pages by an agent, building a whole multi-page site in one go, and alerts to Slack or a webhook. See the [plan](agent-gateway-plan.md).

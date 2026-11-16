# AI harness

**Draft.** How the AI model is wrapped so it stays useful, safe and on task. The conversation design and tool list are in [07-ai-agent.md](07-ai-agent.md).

## Core principle: one remit

**The AI has one job: building and editing this site's pages and content inside the builder. It is not a general-purpose chatbot.**

- In scope: creating and editing pages, blocks, copy, SEO text, alt text, choosing media and registered embeds, explaining how to do something in the builder, and suggesting improvements to the site's pages.
- Out of scope: everything else. General knowledge questions, writing emails or social posts, coding help, personal advice, other websites or systems, and chatting for its own sake.
- **Off-remit requests are politely declined and redirected**, for example: "I can only help with this website's pages and content. Want me to turn that into a news post or update a page instead?"
- **Enforced twice, not trusted once:**
  1. The **system prompt** states the remit, the decline-and-redirect behaviour and the guardrails.
  2. The **tool set** only contains site content tools. With no tools for email, the web at large, files or code, the model cannot act outside its remit even if it is talked into trying.

Keep it simple: one agent, one remit, one small tool set.

## Contextual, not global

There is **no global floating chat**. The AI panel only appears on specific screens, and on each one its tools and context are scoped to that screen and the user's role.

| Screen | Who sees the AI panel | What the AI can do there |
| --- | --- | --- |
| Pages > New page | Editors, approvers, admins | Ask the questions, pick a template, build the first draft |
| Pages > Edit page (page editor) | Editors, approvers, admins | Edit this page's blocks, copy, SEO text and alt text |
| Site parts (header, footer, menus) | Approvers and admins | Edit the site-wide blocks and menus |
| Templates | Admins | Suggest and adjust allowed and required blocks per template |
| Brand, and Design (themes) | Admins | Suggest colours, fonts and token changes, compare themes |
| Other admin areas where it helps (to decide) | Admins | Scoped to that screen only |
| Pages list, Media, Approvals, Settings | Nobody | No AI panel |

Rules:

- **Tools per screen and role.** The harness builds the tool list from the current screen and the user's role. On Edit page, an editor gets page tools only. Brand, theme and template tools exist only on those admin screens, for admins. So editors cannot change brand or theme through the AI, however they ask.
- **Context per screen.** The model only sees what that screen needs: the current page on Edit page, the brand pack on Brand, the template rules on Templates.
- **Same validation and approval everywhere.** Admin-screen changes also land as drafts and need approval before they go live.
- **The server enforces it.** Scope is checked by the API on every tool call (screen, role, target), not just hidden in the UI.
- **A conversation belongs to its screen.** Leaving the screen ends or parks that conversation; there is no cross-screen chat history.

## Per-instance tool allowlist

Each install (instance) can also switch AI tools off for the whole site. Admins set this in **Settings > AI tools**. It is layered on top of role and screen scoping:

```
effective tools = instance allowlist ∩ tools allowed for the user's role ∩ tools for the current screen
```

- The instance allowlist can only remove tools, never grant a role or screen something it would not otherwise have.
- Examples: an instance can turn off AI media upload (`request_upload`), design from a reference URL, AI copywriting, or the AI on admin screens entirely.
- If every tool for a screen is switched off, the AI panel does not appear on that screen.
- Sensible defaults ship on; higher-risk tools (such as reference-URL design) could ship off by default. To decide.
- Changes to the allowlist are admin-only and recorded in the audit log.
- The API enforces the intersection on every tool call; the UI only reflects it.

```mermaid
flowchart LR
  All["All AI tools"] --> I["Instance allowlist<br/>(Settings > AI tools)"]
  I --> R["Role scope<br/>(editor, approver, admin)"]
  R --> S["Screen scope<br/>(New page, Edit page, Brand...)"]
  S --> E["Effective tools<br/>for this request"]
```

## Parts of the harness

| Part | What it does |
| --- | --- |
| System prompt | Remit, tone of voice from the brand pack, guardrails, how to ask questions and hand over for approval |
| Context | Only what the task needs: current page JSON, schemas for the blocks allowed in this template, brand tokens by name, registered embeds |
| Tools | The fixed list in [07-ai-agent.md](07-ai-agent.md). No publish tool, no raw HTML or CSS, no arbitrary fetch (the reference URL feature fetches only a URL the user gave, and treats its content as data) |
| Validator | Every tool call is checked against block schemas, template rules and the brand pack before it touches a draft. Rejections go back to the model with a reason |
| Draft sandbox | All changes land in a draft version, with per-change undo |
| Audit log | Every tool call logged against its draft (see Observability) |
| Limits | Step, token, cost and time limits, plus a cancel button (see Agent loop) |
| Model adapter | Bring your own model through one OpenAI-compatible interface (see below) |

## Bring your own model

- **One provider interface:** an OpenAI-compatible chat completions API with tool calling. Most providers and local servers speak it, so one adapter covers a lot. Anything that does not gets a thin adapter behind the same interface.
- **Grok is the default for the first pilot site.** OpenAI, Anthropic and local models (for example via an OpenAI-compatible local server) are selected by config.
- **Keys are stored server-side** in Settings > Integrations, encrypted at rest, never sent to the browser and never shown again after saving.
- **Per-site model choice:** each install picks its provider and model (and optionally a cheaper model for small jobs such as alt text suggestions).
- The harness must not depend on one provider's special features. If a feature (for example vision for the self-check) is missing, the harness degrades gracefully.

## Agent loop

Keep it simple but do it properly. Experience with an earlier agent (Sheru) showed that a good loop matters more than clever prompts: most of the quality comes from the agent checking its own work and fixing it before it answers.

**One agent, one loop.** No multi-agent orchestration in v1.

```mermaid
flowchart TD
  U["User message"] --> P["Plan<br/>(short, internal)"]
  P --> C["Call tools"]
  C --> O["Observe results<br/>(validation errors, new draft state)"]
  O --> V{"Self-check<br/>preview screenshot,<br/>speed + accessibility checks"}
  V -- "problems found" --> C
  V -- "looks right" --> A["Answer the user<br/>(summary of changes, next question)"]
  O -- "step or cost limit hit" --> A
```

1. **Plan:** read the request and context, decide the next few steps.
2. **Call tools:** typed tool calls only (see below). Each is validated by the API.
3. **Observe:** read the results, including validation errors, and the updated draft.
4. **Self-check:** before answering, render the draft and look at it:
   - `preview_screenshot` renders the draft at desktop and mobile widths and returns images; the model inspects them for obvious problems (overflowing text, awkward crops, empty sections, clashing order) and fixes them.
   - `run_checks` runs the speed and accessibility checks and returns plain findings to fix.
5. **Iterate** until the self-check passes or a limit is reached.
6. **Answer:** a short summary of what changed and, if needed, the next question. It never claims something is done that the tools did not do.

**Guardrails on the loop:**

| Guardrail | Starting point (to tune) |
| --- | --- |
| Max steps (tool calls) per turn | for example 25 |
| Token and cost cap per request | set per site, request stops cleanly when reached |
| Monthly token and cost cap | per site, with a warning at 80 per cent |
| Timeouts | per tool call and per turn |
| Cancel button | in the AI panel, stops the loop at the next step; changes so far stay in the draft and can be undone |

When a limit is hit, the agent stops, says what it managed and what is left, and never leaves the draft in an invalid state.

## Tools

A **fixed, typed tool set** mapped one to one onto the CMS API. Each tool has a JSON Schema for its inputs (generated from the block schemas where relevant) and goes through the same validation and permissions as the GUI.

| Tool | Maps to |
| --- | --- |
| `list_templates` | Allowed templates for this site |
| `list_blocks` | Blocks allowed in a template, with prop schemas |
| `get_page` | Current draft JSON |
| `create_draft` | New page, or a new draft of an existing page |
| `add_block`, `move_block`, `remove_block` | Block list changes |
| `update_props` | Edit a block's props |
| `search_media`, `request_upload` | Find media, or ask the user to upload |
| `crop_media` | Propose a crop for a slot (the user still approves it) |
| `set_seo` | Page title, description, social image, canonical, noindex |
| `list_embeds` | Registered donation forms and embeds |
| `preview_screenshot` | Render the draft at a chosen width, return an image |
| `run_checks` | Speed, accessibility and SEO checks on the draft |
| `submit_for_review` | Hand the draft to an approver with a change summary |
| `remember` | Propose a site or user memory entry (see Memory) |

Admin screens add their own small sets (for example brand token and template tools), subject to the [allowlist](#per-instance-tool-allowlist).

**Never:** a publish tool, code execution, arbitrary HTML, CSS or script, arbitrary web fetch (apart from the user-given reference URL feature, when enabled), email, or file system access.

The tool list in [07-ai-agent.md](07-ai-agent.md) is the conversation-level view; this table is the reference.

## Context

The model gets a small, structured context, **filtered by screen and role**, built fresh for each turn:

| Context | Contents |
| --- | --- |
| Agent profile | The site's default instructions (see below) |
| Brand | Name, short description, tone of voice |
| Theme tokens | Token names and meanings (not raw CSS) |
| Block library | Schemas for the blocks allowed on this screen and template only |
| Templates | Allowed templates and their rules |
| Sitemap | Page titles and URLs, for linking and avoiding duplicates |
| Current page | Draft JSON (on New page and Edit page) |
| Site memory | Shared house knowledge |
| User memory | This user's preferences |

Anything not needed for the current screen is left out, which keeps prompts small, cheap and harder to misuse.

## Memory

Two small, visible stores:

- **Site memory** (shared by everyone on the site): tone of voice, house style (for example "always say 'rescue', never 'shelter'"), banned phrases, key facts (founding year, registered charity number, phone number).
- **User memory** (per person): preferences such as "keep my headlines short" or "I usually write news posts".

Rules:

- **Small.** A short list of entries, not a growing transcript.
- **Visible and editable in the GUI:** site memory in **Settings > AI** (admins edit, everyone can read), user memory in the **user menu**.
- **The agent proposes, people decide.** The agent can suggest a memory entry with `remember`; it shows in the AI panel and is saved when the user accepts. Users can see and delete their entries at any time.
- No hidden memory, and no memory of other users' conversations.

## Agent profile

Each site has one **default agent profile**: the base instructions on top of the fixed system prompt (for example "warm, hopeful, never graphic about injuries; UK English"). Admins edit it in **Settings > AI**. It cannot override the remit, guardrails or tool scoping, which live in the fixed system prompt and the API.

## Observability

- **Every tool call is logged against the draft** it changed: who asked, the request, the tool, inputs, result and validation errors. Reviewers can see how a draft was made.
- **Usage dashboard** in Settings > AI: tokens and cost by day, user, screen and model, with the caps above.
- Failed or cancelled turns are logged too, so problems with the loop can be found and fixed.

## Untrusted content

Text from uploads, embeds, reference URLs and even existing page content is treated as data, never as instructions. Anything in it that looks like an instruction to the AI is ignored, and the remit still applies.

## Open questions

- Exact wording of the decline-and-redirect message, and whether admins can tune it.
- Should "how do I use the builder" help be in scope (probably yes), and how far does it go?
- Do we log full prompts, or summaries only, for privacy?
- Cost cap defaults per site.
- Which tools ship switched off by default in the instance allowlist?
- Streaming UI: stream the agent's text and tool calls live to the panel and canvas, or show progress and apply per step?
- Should our tools also be exposed over MCP, so other agents and clients can use them (with the same scoping)?
- Is a vision-capable model required for the screenshot self-check, or is it optional with a checks-only fallback?
- Should approvers get the AI panel on Site parts? The docs currently say yes, but only editors and admins were named. To confirm.

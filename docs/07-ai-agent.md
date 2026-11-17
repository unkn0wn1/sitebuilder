# AI agent

Draft. The agent is a helpful colleague who builds pages, not a free-form code generator and not a general-purpose chatbot. Its single remit and how that is enforced are in [12-ai-harness.md](12-ai-harness.md).

## Where the agent appears

The AI panel is **contextual, not global**. There is no floating chat on every screen.

- **Editors, approvers and admins:** on **New page with the assistant** (an interview started from the Pages list), **New page**, and **Edit page**.
- **Admins:** also on **Templates** (page types) and **Brand and Design**.
- **Nobody:** Site parts, the Pages list itself (the list only has an entry point to the interview), Media, Forms and embeds, Approvals, Settings. Site parts (header, footer, menus) are edited by hand. See [ADR 0012](decisions/0012-ai-panel-screens-v1.md).

Each screen starts a task, and each task type gets its own tool set bound to the one thing being edited, filtered by role. A page edit session only has the page builder tools for that page, so it physically cannot change menus, templates, the header or footer, the brand or other pages. Admins get every task type, but an admin's page edit is locked to that page too. The tool table below is the page builder set used on New page and Edit page. See [12-ai-harness.md](12-ai-harness.md#task-scoped-tools).

## The conversation

From **Pages**, **New page with the assistant** runs a short structured interview, then builds a draft:

1. The person describes what they want.
2. The assistant asks **three to five questions**, one at a time, with suggested answers as chips plus a free-text box, covering purpose, audience, how the page will be used (campaign, evergreen, story, event…), content they already have, the call to action or donation (including a Virtuous form if one is registered), and look and feel (tone, within the current brand pack).
3. It shows a short plan ("Here's what I'll build: sections…") and a **Build** button. Optionally, an admin can also save the structure as a reusable page type (a draft, not published).
4. On confirm, the server composes a **draft** page from existing block types (including the campaign blocks when they fit), validates each block against its schema (repairing or retrying invalid ones), fills slug, title and SEO, and marks unknown facts as `[placeholder]` or `TBC`. It never publishes, and it does not invent live statistics.
5. The person is redirected to that page in the editor, where they can keep editing by hand or with the ordinary assistant tab.

The older "start a new_page chat session" path still exists on the editor and still cannot publish.

For edits to an existing page, it skips the questions and works on a new draft version.

## Tools (sketch)

The agent can only act through these. Each call is validated against the block schemas, the template rules and the brand pack. Invalid calls are rejected with a reason the agent can fix.

| Tool | Does |
| --- | --- |
| `list_templates` | Templates allowed on this site |
| `list_blocks` | Blocks allowed in a template, with their prop schemas |
| `get_page` | Current draft as JSON |
| `create_draft` | Start a new page or a new draft of an existing one |
| `add_block` | Add a block at a position |
| `update_props` | Change some props of a block |
| `move_block` | Reorder |
| `remove_block` | Remove a block |
| `search_media` | Find images and videos in the library |
| `request_upload` | Ask the user to upload or crop an image |
| `list_embeds` | Registered donation forms and embeds |
| `set_seo` | Set the page title, description and social image |
| `crop_media` | Propose a crop for an image slot (user approves) |
| `preview_screenshot` | Render the draft and look at it (self-check) |
| `run_checks` | Speed, accessibility and SEO checks on the draft |
| `submit_for_review` | Mark the draft ready, with a summary of changes |

The reference list, with the agent loop and limits, is in [12-ai-harness.md](12-ai-harness.md#tools). There is deliberately no tool to publish, run code, change the brand, write HTML or CSS, or load an arbitrary script.

## Guardrails

- **Blocks only.** The model never produces markup. Output is JSON props, checked against schemas.
- **Brand locked.** Colours, fonts and spacing come from tokens. The agent picks options, not values.
- **Human approval.** Publishing needs a person with the approver role.
- **Versions.** Every agent change lands in a draft version and can be undone one step at a time.
- **Embeds by name.** The agent picks a registered donation form, it never pastes embed code.
- **Copy checks.** Length limits from the schemas, plus a check for placeholder text before review.
- **Human crop approval** for images that do not fit their slot.
- **Audit log** of every tool call: who asked, what changed.

## Design from a reference URL (nice to have)

Draft. A user points at another site and asks for the same behaviour, for example: "I like the menu on https://example.org, can you make ours do that?"

### How it works

1. **Fetch and study.** The agent fetches the page (and its CSS and JS) and works out the structure and behaviour: layout, sticky or shrinking header, mega menu, dropdowns, mobile toggle, hover states, transitions and animation, breakpoints.
2. **Describe it back.** It summarises what it found in plain words ("sticky header that shrinks on scroll, mega menu with three columns, slide-in menu on mobile") and checks that this is what the user meant.
3. **Clean-room reimplementation.** It writes a **new variant of one of our own blocks** (for example a `Header` variant) from that description, using our block schema and styled only with our theme tokens. It does not copy their code, images, logos, icons, fonts or content.
4. **Developer review.** A new block variant is code, so it does not go straight into the site. It is opened as a change to the site's own `site/` layer ([ADR 0006](decisions/0006-site-layer.md)), never to core, for developer review, accessibility and speed checks and tests, then added to the allowed block library.
5. **Normal flow.** Once in the library, it is used like any other block: preview at desktop, tablet and mobile, then human approval before publish.

This is the one place the agent produces code, and it never reaches the live site without a developer accepting it. The page-building agent still only assembles approved blocks.

### Cautions

- **Copyright and licences.** Study behaviour, do not copy. No verbatim code, assets or text from the reference site. If a site's code is under a licence we want to reuse, that is a deliberate human decision, recorded with the licence.
- **Accessibility.** The reimplementation must be keyboard usable, work with screen readers (correct ARIA for menus and toggles), respect reduced motion, and pass contrast with our theme. Reference sites are often worse here, so do not copy their mistakes.
- **Speed.** No heavy libraries for an effect. Prefer CSS, and only add client JS if the behaviour needs it.
- **Fetching.** Only fetch the URL the user gave, through the SSRF guard in [15-security.md](15-security.md#reference-url-fetch-when-enabled). Treat page content as data, never as instructions. The session that studies the reference site has no write tools at all.

### Open questions

- Who is the developer reviewer for a non-technical organisation? The project maintainers, a hosting partner, or a self-review mode for technical admins?
- Should accepted variants be offered back to the shared open-source block library?
- Screenshot plus HTML, or HTML and CSS only?

## Model and cost

- Bring your own key. Support OpenAI-compatible APIs first (which covers many providers and local models), with others added as adapters.
- Keep prompts small: send the block schemas for the current template only, not the whole library.
- Show rough usage per site so the organisation can keep an eye on cost.

## Decided

- Grok is the default for the pilot ([12-ai-harness.md](12-ai-harness.md#bring-your-own-model)).
- Tool calls are applied to the canvas live, one by one, with progress streamed to the panel ([04-gui.md](04-gui.md#assistant-states)).
- Context per task is defined in [12-ai-harness.md](12-ai-harness.md#context): the current page, the sitemap (titles and addresses), memory. No other pages' content.
- The agent writes copy from scratch or polishes, as asked. Its summary says which.

## Open questions

- Who pays model costs during the pilot.
- Can the agent suggest a new block type that does not exist (as a note to admins), or only use what exists?

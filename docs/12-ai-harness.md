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

## Parts of the harness

| Part | What it does |
| --- | --- |
| System prompt | Remit, tone of voice from the brand pack, guardrails, how to ask questions and hand over for approval |
| Context | Only what the task needs: current page JSON, schemas for the blocks allowed in this template, brand tokens by name, registered embeds |
| Tools | The fixed list in [07-ai-agent.md](07-ai-agent.md). No publish tool, no raw HTML or CSS, no arbitrary fetch (the reference URL feature fetches only a URL the user gave, and treats its content as data) |
| Validator | Every tool call is checked against block schemas, template rules and the brand pack before it touches a draft. Rejections go back to the model with a reason |
| Draft sandbox | All changes land in a draft version, with per-change undo |
| Audit log | Every prompt, tool call and result is logged with who asked |
| Limits | Per-user and per-site rate limits and a cost cap, shown in Settings > Integrations |
| Model adapter | Bring your own key; OpenAI-compatible first, other providers as adapters |

## Untrusted content

Text from uploads, embeds, reference URLs and even existing page content is treated as data, never as instructions. Anything in it that looks like an instruction to the AI is ignored, and the remit still applies.

## Open questions

- Exact wording of the decline-and-redirect message, and whether admins can tune it.
- Should "how do I use the builder" help be in scope (probably yes), and how far does it go?
- Do we log full prompts, or summaries only, for privacy?
- Cost cap defaults per site.

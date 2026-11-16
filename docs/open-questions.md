# Open questions

Decisions still to make. The first seven come from the original research (Nov 2026), updated where a later decision has answered them. Each doc also has its own "Open questions" section.

## From the research

1. **Licence:** MIT everywhere, or AGPL for the builder app (with MIT for the block library and renderer)? To decide before the first public release.
2. **Spike scope:** is Puck's paid AI layer acceptable for a quick comparison spike, or should the spike stay fully open source?
3. **Pilot coexistence:** does the pilot site need to run alongside an existing WordPress site (some pages on a subpath or subdomain), or is a full switch the goal?
4. **AI provider:** which model provider is the default, and who pays model costs during the pilot?
5. **TLS and CDN:** ~~nginx plus Varnish on one server, or Cloudflare in front?~~ **Answered:** Cloudflare in front is mandatory, no Varnish. See [ADR 0002](decisions/0002-no-varnish-cloudflare-mandatory.md).
6. **Languages:** which languages beyond English for the pilot, and when?
7. **Name and home:** ~~where the repo lives~~ (answered: private repo under unkn0wn1 for now). The project name is still open.

## Added since

- Do we build our own Vue editor, or start from an existing one (for example Gissen or Page Composer)?
- Schema library for block props: JSON Schema, Zod or Valibot?
- SQLite only at first, or SQLite and Postgres from day one?
- Image renditions at upload time (sharp) or at generate time (Nuxt Image with IPX)?
- Which features are really must for v1? See the [feature inventory](10-essentials.md).
- How should the GUI work overall? See [04-gui.md](04-gui.md).
- Should approvers get the AI panel on Site parts, or only editors (New page, Edit page) and admins? See [12-ai-harness.md](12-ai-harness.md#contextual-not-global).
- AI harness questions (streaming UI, MCP for tools, vision model for self-check): see [12-ai-harness.md](12-ai-harness.md#open-questions).

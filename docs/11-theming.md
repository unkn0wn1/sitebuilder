# Theming

**Draft.** How the look of a whole site can change without touching its content.

## The idea

Pages are stored as structured JSON blocks: content and choices (`tone: "primary"`, `layout: "split"`), never colours, fonts, spacing or markup. See [03-block-model.md](03-block-model.md).

So the look of the site lives entirely in the **theme**:

- **Design tokens:** colours, fonts, type scale, spacing, radius, shadows, motion (the brand pack from the [setup wizard](06-setup-wizard.md) feeds these).
- **Block renderers:** the Vue component for each block type, which decides the markup and layout.

Change the active theme, rebuild the static output, purge Cloudflare, and the whole site has a new look with the same content, URLs and SEO.

```mermaid
flowchart LR
  Content[("Pages as JSON blocks<br/>(no styling)")] --> Gen["Static generator"]
  Theme["Active theme<br/>tokens + block renderers"] --> Gen
  Gen --> Release["New release folder"] --> Nginx["nginx"] --> CF["Cloudflare<br/>(full purge)"]
```

## Two levels

1. **Token-only themes:** same block renderers, different tokens. Cheap to make, safe, and the brand wizard can produce them. Good for colour and type changes.
2. **Full themes:** their own block renderers as well as tokens, for a genuinely different design. More work, and code, so they go through developer review.

A theme could likely be a Nuxt layer that overrides block components and provides tokens. To be decided.

## Uses

- **Demos:** show two or three versions of the same site, from the same content, to let people pick a favourite (the first pilot plan in [09-roadmap.md](09-roadmap.md)).
- **Redesigns:** build and preview a new theme against the live content, then switch in one publish, with rollback to the previous release.
- **Seasonal or campaign looks:** later, perhaps.

## Previewing a theme

- Preview any page (or the whole site, on a preview hostname) with a non-active theme, using the normal desktop, tablet and mobile toolbar.
- Switching the live theme is an admin action that goes through approval like any other publish, triggers a full rebuild and a full Cloudflare purge.

## Caveats

- **Every theme must cover every block** in the library, or declare a fallback (usually the default theme's renderer, styled with its own tokens). The build should fail, or warn loudly, if a block has no renderer.
- **Block props are shared across themes.** A theme cannot require props other themes do not have. If a theme needs a new option, it becomes part of the block schema with a sensible default.
- **Image slot sizes may differ between themes** (a tall hero in one, a wide one in another). Required crops then need re-approving for the new theme. The crop data model keys crops by slot size so both can coexist.
- **Speed and accessibility** checks apply to every theme, not just the default one.
- **Full rebuild** on switch, so larger sites take longer to publish.

## Open questions

- Is a theme a Nuxt layer, a folder in the repo, or an installable package?
- Should the builder UI follow the site theme, or always use its own neutral look?
- Can different sections of a site use different themes (for example a campaign microsite), or one theme per site?
- How are third-party themes reviewed if the project becomes open source?

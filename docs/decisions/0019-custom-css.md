# 0019: Custom CSS

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

The principles used to say the AI never writes CSS. People still need a small way to adjust a section, or the whole site, without a new theme. Number 0017 was never used. This record is 0019 so that gap stays visible.

Roles in this app are a minimum-role ladder, not per-person grants. An action allowed for admins cannot be handed to one approver.

## Decision

- **Author text on the block.** A section stores `css` beside `props` (at most 8 KB), not inside `props`. The brand stores site-wide `customCss` (at most 32 KB). Old documents without the field stay valid. The schema version does not change.
- **One sanitiser, twice.** The text is checked on save (a rejection names the line and column and does not echo the source) and again when the page is rendered. Section CSS is prefixed with that section's id at render, including keyframe names. The stored text is not rewritten, so duplicating a section copies the author's text and the new id is applied only at render. Site CSS is not prefixed.
- **`design.css` is admin only.** It covers section CSS and the brand sheet. Because roles are a ladder, an approver cannot be given it.
- **Agents may draft section CSS only.** The gateway tool is `set_block_css` (rule action `edit_css`). It always needs a person, after any deny rule and the floor, and before always-allow and publish rules, including a rule whose actions are `"*"`. A deny rule refuses the draft. Presets do not publish it. `get_page` returns the author's text. Site-wide agent CSS is deferred: there is no tool. The builder assistant still has no CSS tool (`write_css` stays a never-tool).
- **Style order.** Theme CSS, then shell CSS, then site CSS, then each section's CSS. Site CSS is published and rolled back with the brand.

## Consequences

- A build from before this feature rejects documents that contain `css` or `customCss`, because the block and brand schemas are strict. Old documents without those fields stay valid. Rollback of the app, not of a published release, is the risk: the HTML already built does not need the new fields.
- Approving or publishing a review that changes section CSS or brand `customCss` needs an admin (`design.css`).
- Removing a whole section that has CSS is an ordinary section removal. It can still publish under an `edit_sections` rule. Changing the CSS text cannot.
- `position: fixed` is allowed. It can cover the page. The review shows a line diff and a warning. The prefix does not stop a fixed box inside the section from painting over the rest of the viewport.
- The gateway decision order in [ADR 0018](0018-agent-gateway.md) gains the custom-CSS step. The current order is in [agent-gateway.md](../agent-gateway.md#rules).

# Setup wizard

Draft. The wizard is what makes every later page look right. It runs once when a site is created, and admins can re-run any step later. Progress is saved after each step, so it can be finished over several sittings. In v1 it is **forms first** (with a live preview), not chat-driven.

The output is the **brand pack**: a locked set of choices that editors and the agent work inside but cannot change.

## Step 1: Brand

- Organisation name, short description and tone of voice (used by the agent when it writes copy).
- Logo (SVG preferred) and favicon.
- Colours: primary, secondary, accent, neutrals. The wizard checks contrast and warns about pairs that fail accessibility checks.
- Fonts: a short curated list of fast, self-hosted fonts, with heading and body choices. No third-party font loading.
- Shape and feel: corner radius, spacing scale, button style.
- Optional: start from an existing site's colours and logo.

These become design tokens (a Tailwind theme) used by every block.

## Step 2: Shell and menus

- Header style (from a few options), main menu items and order.
- Footer content: contact details, social links, legal links, registered charity details.
- Page tree: home and the main sections.
- Optional site-wide banners (for example an appeal strip).

## Step 3: Allowed templates and blocks

- Pick which page templates staff can use (for example Home, Standard, Campaign or donation, Story, News post, Event).
- For each template, choose which blocks are allowed and any required blocks (a campaign page must include a donation embed, for example).
- Register donation forms and other embeds (for example Virtuous form IDs) so editors and the agent can pick them by name rather than pasting code. After setup, approvers can register more forms in **Forms and embeds**, but only from domains on the admin allow-list (Settings > Security).

## Step 4: Integrations

- AI model provider and key (bring your own).
- Cloudflare zone and API token for cache purge (Zone, Cache Purge only), required before first publish. The wizard checks that the origin only accepts Cloudflare and that Cloudflare Access protects the builder ([ADR 0007](decisions/0007-single-site-install.md)).
- Email: connect a Google Workspace account (for example noreply@) for invites, password resets and approval emails ([ADR 0015](decisions/0015-gmail-workspace-mail.md), [16-operations.md](16-operations.md#email)).
- Allowed embed domains.
- Tracking and consent by id (GA4, Tag Manager, Plausible, Cookiebot) ([ADR 0011](decisions/0011-named-tracking-integrations.md)).
- Workflow: "How many people approve changes?" If one, self-approval is switched on ([ADR 0005](decisions/0005-rollback-and-approval.md)).

## Step 5: Preview and finish

- Shows a sample home page and a sample campaign page using the brand pack.
- Admin confirms, and the brand pack is locked.

## Decided

- Forms first in v1. A chat-driven wizard may come later.
- Cloudflare setup is checked by the install script and confirmed in Step 4 before the first publish.
- One brand pack per site in v1.

## Open questions

- How many header and footer styles to offer at first?

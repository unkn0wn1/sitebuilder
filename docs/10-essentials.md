# CMS feature inventory (draft, to discuss)

**Priorities are proposals, but several items are now decided by the ADRs and are marked as such.** This is a thorough list of what a site builder CMS needs, even a simple one, so nothing important is missed when designing the GUI. Each item has a one-line description, a suggested priority and where it would live in the builder. Priorities and placements are proposals for discussion.

In the spirit of doing one thing well, the list is deliberately lean. Anything that turns the builder into a general platform is a [non-goal](#non-goals).

**Priority key:** **must** = needed for v1 (a real site cannot go live without it), **nice** = v1 if cheap, otherwise soon after, **later** = after v1.

**GUI key** refers to the left nav in [04-gui.md](04-gui.md): Pages, Site parts, Media, Forms and embeds, Approvals, Brand and Design, Page types (templates), Settings, plus the page editor and the top bar.

## Content

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Pages | Create, edit, duplicate, delete (to bin) pages made of blocks | must | Pages > list, page editor |
| Pages list | Paginated list with search, filter by status and template, last edited by and when | must | Pages |
| Page tree and slugs | Parent and child pages, URL slugs, change slug with redirect offer | must | Pages (list and page settings) |
| Header | Site-wide block: logo, main menu, call to action button | must | Site parts > Header |
| Footer | Site-wide block: contact, links, social, legal and registration details | must | Site parts > Footer |
| Menus and navigation | Ordered menu items linking to pages or URLs, one dropdown level at most | must | Site parts > Menus |
| Templates | Page types with allowed and required blocks (Home, Standard, Campaign, Story, News) | must | Templates (admin), picked in New page |
| Reusable blocks | A block saved once and used on many pages (for example a donate panel); edit once, updates everywhere | nice | Site parts > Reusable blocks |
| News or posts | Dated posts with a listing page and simple categories | nice | Pages (as a template with a listing block) |
| Site banner | Site-wide announcement strip, on or off, with dates | nice | Site parts > Banner |

## Media

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Media library | Grid of images and videos with search and filter | must | Media |
| Upload | Drag and drop upload, also from the editor and the AI panel | must | Media, editor image fields, AI panel |
| sharp variants | Auto-resize to several widths, AVIF and WebP, strip metadata | must | Automatic (status shown in Media) |
| Alt text | Required alt text per image (or marked decorative), agent can suggest it | must | Media item panel, editor image field |
| Required-size crops | Crop rectangle locked to a slot's ratio, user must approve | must | Editor image field, Media item panel |
| Focal point | Mark the important part of an image for default crops | nice | Media item panel |
| Video | Upload short videos with a poster image, background video for heroes | nice | Media, Hero block |
| Video transcoding | Compress and convert video automatically (ffmpeg) | later | Automatic |
| Crop wizard | Different crops per breakpoint (art direction) | later | Media item panel |
| Usage and cleanup | See where a media item is used, find unused items | later | Media item panel |

## Brand and theme

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Setup wizard | Brand, then shell and menus, then allowed templates | must | First run, re-run steps from Brand |
| Brand pack | Locked colours, fonts, logo, shapes as design tokens | must | Brand |
| Contrast checks | Warn when colour pairs fail accessibility contrast | must | Brand |
| Alternative brand packs | Try a different look on the same content (for demos and redesigns) | nice | Brand > Variants |

## SEO

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Page meta | Title (with site pattern), meta description | must | Page editor > Page tab > SEO |
| Social image | Open Graph and Twitter card image, defaults to the hero, cropped to 1200 x 630 | must | Page editor > Page tab > SEO |
| Canonical and noindex | Canonical URL and a noindex toggle per page | must | Page editor > Page tab > SEO |
| sitemap.xml | Generated on publish from indexable pages | must | Automatic (view in Settings > SEO) |
| robots.txt | Sensible default, editable by admins | must | Settings > SEO |
| Redirects | Old path to new path table (301 or 302), output to nginx on publish | must | Settings > Redirects |
| Structured data | JSON-LD for the organisation (for example NGO or Organization), breadcrumbs, articles, events | nice | Automatic from blocks and Settings > SEO |
| SEO checks | Warn about missing titles, descriptions, duplicate titles, broken links | nice | Review screen, page editor |

## Users, roles and auth

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Sign in | Email and password with strong hashing, or magic link | must | Sign-in screen |
| Second factor | Cloudflare Access in front of the builder (required, ADR 0007) gives an email code or Google or Microsoft sign-in | must | Set up at install |
| In-app TOTP | TOTP inside the builder as well | later | User menu > Security |
| Users | Invite, deactivate, reset | must | Settings > Users |
| Roles | Editor, Approver, Admin with fixed permissions, plus an Operator flag for hosting partners (ADR 0007) | must | Settings > Users |
| Custom permissions | Finer roles (per section, per template) | later | Settings > Users |

## Workflow

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Drafts | Every change lands in a draft, the live page is untouched | must | Page editor |
| Review | Submit for review with a note, approver sends back or approves | must | Page editor, Approvals |
| Publish | Approve and publish: build, atomic deploy, Cloudflare purge, with progress | must | Approvals > Review |
| Unpublish | Take a page offline (with optional redirect) | must | Pages list, page editor menu |
| Self-approval | Off by default, on if the wizard is told one person approves. Checks still apply, release marked self-approved (ADR 0005) | must | Settings > Workflow |
| Scheduled publish | Publish or unpublish at a set date and time | nice | Review screen, page editor |
| Concurrent editing | Show who else is editing; conflicts only on the same field, resolved by the person (no locks) | must | Page editor |
| Autosave | Every change saved within a second, with offline buffering | must | Page editor |

## History and audit

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Version history | Every save is a version, with who, when and a summary | must | Page editor > History |
| Rollback | Preview an old version, then approve it as the new live version | must | Page editor > History |
| Site rollback | Switch the whole site back to an earlier release; database follows the release manifest; admins can do it alone in an emergency, logged (ADR 0005) | must | Settings > Publishing |
| Audit log | Who did what, including every agent tool call | must | Settings > Activity |
| Bin | Deleted pages and media kept for a time before removal | nice | Pages > Bin, Media > Bin |

## AI chat agent

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| AI panel | Contextual agent that asks a few questions and builds drafts from blocks; no global chat | must | New page and Edit page (editors and up); also Page types and Brand and Design (admins). Not on Site parts (ADR 0012) |
| New page by chat | Start a page from a conversation instead of a blank template | must | Pages > New page |
| Per-change undo | Undo any single agent change | must | AI panel, page editor |
| AI settings | Provider, model and key (bring your own), usage display | must | Settings > Integrations |
| Task-scoped tools | Each AI task (new page, page edit, template, brand and design) gets its own tool set bound to its target; admins get every task type, but each session stays bound, page edits included | must | Enforced by the API |
| AI feature switches | Site-wide setting to turn off individual AI features (for example AI media upload) | later / maybe | Settings > AI |
| Copy help | Suggest headlines, SEO text and alt text | nice | AI panel, field-level "suggest" buttons |
| Site-wide agent | Ask for changes across pages ("update the phone number everywhere") | later | To decide (no global chat; maybe an admin-only screen) |

## Forms and embeds

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Donation form embeds | Register Virtuous (or similar) forms by name, place with a block | must | Forms and embeds, DonationEmbed block |
| Embed allow-list | Only allowed domains may load scripts or iframes | must | Settings > Security (admin) |
| Generic embeds | Video, maps and similar from allowed providers | nice | Forms and embeds, Embed block |
| Contact and volunteer forms | v1: embed an allow-listed form tool (for example Virtuous, Tally or Google Forms). A native form needs a server endpoint and is not planned | must (as embed) | Forms and embeds, Embed block |

## Site settings

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Site name and domain | Site name, primary domain, title pattern | must | Settings > General |
| Favicon and app icons | Generated from the logo, with an override | must | Brand (from logo), Settings > General |
| 404 page | On-brand not-found page built from blocks | must | Pages (system page) |
| Analytics and tag manager | Named integrations by id (GA4, Tag Manager, Plausible), no raw snippet slot (ADR 0011) | must | Settings > Tracking and consent |
| Cookie consent | Cookiebot by id to start with; tracking waits for consent (Consent Mode defaults to denied) | must | Settings > Tracking and consent |
| Languages | Locale-aware data model from day one; translated pages and a language switcher later | later | Settings > Languages, page editor language switch |
| Legal pages | Starter privacy and cookies pages to adapt | nice | Pages (from templates) |

## Quality: search, accessibility and speed

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Builder search | Find pages, media and blocks inside the builder | must | Top bar |
| Site search | Visitor search on the public site (static index, for example Pagefind) | nice | Search block, Settings > General |
| Accessibility checks | Alt text, heading order, contrast, link text, checked before review | must | Review screen, page editor warnings |
| Speed advisor | Lighthouse on the preview with plain-English hints and a budget | must | Preview toolbar, review screen |
| Site speed scan | Scheduled Unlighthouse scan of the whole live site | nice | Settings > Performance (dashboard) |

## Operations

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| Cloudflare purge | Purge changed URLs on publish, everything on shell changes | must | Automatic, set up in Settings > Integrations |
| Publish log | List of releases with status and errors | must | Settings > Publishing |
| Backups | Scheduled backup of database and media, off-site | must | Settings > Backups (status), set up on the server |
| Export | Download all content (JSON) and media as one archive | must | Settings > Backups |
| Import | Restore from an export; import from WordPress | later | Settings > Backups |
| Health | Builder version, disk space, last publish, last backup, job queue (operators) | must | Settings > System |

## Notifications

| Feature | Description | Priority | Where in the GUI |
| --- | --- | --- | --- |
| In-app notifications | Review requested, sent back, published, publish failed | must | Top bar bell, Approvals badge |
| Email notifications | Review requested, sent back, published, publish failed, emergency rollback; non-security ones can be turned off per user ([16-operations.md](16-operations.md#email)) | must | User menu > Notifications |
| Share preview | Expiring, revocable preview link for people without an account | nice | Preview toolbar |
| Chat or webhook notifications | Send events to Slack, Teams or a webhook | later | Settings > Integrations |

## Non-goals

Explicitly out of scope, to keep the project focused (see also [00-vision.md](00-vision.md#non-goals)):

- Plugin marketplace or runtime plugin installs
- Payments, donations processing, ecommerce, shops, carts
- Visitor accounts, memberships, paywalls, member areas
- Comments, forums, community features
- Built-in CRM, email marketing or newsletters
- Arbitrary custom code or scripts on pages (beyond allow-listed embeds and named tracking integrations; see [ADR 0011](decisions/0011-named-tracking-integrations.md))
- A general-purpose headless CMS for other apps
- Per-request server rendering of public pages

## Decided

- Cookie consent: named integrations (Cookiebot first), no built-in banner in v1.
- Redirects: nginx map in v1.
- Sign in: Cloudflare Access in front plus the builder's own email and password. Magic links later.
- Contact forms: embeds in v1; a native form is not planned.

## Open questions

- Is the must list still too long for a first version? What could move to nice?
- Reusable blocks: must or nice? They save a lot of repeated edits.
- Is a news or posts feature in scope for v1, or soon after?

# Candidate essentials (draft, to discuss)

**Nothing here is decided.** These are examples of the small, unglamorous features a real site probably needs, collected to help think through what v1 must include and how it might shape the GUI. Each one is a candidate, to be kept, changed or dropped after discussion.

## Global header and footer

- The header (logo, main menu, call to action button such as "Donate") and the footer (contact details, links, social, legal and registration details) are **site-wide blocks**.
- Edited in one place (**Header and footer** in the builder) and used on every page.
- Same block model, versions and approval flow as pages. A change triggers a full-site publish and a full Cloudflare purge.
- Menus: ordered items, one level of dropdowns at most, links to pages or external URLs.
- A template can opt out (for example a focused landing page with a minimal header).

## Pages list

- Paginated list of all pages.
- Search by title or slug, filter by status (draft, in review, published) and template.
- Shows status, last edited (when and by whom) and the live URL.
- Actions: open, preview, duplicate, unpublish, delete (deleted pages go to a bin first).

## Per-page SEO and meta

Each page has an SEO panel with sensible defaults filled in automatically:

- Title (with a site-wide pattern, for example `Page title | Site name`).
- Meta description, with a length guide.
- Open Graph and Twitter card image (defaults to the hero image, cropped to 1200 x 630 through the normal crop approval).
- Canonical URL (defaults to the page's own URL).
- `noindex` toggle (for thank-you pages, test pages and similar).

The agent can suggest a title and description, and the speed advisor warns if they are missing.

## Site-wide SEO files

- **sitemap.xml**, generated on every publish from published, indexable pages.
- **robots.txt**, generated with a sensible default and editable by admins. Points to the sitemap.
- **Redirects**: a simple table of old path to new path (301 or 302), output as an nginx include on publish. When a page's slug changes, the builder offers to add a redirect automatically.
- **Favicon** and app icons, generated from the logo in the setup wizard (with an optional override).
- **404 page**, built from blocks like any other page, on-brand.

## Third-party slots

- **Analytics or tag manager snippet slot** (for example GTM or a privacy-friendly analytics tool). Admin-only, one place for site-wide head and body snippets, from allow-listed domains.
- **Cookie consent slot.** A place to plug in a consent banner, and a rule that analytics and marketing snippets only load after consent where required.

These slots are the only place site-wide scripts can be added, and only by admins. This keeps the speed and security story intact.

## Open questions

- Do we ship a simple built-in cookie consent banner, or only a slot for a third-party one?
- Redirects: nginx include only, or also mirrored as Cloudflare rules?
- How deep can menus go (one dropdown level or none)?
- Should the bin auto-empty after a set time?

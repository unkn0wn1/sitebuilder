# Admin redesign (November 2026)

**Decided with Spencer, 21 Nov 2026.** This updates the look and feel in [04-gui.md](04-gui.md). The rules there still
hold: plain words, one main action per screen, status always visible, and hiding what a user can't use.

## What was wrong

- Each screen had its own layout. Some were tables, some were forms with no headings, and some used a bare grey sidebar.
- Things weren't where people looked for them. The top strip ("Report an ill or injured animal…") is a separate
  *Banner* site part, listed last as "Site banner", so nobody found it from the header. The menu look could be chosen
  in two places (Brand and Design, and a "fallback" on the header), and only one of them did anything.
- The site-part previews were hand-written copies. They wrapped the site name onto four lines, cut the menu off, and
  never matched the live site.
- On a phone, the navigation was a wrapped row of links and the theme switch collapsed to a dash.

## Principles

1. **Show the real thing.** Every preview (pages, header, top strip, menus, footer) is drawn by the publish
   renderer, the same way as the page editor. If it looks right in the builder, it looks right live.
2. **Cards in a reflowing grid, never scrolling boxes or carousels.** Lists of pages, site parts, page types, forms
   and settings are cards that wrap from one column on a phone to three or four on a wide screen. The page scrolls;
   boxes inside it don't.
3. **One place for each choice.** The menu look lives on the Header with the choice of menu. Brand and Design is
   colours, type and logos, with one exception: an advanced custom CSS card for the whole site. That card is admin only.
4. **The header screen covers the whole top of the page.** That's the top strip, the bar, which menu, the menu
   look, the button and the small link. Spencer looks there for the strip, so that's where it is.
5. **Calm surfaces, one accent.** Neutral greys, white cards with a hairline border and a soft shadow, rounded
   corners (12 px), the accent only on the main action and the current place. Dark mode uses the same structure.

## Building blocks

All of these live in `app/components/ui/` and are auto-imported as `Ui…`:

| Component | Use |
| --- | --- |
| `UiPageHeader` | Title, one line of help, actions on the right; wraps on phones. Every list screen starts with it. |
| `UiCard` | The surface. Optional title, help and actions slot; `to` makes the whole card a link. |
| `UiCardGrid` | `grid-cols-1 sm:2 xl:3 (2xl:4)`. Reflowing, no fixed heights. |
| `UiEmptyState` | Icon, one sentence and the one action that fixes it (for example "New page"). |
| `UiSection` | A titled group of fields inside an editor panel, with an optional on/off switch in its header. |
| `UiSegmented` | A small segmented control (devices, light or dark), used in place of button groups. |
| `UiIcon` | A small inline SVG set (no icon font, nothing from a CDN). |

`BuilderStatusBadge` keeps its words and gets a dot plus softer colours.

## Shell

- **Desktop:** a fixed sidebar (15 rem). The site name sits on top with a "View live" link. Navigation comes next in
  three groups: *Content* (Pages, Site parts, Media, Forms and embeds), *Review* (Approvals, with a count) and
  *Design and setup* (Brand and Design, Page types, Settings). The person comes last, with initials, a light, dark or
  system switch, and Sign out.
- **Editors** (page and site part) use the whole width. The sidebar folds to an icon rail so the canvas has room.
- **Phone:** a slim top bar with the site name and a menu button that opens the same sidebar as a sheet over the
  page. There are no wrapped link rows.

## Screens

- **Pages:** cards showing the title, address, status, page type and last edit, with search and a status filter
  above. The Bin stays a link.
- **Site parts:** three groups.
  - *Top of every page:* the Header card, whose summary shows the top strip, the menu and its look.
  - *Menus:* one card per menu, with its first items and where it's used ("Header", "Footer links", "Not used").
    "New menu" is here.
  - *Bottom of every page:* the Footer.
- **Site part editor:** the same shape as the page editor.
  - A slim top bar holds Back, the name, status, save state, the device switch, which page to preview on, and Submit.
  - The real page fills the canvas; the fields sit in a right-hand panel made of `UiSection`s.
  - The header panel has these sections:
    1. **Top strip:** on or off, message, link and colour. This edits the banner part.
    2. **Menu:** which menu (with "Edit this menu"), plus the menu look as four option cards.
    3. **Button.**
    4. **Small link next to the menu.**
    5. **Appearance:** light or dark, and see-through over the top picture.
  - When both the header and the strip have changes, Submit sends both; each still gets its own approval card.
  - Menu: items are cards with their sub-items inside. Picking an item opens its panel in the preview, so mega
    panels can be checked.
  - Footer: the preview starts scrolled to the footer.
- **Approvals:** cards for waiting changes, with who, when and what. The review screen keeps the rendered preview and
  gets the same top bar style.
- **Settings:** a card grid of areas. Each area page has the same header and a wrapping row of area links (no side scroller).
- **Empty states:** every list says what goes there and offers the one action that starts it.

## Data decisions

- **The top strip stays its own site part (`banner`).** Its own approval, its own release entry, and published output
  unchanged. Only where it's edited moves (into the Header screen). Folding it into the header document would change
  stored data and need a migration for no gain to the visitor.
- **The menu look moves to the header (`header.style`).** The renderer now prefers the header's look and falls back
  to the brand pack's `menuStyle` (kept in the schema, no longer shown) only when there is no header. On the sample site
  both are `mega`, so published output is unchanged.
- **New `POST /api/v1/site-parts`** creates a menu or a top strip (both start off or empty, never live).
- **New `POST /api/v1/preview/site-part`** draws a live page with draft site parts swapped in, using the same
  preview HTML rules as the page canvas (builder photo and script routes, no analytics, a strict CSP).

## Built (notes from the build)

- **Styles.** flowbite-vue ships its own compiled copy of the utilities. Unlayered, it beat every Tailwind utility
  (`hidden sm:inline`, `grid lg:hidden`, `p-0 py-2.5` all resolved the wrong way). It now sits in a `flowbite`
  cascade layer between Tailwind's `base` and `utilities`, and Tailwind scans flowbite-vue so its classes are
  generated and ordered with ours. The old hand-restated breakpoint rules are gone.
- **Shell.** A fixed sidebar (Content, Review, Design and setup), an icon rail in the page and site-part editors,
  and a top bar with a sheet on phones.
- **Shared pieces** in `app/components/ui`: PageHeader, Card, CardGrid, EmptyState, Section (with an on/off
  switch), Segmented, Icon.
- **One menu picker.** The Header screen picks the menu and its look; Brand and Design only points there.
- **Custom CSS.** Admins get a closed Custom CSS disclosure on the section inspector, an outline badge `{ }` when a section has some, and a Custom CSS (advanced) card on Brand and Design. That card is the exception to "colours, type and logos". Site CSS is published with the brand. See [ADR 0019](decisions/0019-custom-css.md).
- **Settings** areas are listed once (`app/utils/settings-areas.ts`) for the grid and for the area navigation.

---
title: API
---

# Agent API

Generated from `docs/agent-gateway-openapi.json`. This reference lists **40** operations. The count is produced by the generator.

| Method | Path | Summary |
| --- | --- | --- |
| `GET` | `/site` | Start here: the site, what this token may do, and what no agent may ever do. |
| `GET` | `/pages` | List the pages of the site, with their address, type and state. |
| `GET` | `/page` | Read one page: every section with its id, text, rich text as markdown and links. |
| `GET` | `/site-part` | Read the header, footer, a menu, or the banner. |
| `GET` | `/components` | The section types a page can be built from, with guidance and the exact props of each. |
| `GET` | `/page-types` | The page types (templates) and which sections each allows or requires. |
| `GET` | `/search` | Find words anywhere on the site: every page, the header, footer, menus and banner. |
| `GET` | `/links` | Find every link to an address across the whole site, including buttons, menus and the footer. |
| `GET` | `/changes` | Your recent changes and their state. |
| `GET` | `/changes/{change_id}` | One change: its state and what it does. |
| `GET` | `/changes/{change_id}/preview` | Show exactly what an open change would do, and whether it could go live by itself. Changes nothing. |
| `POST` | `/edits/text` | Replace words on one page, or everywhere on the site. |
| `POST` | `/edits/remove-link` | Take a link down: remove every link to an address on a page or the whole site. |
| `POST` | `/edits/replace-link` | Point every link to one address at a different address. |
| `POST` | `/edits/insert-rich-text` | Add paragraphs, headings or lists to a text section, written in simple markdown. |
| `POST` | `/edits/component` | Change props of one section, for example a heading, button or list of cards. |
| `POST` | `/edits/block-css` | Set or clear the custom CSS on one section. |
| `POST` | `/edits/add-component` | Add a section to a page. |
| `POST` | `/edits/remove-component` | Remove one section from a page. |
| `POST` | `/edits/move-component` | Move a section up or down a page. |
| `POST` | `/edits/page-details` | Change a page's title, address, or search-engine title and description. |
| `POST` | `/edits/create-page` | Create a new page as a draft. |
| `POST` | `/edits/create-pages` | Build several new pages (and menu entries) as one draft change. |
| `POST` | `/edits/menu/remove-item` | Remove an item from a menu. |
| `POST` | `/edits/menu/add-item` | Add an item to a menu. |
| `POST` | `/edits/menu/rename-item` | Change the words on a menu item. |
| `POST` | `/edits/menu/set-tile` | Set or clear a photo tile on a mega-menu sub-item. |
| `POST` | `/edits/banner` | Show, change or hide the site-wide banner. |
| `POST` | `/edits/header` | Change the header small link, see-through setting, or the heart on the existing Donate button. |
| `POST` | `/edits/footer` | Change the footer words, contact, social links, tagline, layout, menus or charity number. |
| `GET` | `/media` | List photos and videos in the media library, newest first. |
| `POST` | `/media/imports` | Import a photo into the media library from a public address (runs in the background). |
| `GET` | `/media/imports/{import_id}` | See whether a photo import has finished, and get its media_id. |
| `POST` | `/media/{media_id}/alt` | Set the alt text of a photo in the library (or mark it decorative). |
| `POST` | `/changes/{change_id}/request-publish` | Send a change to a person for approval. It does NOT go live until they approve. |
| `POST` | `/changes/{change_id}/publish` | Make a change live NOW if a rule allows it; otherwise send it for approval. |
| `POST` | `/changes/{change_id}/discard` | Throw away an open change you do not want. Live pages are untouched. |
| `POST` | `/changes/{change_id}/undo` | Undo a change that went live: restore the earlier content as a new change. |
| `POST` | `/soul` | Propose a new AI personality. A person must approve it. |
| `POST` | `/plugins` | Propose a plugin. A person must approve it. |

The same operations are the tools in [Tools](/reference/tools). Nothing here is copied by hand.

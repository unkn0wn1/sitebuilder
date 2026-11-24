---
title: Tools
---

# Agent tools

Generated from `docs/agent-gateway-tools.md`. This reference lists **40** tools. The count is produced by the generator.

| Tool | Kind | REST | What it does |
| --- | --- | --- | --- |
| `get_site` | read | `GET /agent/v1/site` | Start here: the site, what this token may do, and what no agent may ever do. |
| `list_pages` | read | `GET /agent/v1/pages` | List the pages of the site, with their address, type and state. |
| `get_page` | read | `GET /agent/v1/page` | Read one page: every section with its id, text, rich text as markdown and links. |
| `get_site_part` | read | `GET /agent/v1/site-part` | Read the header, footer, a menu, or the banner. |
| `list_components` | read | `GET /agent/v1/components` | The section types a page can be built from, with guidance and the exact props of each. |
| `list_page_types` | read | `GET /agent/v1/page-types` | The page types (templates) and which sections each allows or requires. |
| `search_content` | read | `GET /agent/v1/search` | Find words anywhere on the site: every page, the header, footer, menus and banner. |
| `find_links` | read | `GET /agent/v1/links` | Find every link to an address across the whole site, including buttons, menus and the footer. |
| `list_changes` | read | `GET /agent/v1/changes` | Your recent changes and their state. |
| `get_change` | read | `GET /agent/v1/changes/{change_id}` | One change: its state and what it does. |
| `preview_change` | read | `GET /agent/v1/changes/{change_id}/preview` | Show exactly what an open change would do, and whether it could go live by itself. Changes nothing. |
| `edit_text` | draft | `POST /agent/v1/edits/text` | Replace words on one page, or everywhere on the site. |
| `remove_link` | draft | `POST /agent/v1/edits/remove-link` | Take a link down: remove every link to an address on a page or the whole site. |
| `replace_link` | draft | `POST /agent/v1/edits/replace-link` | Point every link to one address at a different address. |
| `insert_rich_text` | draft | `POST /agent/v1/edits/insert-rich-text` | Add paragraphs, headings or lists to a text section, written in simple markdown. |
| `edit_component` | draft | `POST /agent/v1/edits/component` | Change props of one section, for example a heading, button or list of cards. |
| `set_block_css` | draft | `POST /agent/v1/edits/block-css` | Set or clear the custom CSS on one section. |
| `add_component` | draft | `POST /agent/v1/edits/add-component` | Add a section to a page. |
| `remove_component` | draft | `POST /agent/v1/edits/remove-component` | Remove one section from a page. |
| `move_component` | draft | `POST /agent/v1/edits/move-component` | Move a section up or down a page. |
| `set_page_details` | draft | `POST /agent/v1/edits/page-details` | Change a page's title, address, or search-engine title and description. |
| `create_page` | draft | `POST /agent/v1/edits/create-page` | Create a new page as a draft. |
| `create_pages` | draft | `POST /agent/v1/edits/create-pages` | Build several new pages (and menu entries) as one draft change. |
| `remove_menu_item` | draft | `POST /agent/v1/edits/menu/remove-item` | Remove an item from a menu. |
| `add_menu_item` | draft | `POST /agent/v1/edits/menu/add-item` | Add an item to a menu. |
| `rename_menu_item` | draft | `POST /agent/v1/edits/menu/rename-item` | Change the words on a menu item. |
| `set_menu_item_tile` | draft | `POST /agent/v1/edits/menu/set-tile` | Set or clear a photo tile on a mega-menu sub-item. |
| `set_banner` | draft | `POST /agent/v1/edits/banner` | Show, change or hide the site-wide banner. |
| `set_header` | draft | `POST /agent/v1/edits/header` | Change the header small link, see-through setting, or the heart on the existing Donate button. |
| `set_footer` | draft | `POST /agent/v1/edits/footer` | Change the footer words, contact, social links, tagline, layout, menus or charity number. |
| `list_media` | read | `GET /agent/v1/media` | List photos and videos in the media library, newest first. |
| `import_media` | draft | `POST /agent/v1/media/imports` | Import a photo into the media library from a public address (runs in the background). |
| `get_media_import` | read | `GET /agent/v1/media/imports/{import_id}` | See whether a photo import has finished, and get its media_id. |
| `set_alt_text` | draft | `POST /agent/v1/media/{media_id}/alt` | Set the alt text of a photo in the library (or mark it decorative). |
| `request_publish` | decide | `POST /agent/v1/changes/{change_id}/request-publish` | Send a change to a person for approval. It does NOT go live until they approve. |
| `publish_change` | decide | `POST /agent/v1/changes/{change_id}/publish` | Make a change live NOW if a rule allows it; otherwise send it for approval. |
| `discard_change` | decide | `POST /agent/v1/changes/{change_id}/discard` | Throw away an open change you do not want. Live pages are untouched. |
| `undo_change` | decide | `POST /agent/v1/changes/{change_id}/undo` | Undo a change that went live: restore the earlier content as a new change. |
| `update_soul` | draft | `POST /agent/v1/soul` | Propose a new AI personality. A person must approve it. |
| `propose_plugin` | draft | `POST /agent/v1/plugins` | Propose a plugin. A person must approve it. |

Field-by-field descriptions stay in the repository source. This page is regenerated by `npm --prefix docs-site run build`.

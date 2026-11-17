# 0012: Where the AI panel appears in v1

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Docs disagreed on whether approvers get the AI panel on Site parts. The agreed brief was: New page and Edit page for staff, plus Templates, Design and Brand for admins. Menus are edited in the menu screen "like a normal human being".

## Decision

- **Editors, approvers and admins:** AI panel on **New page** and **Edit page**.
- **Admins:** also on **Templates** and **Brand and Design**.
- **Nobody:** Site parts (header, footer, menus), the Pages list itself (no chat panel on the list), Media, Forms and embeds, Approvals, Settings.
- Site parts are edited by hand by approvers and admins, and go through approval like pages.
- Every session is one task bound to one target (see [12-ai-harness.md](../12-ai-harness.md#task-scoped-tools)).

## Consequences

- One rule across all docs. Adding the AI to another screen later needs a new task type and a new ADR.

## Amendment (2026-11-17)

The Pages list gained an entry point, **New page with the assistant**, which opens a dedicated interview screen (not a chat panel on the list). That screen is a `new_page` task: a short back-and-forth, a plan, then a draft page created only when the person confirms Build. The list itself still has no AI panel. See [07-ai-agent.md](../07-ai-agent.md).

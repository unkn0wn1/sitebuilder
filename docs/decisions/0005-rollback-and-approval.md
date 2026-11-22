# 0005: Rollback follows releases, and approval rules for small teams

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

There were two rollbacks that disagreed. Page rollback works through the database (make an old version the draft, approve it). Site rollback switched the `current` symlink, which left the database thinking newer versions were live, so the next publish would quietly bring them back. Approval rules for small teams were also undecided.

## Decision

### Releases are the record of what is live

- Every release stores a **manifest**: the exact page version ids, site part version ids, brand pack version, theme and render bundle id it was built from.
- **Page rollback** is unchanged: preview an old version, "Restore this version" makes it the new draft, and it goes through normal approval.
- **Site rollback** switches the symlink **and** sets the database "published" pointers to match the release manifest, in one transaction, then purges Cloudflare fully. Drafts newer than the release are kept as drafts, not lost.
- **Emergency rollback:** admins can roll the whole site back to any kept release **without a second person**. It is logged in the audit log with a required reason, and every approver gets an email.
- Media is stored once in a shared, append-only folder outside releases. A media file is only deleted when no kept release and no version uses it.

### Approval rules

- **Editors** can never approve their own work.
- **Approvers and admins** cannot approve their own drafts by default.
- **Self-approval** is a site setting (Settings > Workflow), off by default. The setup wizard asks how many people approve; if the answer is one, it is switched on.
- When self-approval is used, the blocking checks (see [17-testing-and-budgets.md](../17-testing-and-budgets.md) and [04-gui.md](../04-gui.md)) must still pass, and the publish log marks the release "self-approved".
- **Approval is pinned to a version.** The approver approves the exact version they reviewed. If the draft changes after submission, the review is withdrawn and must be resubmitted.

## Consequences

- One source of truth: the release manifest. Database and files cannot drift.
- Incidents can be fixed by one admin in seconds, with an audit trail.
- One-person organisations are not blocked, and larger teams keep a second pair of eyes.

## Amendment, 2026-11-20 ([ADR 0018](0018-agent-gateway.md))

Approval now has a second legitimate source and undo a second shape, both for the agent gateway:

- **Approval by rule.** An agent token with a matching `publish` rule (or an active always-allow) can approve the review for a change it made. The review records `decided_by = agent:<token id>`, the rule in the decision comment, `self_approved = false`, and the audit action `review.approved_by_rule`. The blocking checks still apply and cannot be overridden. A change that touches a money section, or sits on someone else's unpublished work, is never approved by rule.
- **Admin undo of an agent change.** An admin can undo a published agent change in one step. It restores the earlier content as a new change that is published straight away, with the audit action `review.approved_admin_undo`. It is refused if the pages were published again since; the whole-site rollback above is still the tool for that.
- Editors still cannot approve their own work, and approval is still pinned to a version.


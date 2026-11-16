# API contract

**Draft, but the basis for the v1 code.** The builder's HTTP API, served by Nitro. The GUI and the AI harness use the same operations and the same validation, so this API is also the contract the AI tools are built on ([12-ai-harness.md](12-ai-harness.md#tools)). Entities are in [13-data-model.md](13-data-model.md).

## Conventions

- Base path **`/api/v1`**. JSON in and out, UTF-8.
- **Auth:** a session cookie (`sb_session`, `HttpOnly`, `Secure`, `SameSite=Strict`). No tokens in local storage.
- **CSRF:** cookies are `SameSite=Strict`, and every request that changes something must have an `Origin` header matching the builder's own origin.
- **Validation:** every body and query is checked with Zod before any work is done.
- **Permissions:** checked on the server on every route, by role, and for AI calls also by task and target. The GUI hiding a button is never the protection.
- **Lists** take `page` and `pageSize` (default 25, maximum 100) and return `{ items, page, pageSize, total }`.
- **Times** are ISO 8601 UTC.
- **Ids** are prefixed strings ([13-data-model.md](13-data-model.md#conventions)).

## Errors

One shape for every error, written so the GUI can show `message` to a person as is, and the AI can read `fields` and fix its call.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The heading is too long. Keep it under 80 characters.",
    "fields": [{ "path": "ops.0.props.heading", "message": "Must be 80 characters or fewer." }]
  }
}
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` | Body or query failed validation, or a section failed its schema or template rules |
| 401 | `unauthenticated` | No valid session |
| 403 | `forbidden` | Role, task or target does not allow it |
| 403 | `csrf` | Missing or wrong `Origin` |
| 404 | `not_found` | No such thing on this site |
| 409 | `conflict` | Someone else changed the same thing since `baseRevision` (body includes `current` and `conflicts`) |
| 409 | `invalid_state` | For example approving a review that was withdrawn |
| 429 | `rate_limited` | Too many attempts (sign-in, AI messages) |
| 500 | `internal` | Something broke. A reference id is included and logged |

## Endpoints (v1)

### Auth and users

| Method and path | Who | Does |
| --- | --- | --- |
| `POST /auth/login` | Anyone | Email and password, sets the session cookie. Rate limited |
| `POST /auth/logout` | Signed in | Ends the session |
| `GET /auth/me` | Signed in | Current user, role, operator flag |
| `POST /auth/invite/accept` | Invite token | Set name and password |
| `POST /auth/password/reset-request` | Anyone | Always answers the same way, emails a link if the account exists |
| `POST /auth/password/reset` | Reset token | New password, ends other sessions |
| `GET /users` | Admin | List users |
| `POST /users` | Admin | Invite a user with a role (sends an email) |
| `PATCH /users/:id` | Admin | Change role, operator flag or status |

### Pages

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /pages` | Editor+ | List with `search`, `state`, `template`, `parentId` |
| `POST /pages` | Editor+ | Create a page: `{ title, template, parentId?, slug? }`. Returns the page with an empty draft built from the template's starting sections |
| `GET /pages/:id` | Editor+ | Page row, current draft document, `draftRevision`, live version id, current review |
| `POST /pages/:id/ops` | Editor+ | Apply operations: `{ baseRevision, ops: [...] }`. Returns `{ revision, doc, opIds }`, or `409 conflict` |
| `GET /pages/:id/ops` | Editor+ | Operation log since a revision: `?since=` (for catching up after a conflict) |
| `POST /pages/:id/undo` | Editor+ | Undo one operation: `{ opId }` |
| `POST /pages/:id/checkpoint` | Editor+ | Seal the current draft as a named version: `{ summary }` |
| `GET /pages/:id/versions` | Editor+ | Version history (sealed versions and the latest autosave) |
| `GET /pages/:id/versions/:versionId` | Editor+ | One version's document (migrated forward) |
| `POST /pages/:id/versions/:versionId/restore` | Editor+ | Copy an old version into a new draft snapshot |
| `POST /pages/:id/submit` | Editor+ | Submit for review: `{ note? }`. Seals a version and pins a review to it. Runs blocking checks first |
| `POST /pages/:id/unpublish` | Approver+ | Take offline: `{ redirectTo? }`. Queues a publish |
| `DELETE /pages/:id` | Editor+ (own drafts), Approver+ | Move to the bin. Live pages must be unpublished first |
| `GET /pages/bin` | Approver+ | Pages in the bin |
| `POST /pages/:id/restore` | Approver+ | Bring back from the bin as a draft. If its address is taken (or its parent is gone) it comes back at the top level with `-restored` on the slug, and `moved: true` |

### Reviews

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /reviews` | Approver+ (editors see only their own) | Pending reviews (and recent decided ones with `state`) |
| `GET /reviews/:id` | Approver+, submitter | Review, pinned version, diff against live, check results, comments |
| `POST /reviews/:id/approve` | Approver+ | `{ versionId }` must match the pinned version. Self-approval rules apply ([ADR 0005](decisions/0005-rollback-and-approval.md)). Queues a publish job and returns its id |
| `POST /reviews/:id/send-back` | Approver+ | `{ comment }` (required) |
| `POST /reviews/:id/comments` | Approver+, submitter | `{ body, blockId? }` |

### Site parts, templates, brand

Same pattern as pages: `GET /site-parts`, `GET /site-parts/:id`, `GET /site-parts/:id/versions`, `POST /site-parts/:id/ops`, `POST /site-parts/:id/submit` (edits and submit: approvers and admins). Site parts are small, so their one operation is `{ op: 'replace', doc }` with the whole document, checked against the schema for its kind (`shared/site-parts.ts`). Menu links point at page ids, so they follow page moves; a link to a page that no longer exists blocks the edit, and a link to a page that is not live yet is a warning. A page a menu links to can't be binned until the link is removed. Templates and the brand pack follow the same shape under `/templates` and `/brand` (admins only).

### Media and embeds

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /media` | Editor+ | List and search |
| `POST /media` | Editor+ | Upload (multipart). Returns the media item in `processing` state and a job id |
| `GET /media/:id` | Editor+ | Details, renditions, crops, where it is used |
| `GET /media/:id/files/:name` | Editor+ | One rendition, for previews in the builder |
| `PATCH /media/:id` | Editor+ | Alt text, decorative flag, focal point |
| `POST /media/:id/crops` | Editor+ | Approve a crop: `{ ratio, rect }` |
| `DELETE /media/:id` | Approver+ | Bin. Refused while in use on a live page |
| `GET /embeds` | Editor+ | Registered forms and embeds by name |
| `POST /embeds`, `PATCH /embeds/:id`, `DELETE /embeds/:id` | Approver+ | Register or change a form. Domain must be on the allow-list (admin setting) |

### Publishing, redirects, jobs

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /releases` | Approver+ | Publish log |
| `POST /releases/:id/rollback` | Admin | Emergency site rollback: `{ reason }` (required). No second approver needed, always logged and emailed |
| `GET /redirects`, `POST /redirects`, `DELETE /redirects/:id` | Approver+ | Manage redirects |
| `GET /jobs/:id` | Signed in (own jobs), Operator | Progress and result of a background job |

### AI

| Method and path | Who | Does |
| --- | --- | --- |
| `POST /ai/sessions` | By task type and role | Start a task: `{ taskType, targetId }`. The server binds the session to that one target |
| `GET /ai/sessions/:id` | Session owner | Messages and state |
| `POST /ai/sessions/:id/messages` | Session owner | Send a message. Streams progress events (server-sent events): text, tool started, tool result, needs you, finished, stopped, error |
| `POST /ai/sessions/:id/cancel` | Session owner | Stop at the next step |
| `GET /memory`, `POST /memory`, `DELETE /memory/:id` | Site memory: admins edit, all read. User memory: own | Memory entries |
| `POST /memory/:id/accept` | Owner (user memory), Admin (site memory) | Save an entry the assistant proposed |

Tools run inside the server. They call the same services as the routes above, so they get the same validation, and on top of that every call is checked by the task scope check (task type, role, bound target) described in [12-ai-harness.md](12-ai-harness.md#task-scoped-tools).

### Settings, audit, system

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /settings`, `PATCH /settings` | Admin | Site settings |
| `PUT /settings/secrets/:name` | Admin or Operator | Write-only: AI key, Cloudflare token, SMTP password. Never readable afterwards |
| `GET /audit` | Admin | Audit log with filters |
| `GET /notifications` | Signed in | Your latest 50 notifications |
| `GET /health` | Anyone | Liveness (no details) |
| `GET /system` | Operator | Version, disk, last publish, last backup, job queue |

## Operations format

```json
{ "baseRevision": 12, "ops": [
  { "op": "add_block", "index": 1, "block": { "type": "RichText", "props": { "content": { "type": "doc", "content": [] } } } },
  { "op": "update_props", "blockId": "b_7f3k", "props": { "heading": "Keep them warm" } },
  { "op": "move_block", "blockId": "b_9x2m", "toIndex": 0 },
  { "op": "remove_block", "blockId": "b_1aa1" },
  { "op": "set_meta", "title": "Winter appeal 2026", "slug": "winter-appeal" },
  { "op": "set_seo", "description": "Help keep injured street animals warm." }
] }
```

- New sections get their id from the server.
- The whole batch is applied or none of it is.
- After the batch, the page is validated against the section schemas and the template's allowed sections. **Required** sections are only enforced at submit, so a half-built draft can still be saved.

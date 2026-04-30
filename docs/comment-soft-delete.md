# Comment soft-delete (#171)

When a user deletes their own comment, the DB row persists with `deletedAt` set + the original body left on the row for audit / appeal. The API's list + detail responses replace the body with `"[deleted]"` (or `"[removed by moderation]"` if an admin removed it) and zero the author profile to a placeholder. Thread shape is preserved — later replies stay anchored, the comment count in the banner doesn't shift — which matches Reddit / HN / Substack behaviour.

This issue also lays the moderation rails: an admin can soft-delete any comment with a `moderationReason` via `?moderation=true`. No admin UI yet; the follow-up Level-3 moderation-dashboard issue builds that.

## Data model

Three new nullable columns on `Comment`:

- `deletedAt DateTime?` — null for live comments; timestamp when flagged. Indexed for fast filtering in future moderation views.
- `deletedBy Int?` — user id who performed the delete. Self-delete → `authorId`; moderation → admin id. Plain Int column (no FK relation) to keep the schema shape simple.
- `moderationReason String?` — populated only on the moderation path.

One new nullable column on `User`:

- `role String?` — null / absent = regular user; `"admin"` = moderator. Stored as plain string (not a Prisma enum) so future roles like `"editor"` / `"support"` don't require a migration; the app-level validator enumerates accepted values.

Migration is additive (`prisma/migrations/20260430004331_add_comment_soft_delete/migration.sql`) — existing comments pick up `deletedAt = null` without data change.

## API surface

`DELETE /api/articles/:slug/comments/:id` — now soft-deletes:
- **Self-delete** (default, no query param): viewer must be the comment author. Writes `deletedAt = NOW(), deletedBy = viewer.id`.
- **Moderation** (`?moderation=true` + JSON body `{ reason: string }`): viewer must have `role = "admin"`. Writes `deletedAt = NOW(), deletedBy = viewer.id, moderationReason = reason`.

Response status: `204` unchanged on both paths.

Role is read from the DB at request time, not baked into the JWT. That way an admin demoted an hour ago cannot still moderate with a live token.

### Error ladder (unchanged 404/403 shape)

- `404` — missing comment, wrong-article comment (cross-slug probe), OR already soft-deleted. Hides existence uniformly.
- `403` — self-delete by non-owner, OR moderation call by non-admin.
- `422` — moderation call without a reason.

### List / detail responses

`GET /api/articles/:slug/comments` and `GET /api/articles/:slug` both return soft-deleted rows with the placeholder shape:

```json
{
  "id": 42,
  "createdAt": "2026-04-01T10:00:00Z",
  "updatedAt": "2026-04-01T10:00:00Z",
  "body": "[deleted]",
  "deletedAt": "2026-04-30T15:00:00Z",
  "author": {
    "username": "[deleted]",
    "bio": null,
    "image": null,
    "following": false
  }
}
```

- `body` is the placeholder literal; the original body stays in the DB for audit.
- `author` is frozen to a dead-username profile so no link / avatar can expose the real author.
- `deletedAt` is the only new field surfaced; clients detect soft-deletion via `deletedAt != null`.
- `updatedAt` is NOT bumped on delete — preserving whatever edit timeline existed pre-delete. This is a deliberate choice so a future undelete could return to the pre-delete updatedAt; in the current shape there's no undelete.
- Moderated rows carry `body: "[removed by moderation]"` — same placeholder shape otherwise. The `moderationReason` itself is NOT surfaced in the public list; only the admin-tools surface (future) will query it.

### PUT on a soft-deleted comment returns 404

The edit endpoint from #159 also checks `deletedAt`. A deleted comment is terminal — allowing edit would let the author rewrite history. This matches Reddit / HN.

## Web UI

`CommentItem` branches on `comment.deletedAt`:
- **Live row**: the familiar `EditableCommentBody` + footer with Edit / Delete / (edited) badge.
- **Deleted row**: a tinted card with italicized `"[deleted]"` / `"[removed by moderation]"` body, placeholder author, relative timestamp. No Edit / Delete controls. `data-deleted="true"` for e2e test hooks.

Colour palette uses `#595959 on #f7f7f7` for AA 4.5:1 contrast compliance. Opacity-based dimming was deliberately NOT used — it stacks against content and drags text contrast below the floor.

The comment count in the article banner reads `comments.length` off the full list (including soft-deleted), so a thread of 3 comments with the middle one deleted still shows "3 comments" — replies below stay anchored in place.

## Bruno baseline shift

Three Bruno assertions from the canonical RealWorld collection fail under soft-delete semantics:

- `comments/07-verify-deletion.bru` — asserts `res.body.comments.length === 0` after deleting the only comment. Under soft-delete the placeholder stays.
- `comments/10-verify-two-comments-exist.bru` + `comments/12-verify-only-the-second-comment-remains.bru` — assert specific list lengths after partial deletes, now invalidated for the same reason.

These are tracked in `tests/api/bruno-baseline.json` under the `comment-soft-delete-list-count` cluster. The RealWorld reference encodes hard-delete semantics; a future `?includeDeleted=false` query param could restore Bruno conformance while preserving the soft-delete data model. Not in scope for #171.

## Moderation contract (no UI yet)

```
DELETE /api/articles/my-slug/comments/42?moderation=true
Content-Type: application/json

{ "reason": "spam" }
```

- Viewer must carry `role="admin"` (DB field, not JWT claim).
- `reason` is required non-empty; empty → 422.
- Non-admin → 403.
- On success, the list renders the row with `body: "[removed by moderation]"`.

Creating an admin user requires a direct DB write (CLAUDE.md's "never write to the DB directly" bars this through the app; operators do it manually until the admin UI lands):

```sql
UPDATE "User" SET role = 'admin' WHERE username = 'alice';
```

## Out of scope (follow-ups)

- **Admin UI / moderation dashboard** — Level-3 issue; the data model + DELETE ?moderation=true endpoint ship here, the UI ships later.
- **Hard-delete-after-retention** (purge soft-deleted rows after N days for GDPR) — Level-3 issue.
- **User-initiated undelete** — not in the Reddit / HN reference shape; not planned.
- **Role-change audit log** — User.role is directly mutable; future issue can add a history table.

## Verification

```sh
pnpm test:e2e tests/e2e/specs/171-web-comment-soft-delete.spec.ts
```

7 scenarios: owner DELETE → placeholder in list; PUT on deleted → 404; non-admin moderation → 403; moderation without reason → 422; double-delete → 404; UI renders placeholder + no controls + count preserved; axe passes.

Bruno conformance: 146/149 passing, 3 expected failures tracked in the baseline.

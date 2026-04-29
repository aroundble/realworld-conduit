# Comment edit (#159)

Users can edit their own comments in place. Post a typo → click Edit → change the text → Save. The comment's thread position and `createdAt` stay put; `updatedAt` bumps and an "(edited)" badge appears next to the relative timestamp.

## API

`PUT /api/articles/:slug/comments/:id`

Request:
```json
{ "comment": { "body": "updated text" } }
```

Response (200):
```json
{
  "comment": {
    "id": 42,
    "createdAt": "2026-04-29T22:00:00Z",
    "updatedAt": "2026-04-29T22:05:00Z",
    "body": "updated text",
    "author": { ... }
  }
}
```

Errors:
- **401** — no session cookie.
- **403** — viewer is authenticated but not the comment author. `{ "errors": { "comment": ["forbidden"] } }`.
- **404** — article or comment id doesn't exist, OR the comment belongs to a different article's slug (cross-slug probing defense; same 404 as DELETE).
- **422** — body failed zod validation (empty, > 10 000 chars). `{ "errors": { "body": ["String must contain at least 1 character(s)"] } }` shape varies by zod.

## Ownership + validation

The handler uses the exact ownership ladder from `deleteComment` — fetch the comment, verify the slug matches its article, check `comment.authorId === viewerId`. This keeps "not your comment" indistinguishable from "no such comment" for probing clients.

Prisma's `Comment.updatedAt` lacks `@updatedAt` (same schema-level decision as `Article.updatedAt`), so the service sets it explicitly with `new Date()`.

## Rate limiting

Edit shares the `/api/articles/:slug/comments/:id` path with DELETE. Its own rate-limit bucket (`comments:put`, 20/min per user) stacks via `methods: ["PUT"]` so the DELETE limiter (30/min) isn't consumed by edits and vice versa.

## Web UI

`CommentItem.tsx` renders the body through `EditableCommentBody` — a client component that owns the inline-edit state machine. For non-owners, the component renders a plain `<p>` and no controls. For owners, three states:

1. **View** — `<p>` with the body + an "Edit" text trigger.
2. **Editing** — a `<textarea>` prefilled with the current body, a Save + Cancel button row, and an error `<ul role="alert">` that appears if the server rejects.
3. **Saving** — Save click puts the component into `isPending` via `useTransition`; buttons are disabled and `aria-busy="true"`.

Save success:
1. Optimistically replaces the rendered body with the new text.
2. Calls `router.refresh()` to pull the server's updated envelope (fresh `updatedAt`, which drives the `(edited)` badge in `CommentItem`).

Cancel discards the draft, restores the textarea to the original body, and swaps back to view mode. Never calls the server.

## (edited) badge

`CommentItem` renders a `<time className="comment-edited-badge" dateTime={updatedAt} title="edited {formalDate}">(edited)</time>` span next to the relative timestamp whenever:

```
Date.parse(updatedAt) - Date.parse(createdAt) > 5000 ms
```

The 5-second tolerance accommodates clock skew between Prisma's default-`now()` `createdAt` and the service-level `new Date()` `updatedAt` that runs a few ms later on insert. Without the tolerance, every freshly-posted comment would carry a spurious badge. Real users edit minutes to hours later, so the tolerance never hides a real edit.

For e2e testing, the spec sleeps 5.5s between post and edit to cross the tolerance boundary deterministically.

## Focus UX

Clicking Edit focuses the textarea on the next paint (`requestAnimationFrame`) and places the caret at the end of the existing body. This matches Substack / Medium behaviour — the user expects to append, not re-select.

## Out of scope

- **Edit history / revision trail** — expensive in DB rows + UI; future feature if moderation demands it.
- **Admin-edit of others' comments** — different permission axis; separate issue.
- **Threading (replies to replies)** — entirely different feature.

## Verification

```sh
pnpm test:e2e tests/e2e/specs/159-web-comment-edit.spec.ts
```

8 scenarios:

1. API PUT updates body + bumps `updatedAt`, subsequent GET reflects it.
2. Non-owner PUT returns 403.
3. Empty body PUT returns 422.
4. Owner clicks Edit → inline textarea → Save → body updates + (edited) badge appears.
5. Cancel discards the edit, body unchanged, no badge.
6. Non-owner sees no Edit trigger on someone else's comment.
7. Saving empty/whitespace body surfaces an inline error and keeps the editor open.
8. `runAxe` passes on the open editor.

Bruno conformance stays at 149/149 (PUT is additive; the RealWorld spec doesn't cover it, so no baseline shift).

# Editor draft autosave (#137)

The `/editor` form autosaves its fields (title / description / body / tagList) to `localStorage` every 3 seconds after the user stops typing. On return, a banner offers to restore the draft or discard it. Successful submit clears the draft. Never syncs to the server — purely client-side progressive enhancement.

## Storage keys

- `conduit-draft-new` — new-article editor (`/editor`).
- `conduit-draft-edit-<slug>` — edit-mode editor (`/editor/<slug>`).

Keys are per-document so a half-written new article doesn't bleed into an edit session for an existing article.

## Payload shape

```json
{
  "title": "string",
  "description": "string",
  "body": "string",
  "tagList": ["string", ...],
  "savedAt": 1735680000000
}
```

`savedAt` is epoch millis at write time; the restore banner renders `Intl.RelativeTimeFormat(diff, "minute")` for the user-visible age.

## Timing

Debounce = 3s. The hook (`useDraftAutosave`) listens to the form's `input` event and resets a `setTimeout` on every keystroke. No write fires until 3s of keyboard idle — so a steady typer pays exactly one write per 3s window, not one per keystroke.

Empty drafts (all fields blank) are never persisted; the debounce handler calls `removeItem` instead of writing an empty envelope. That prevents a spurious "Restored draft from N minutes ago" banner on a freshly-opened editor the user blurred without typing.

## Restore banner

The banner renders when:
1. `window.localStorage` is available (`hasStorage === true`).
2. A draft was present for the current key at mount time.
3. The user hasn't clicked Keep or Discard yet.

Clicking **Keep** fills the form fields with the saved values (via a remount + `defaultValue` swap — uncontrolled inputs need a fresh key to pick up new defaults). Clicking **Discard** clears the storage key and resets the banner state; the form stays empty.

Snapshot is read **once per mount** via `useMemo([mounted, draftKey])`. Subsequent autosave writes from the same session do NOT retrigger the banner — otherwise it would pop back up mid-edit showing the content the user just typed, which is absurd.

## Submit clears the draft

On form submit, the client-side `onSubmit` handler calls conform's validator first, then `clear()`s the storage key. If conform `preventDefault`s (validation error), the clear is skipped — the draft remains available for recovery. If the server action succeeds and redirects, the clear has already fired.

This leaves one edge case: server-action failure after `onSubmit` delegates to the form action. Because the server is a fresh request, the client-side `clear()` never fires on failure — the draft stays in storage. That's the behaviour we want: failure leaves the draft intact for the next recovery attempt.

## Private windows / disabled storage

Every `localStorage` access is wrapped in `try/catch`. The hook exposes `hasStorage: boolean` so the UI can hide the banner when the feature is unavailable (incognito with storage blocked, quota exceeded). The form itself still works — autosave is pure progressive enhancement.

## SSR + hydration

The hook uses the `useSyncExternalStore(noop, () => true, () => false)` pattern to flip from "SSR mode" (returns null draft) to "client mounted" (returns the storage read). Same approach as the dark-mode toggle in #136 — it satisfies React 19's "no setState in effect" rule while keeping the SSR and first client render identical.

## Out of scope

- Multi-device sync via server-side drafts — would need a Prisma-backed endpoint and is a different feature.
- Rich-text paste (images, tables) — depends on a richer editor.
- Autosave DURING a server action — the action either succeeds (redirect, draft cleared) or fails (stays on page; next keystroke retriggers autosave).

## Verification

```sh
pnpm test:e2e tests/e2e/specs/137-web-editor-draft-autosave.spec.ts
```

Scenarios: debounce write, restore banner + Keep, Discard, successful-submit clears, edit-mode scoping, axe a11y gate with banner visible.

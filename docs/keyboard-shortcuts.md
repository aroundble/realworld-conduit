# Keyboard shortcuts (#160)

Global keyboard shortcuts give power users a "stay in the flow" navigation loop. Every modern content platform (GitHub, Linear, Notion, Hacker News) has one; Conduit's is small, documented, and fully screen-reader accessible.

## The shortcut table

| Key | Action |
|-----|--------|
| `?` | Open the help modal |
| `/` | Focus the SearchBar (homepage) |
| `g h` | Navigate to `/` |
| `g p` | Navigate to `/profile/<your-username>` (→ `/login?redirect=/profile` when anon) |
| `n` | Open the editor (→ `/login?redirect=/editor` when anon) |
| `Esc` | Close the help modal + restore focus |

Multi-key sequences (`g h`, `g p`) have a 1-second timeout: press `g`, then the follow-up within 1s. Miss the window and the prefix is discarded silently (no error, no toast).

## Architecture

Two components, both in `apps/web/src/components/`:

- **`KeyboardShortcutProvider.tsx`** — mounts in `layout.tsx` once, owns the `window.addEventListener("keydown", ...)` handler and the `helpOpen` state. Exposes `useShortcutContext()` for children that want to open / close the modal programmatically (e.g. the footer link).
- **`KeyboardShortcutHelp.tsx`** — the modal. Renders `null` when `helpOpen === false`. When open: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="shortcut-help-title"`, an internal focus trap (Tab / Shift+Tab cycle within the dialog), and `requestAnimationFrame`-deferred focus to the Close button so initial-focus works across all paint timings.

The provider wraps everything inside `<body>` so every route has shortcuts, including `/login` and 404s.

## Input-field guard

Every keystroke the provider handles first runs through `isTextInputFocused(event.target)`. If the focused element is an `<input>`, `<textarea>`, `<select>`, or `contenteditable`, shortcuts do NOT fire. That means:

- Typing `?` in an article body types a `?` into the textarea. It does NOT open the help modal mid-paragraph.
- Typing `/` in the search bar types a `/`. It does NOT re-focus the search bar.
- Typing `n` in a profile-edit input types `n`. It does NOT navigate away.

The guard is the single most important UX rule in this feature. Without it the shortcuts would be actively hostile.

## Modifier reservation

`Ctrl` / `Cmd` / `Alt` / `Meta` + any key is always passed through to the browser / OS. This keeps `Cmd+L` (address bar), `Ctrl+F` (find), `Cmd+R` (reload), etc. working as expected.

## Focus restoration on modal close

Before opening the help modal, the provider captures `document.activeElement` into `prevFocusRef`. On close, it calls `requestAnimationFrame(() => prev.focus())` — the RAF defer lets the modal's unmount complete first, otherwise focus lands on `<body>` instead of the element that opened the modal.

This is an a11y requirement: a screen-reader user's tab position must not disappear when they dismiss a modal.

## Modal auto-close on navigation — deliberately NOT implemented

The naive "close the modal when `pathname` changes" effect runs into React 19's combined rules:

1. `react-hooks/set-state-in-effect` forbids `setHelpOpen(false)` inside a `useEffect`.
2. `react-hooks/refs` forbids reading a ref during render (so the "track previous pathname" trick doesn't help).
3. Passing a ref into `clearTimeout` during render also counts as "ref read during render".

All three fighters blocked every variant I tried. Since the help modal's contents are navigation-invariant (the shortcut list is the same on every page), leaving it open across a route transition is a reasonable default. The user dismisses it with `Esc` or the Close button. This is documented as a non-feature in the provider source.

If a future shortcut opens a navigation-relevant modal (e.g. a confirm dialog for destructive actions), that modal owns its own close-on-navigate logic — not the global provider.

## Discoverability

The footer carries a small `⌨ Keyboard shortcuts (?)` link (`KeyboardShortcutFooterLink.tsx`). Clicking it opens the same modal — users who don't know about `?` still find the feature.

## Viewer detection

`g p` (and `n`) need to know whether the viewer is authenticated. The provider reads the `conduit-user` cookie directly via `document.cookie.match(/(?:^|; )conduit-user=([^;]+)/)`. Two shapes are supported:

- Bare username: `conduit-user=alice`.
- JSON: `conduit-user={"username":"alice",...}`.

Both appear in the codebase — server actions write bare usernames, client-only code sometimes persists the full user object. The `try { JSON.parse(...) } catch` lets the provider accept whichever form is current. If the cookie is missing, `readViewerUsername()` returns `null` and the shortcut falls through to the `/login?redirect=...` branch.

## Adding a new shortcut

1. Extend the `onKeyDown` handler in `KeyboardShortcutProvider.tsx` with a new branch. Always `event.preventDefault()` before triggering navigation / focus, and always check the text-input guard first.
2. Add a row to the `SHORTCUTS` array in `KeyboardShortcutHelp.tsx` so it appears in the help modal.
3. Add a row to the table at the top of this document.
4. Add a scenario to `tests/e2e/specs/160-web-keyboard-shortcuts.spec.ts` verifying the new shortcut via `page.keyboard.press(...)`.

If the new shortcut is a multi-key sequence other than `g`-prefix, add a second prefix ref (don't overload `seqPrefixRef`) so the two sequences don't interfere.

## Out of scope

- **User-customizable shortcuts** — too much UI for one refinement issue. Users get the published set.
- **`j` / `k` vertical navigation in feeds** — separate polish issue if demanded.
- **Command palette (`Cmd+K`)** — future Level-3 feature, filed separately.

## Verification

```sh
pnpm test:e2e tests/e2e/specs/160-web-keyboard-shortcuts.spec.ts
```

9 scenarios: `?` opens modal, `Esc` closes, `/` focuses search, `g h` navigates home, `n` routes to `/login?redirect=/editor` when anon, input-field guard (typing `?` in a form types the character), footer trigger opens modal, axe a11y gate on the open modal, Tab cycles within the modal.

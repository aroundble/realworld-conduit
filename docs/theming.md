# Theming (#136)

The app supports three theme modes: **System** (follows
`prefers-color-scheme`), **Light**, and **Dark**. The user cycles
through them via the nav toggle; the choice persists in
`localStorage` under key `conduit-theme`.

## Wiring

- `next-themes` (MIT) provides the SSR-safe `<ThemeProvider>` and
  the `useTheme()` hook. Its key move: it injects an inline
  `<script>` into `<head>` that reads localStorage / the system
  media query and sets `data-theme` on `<html>` *before* first
  paint — so there's no flash of the wrong palette.
- `apps/web/src/components/ThemeProvider.tsx` pins the config
  (`attribute="data-theme"`, `storageKey="conduit-theme"`,
  `defaultTheme="system"`, `disableTransitionOnChange`).
- `apps/web/src/components/ThemeToggle.tsx` is the nav button.
  Three-state cycle, `aria-pressed` reflects the user-set state
  (true on explicit light/dark, false on system), `aria-label`
  names the current mode for screen readers.

## Palette shape

Colors are CSS variables on `:root` (light defaults) overridden
under `[data-theme="dark"]`. Every surface that switches on theme
references one of these variables instead of a hex literal.

Light (`:root`):

| Variable | Value | Use |
|---|---|---|
| `--conduit-bg` | `#ffffff` | body background |
| `--conduit-text` | `#373a3c` | body text |
| `--conduit-text-muted` | `#55595c` | secondary meta (dates, read-time, empty-state body) |
| `--conduit-surface` | `#ffffff` | card surface |
| `--conduit-border` | `rgba(0, 0, 0, 0.1)` | subtle dividers |
| `--conduit-input-bg` | `#ffffff` | form input backgrounds |
| `--conduit-navbar-bg` | `#ffffff` | navbar |
| `--conduit-footer-bg` | `#f3f3f3` | footer |
| `--conduit-green` | `#2c7a2c` | brand + link (AA 5.41 on white) |
| `--conduit-green-dark` | `#1d5a1d` | brand hover |
| `--conduit-banner-bg` | `#2c7a2c` | home banner |

Dark (`[data-theme="dark"]`):

| Variable | Value | Use |
|---|---|---|
| `--conduit-bg` | `#0e0e0f` | body background |
| `--conduit-text` | `#e8e9ea` | body text |
| `--conduit-text-muted` | `#a5a9ac` | secondary meta |
| `--conduit-surface` | `#1a1a1c` | card surface |
| `--conduit-border` | `rgba(255, 255, 255, 0.12)` | dividers |
| `--conduit-input-bg` | `#1a1a1c` | inputs |
| `--conduit-navbar-bg` | `#151517` | navbar |
| `--conduit-footer-bg` | `#151517` | footer |
| `--conduit-green` | `#4cc04c` | brand + link (AA on dark bg) |
| `--conduit-green-dark` | `#66d066` | brand hover (lighter on hover reads correctly on dark) |
| `--conduit-banner-bg` | `#3fa03f` | home banner (brighter so it reads distinct from the near-black body) |

## Contrast discipline

Every fg/bg pair in both palettes clears WCAG AA 4.5:1. Verified
by axe on both palettes (spec 136 scenarios 5 + 6). When adding a
new themed surface, pick colors from the variable set above — if
none fit, widen the palette rather than shipping a one-off hex
literal. A follow-up axe run catches regressions before merge.

## Adding a new themed surface

1. Identify the background the element sits on and the text that
   sits on it. Pick the matching `--conduit-*` variables.
2. Reference them in the component's CSS (or in `globals.css`
   if it's global chrome).
3. If the element needs palette-specific behaviour that isn't
   covered by a variable swap (e.g. a reversed gradient), use the
   `[data-theme="dark"] .my-selector { ... }` form in
   `globals.css` — that's the override pattern the existing
   dark-only rules use.
4. Run `pnpm test:e2e tests/e2e/specs/136-web-dark-mode.spec.ts`
   — scenarios 5 + 6 run axe on both palettes and will flag
   contrast regressions.

## SSR + FOUC

`<html suppressHydrationWarning>` on `layout.tsx` is deliberate:
next-themes' inline script edits `<html>`'s `data-theme` attribute
before React hydrates, and without the suppression React would log
an SSR/CSR mismatch warning on every page load. Scope is just
`<html>` — everything inside hydrates strictly.

`<ThemeToggle>` uses a `useSyncExternalStore`-based "is mounted"
hook rather than `useEffect(() => setMounted(true))` to satisfy
React 19's "no setState inside effect" rule. Same semantic — the
component renders a neutral `system` state on SSR, upgrades after
hydration — just phrased the way React 19 prefers.

## Out of scope

- Per-user theme persisted server-side (follow-up if demand).
- Theme transitions / animation (`disableTransitionOnChange` is
  on deliberately — transitions on a full-palette swap look
  janky and risk failing `prefers-reduced-motion` expectations).
- Sepia / high-contrast modes.

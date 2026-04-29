# PWA manifest + installability (#149)

Conduit can be installed as a PWA: Chrome shows an install prompt
in the URL bar, iOS "Add to Home Screen" creates an icon, Android
users see the banner. The app launches standalone (no browser
chrome), statuses bar tints match the brand palette (light + dark),
and the Conduit icon shows on the home screen.

**Full offline-first is out of scope** for this milestone — the
service worker is a no-op passthrough that exists only to satisfy
the installability contract. A caching strategy (cache-first for
static assets, network-first for `/api/*`) is a separate follow-up.

## Surfaces

| Surface | Path | Served by |
|---|---|---|
| Manifest | `/manifest.webmanifest` | `apps/web/src/app/manifest.ts` (Next 16 metadata route) |
| Icons | `/icons/icon-{192,512,512-maskable}.png`, `/icons/apple-touch-icon.png` | `apps/web/public/icons/` |
| Service worker | `/sw.js` | `apps/web/public/sw.js` |
| Theme color | `<meta name="theme-color">` × 2 | `apps/web/src/app/layout.tsx` (viewport export) |
| Apple touch | `<link rel="apple-touch-icon">` | `apps/web/src/app/layout.tsx` (metadata.icons.apple) |

## Icons

Regenerate from source:

```sh
node scripts/gen-pwa-icons.mjs
```

Current icons are placeholder solid fills in `--conduit-green` (#2c7a2c).
When design ships a brand asset (ideally an SVG + a PNG export at 192
/ 512 / 512-maskable / 180), drop them into `apps/web/public/icons/`
and delete the script. The file paths are what the manifest
references, so the replacement is a binary swap.

**Maskable padding**: the 512-maskable icon should keep ≥20% margin
around the logo so Android's rounded-squircle mask doesn't clip it.
The current placeholder is full-bleed; a replacement brand asset
should pad.

## Theme color

Light = `#2c7a2c` (conduit-green from #90), dark = `#151517` (body bg
from the dark palette in #136). Next 16's `export const viewport`
takes the `themeColor` array and emits two `<meta>` tags scoped by
`prefers-color-scheme` media queries — the browser picks whichever
matches the user's OS preference.

## Service worker

`public/sw.js` registers on `load` via a tiny client component. It
handles `install` (skipWaiting), `activate` (claim clients), and
`fetch` (passthrough to network). No caching.

When offline-first lands, this file becomes the place to add the
routing + strategy. Keep the skip-waiting + claim-clients for fast
updates; swap the fetch handler.

## Installability contract

Chrome's PWA criteria:
- Served over HTTPS (production; local dev exempt).
- `manifest.webmanifest` with required fields — ✓ (name, short_name,
  start_url, display=standalone, icons 192 + 512).
- A registered service worker with a fetch handler — ✓.
- User has engaged with the site (heuristic; Chrome handles).

Verify locally: open the site in Chrome, open DevTools → Application
→ Manifest. The "Installability" section should show no errors.

## Out of scope

- Full offline caching (would need per-route cache strategy + cache
  versioning + invalidation). File as a follow-up.
- Push notifications / background sync (needs server-side push
  infrastructure).
- Splash screen generation (iOS requires a specific set; Android
  auto-generates from the manifest).
- Install banner copy.

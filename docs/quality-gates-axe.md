# axe-playwright dynamic a11y gate (#87)

The Playwright suite's page-level specs run axe-core against the rendered DOM. Zero `critical` or `serious` violations block merge. `moderate` and `minor` are signal-only.

Companion doc to `docs/quality-gates.md` (the size-limit + LHCI gates
from PR #88 — once that lands, merge this section into that file).

## What's measured

| Spec | URL(s) under gate |
|---|---|
| 15 layout-shell | `/`, `/login`, `/register`, `/settings`, `/editor` |
| 16 auth | `/login`, `/register` |
| 17 homepage (anon) | `/` |
| 18 article-detail | `/article/<seeded>` |
| 19 editor (authed) | `/editor` |
| 20 profile | `/profile/<seeded>` |
| 21 settings (authed) | `/settings` |
| 56 home favorite | `/` with a seeded article |

Each page-level spec calls `await runAxe(page)` (from `tests/e2e/axe-config.ts`) at least once. The helper injects axe-core then calls `checkA11y` with:

- **Fail on**: `critical` + `serious` impacts.
- **Rule overrides**: documented per-rule in `sharedRuleOverrides` at the top of the helper. Each entry carries a one-line `why:` citing the issue / PR that tracks the fix.

## Current overrides

| Rule | Why | Tracked |
|---|---|---|
| `color-contrast` | RealWorld canonical palette (brand green `#5cb85c`, muted grey `#b3b3b3`, white-on-green banner) below AA on every shared chrome surface — 10–11 nodes per page, all from Navbar / banner / footer. Fix requires a palette tune that touches visual parity with the RealWorld reference. | **#90** |

Any new override must land with a `type/bug` follow-up issue. The gate never silently suppresses a violation.

## Adding the gate to a new spec

```ts
import { runAxe } from "../axe-config";

test("axe a11y gate on <page> (#87)", async ({ page }) => {
  await page.goto(`${WEB_URL}/the-page`);
  await runAxe(page);
});
```

Authed pages seed a session via the existing `registerUser` + `primeSession` helpers, then call `runAxe`.

## Triaging a new violation

1. **If trivial** (missing `aria-label`, empty anchor, semantic HTML): fix inline in the PR.
2. **If it requires a component rewrite or visual redesign**: file a `type/bug` issue with rule id + spec name + first-failing URL, then add an override in `sharedRuleOverrides` with a `why:` that points to the issue.
3. **Never** silent-suppress. The rule override shape (`Record<id, { enabled: false; why: string }>`) enforces the discipline at code-review time.

## What #87 landed with

- Canonical `color-contrast` violations tracked in #90 and allowlisted.
- Trivial empty-anchor violations (empty author avatar links on `/article/[slug]` + `CommentItem`) fixed inline — avatars now only render when an image is present, and the ghost-anchor fallback is gone.
- `landmark-one-main` + `region` (moderate; signal-only but free) fixed by wrapping `{children}` in a `<main>` element in `apps/web/src/app/layout.tsx`.

All 8 page-level specs pass `runAxe(page)` against the current walking-skeleton compose stack.

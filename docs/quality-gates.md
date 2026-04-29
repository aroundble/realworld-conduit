# Quality gates

CI enforces four quality axes on every PR. Failing any axis blocks merge.

| Gate | Tool | Config | Threshold | CI job |
|---|---|---|---|---|
| Type safety | TypeScript | `apps/*/tsconfig.json` (`"strict": true`) | zero errors, zero `: any` in src | `install` → `typecheck` |
| Lint | ESLint + `eslint-config-next` | `apps/*/eslint.config.mjs` | zero errors | `install` → `lint` |
| Bundle size | `size-limit` | `apps/web/.size-limit.cjs` | per-entry limits below | `size-limit` |
| Performance + a11y | Lighthouse CI | `lighthouserc.json` | Perf ≥ 0.9, A11y ≥ 0.95 | `lhci` |

## Bundle-size budgets

Next.js 16 emits fully-hashed chunks under `.next/static/chunks/` — the legacy `main*.js` / `framework*.js` filenames are gone, so per-entry-point budgets aren't stable. `apps/web/.size-limit.cjs` measures the **total gzipped bytes** of every JS file and every CSS file under that directory.

| Entry | Limit | Current (walking-skeleton baseline) |
|---|---:|---:|
| Chunks JS (gzipped) | 320 KB | ~274 KB |
| Chunks CSS (gzipped) | 30 KB | ~3 KB |

The budgets target ~15 % headroom over the current walking-skeleton measurement — tight enough that a runaway dep surfaces in review, loose enough to absorb routine feature additions without a retune.

**Retuning**: read the actual `Size` column from a passing `pnpm size-limit` run, pick a new limit that keeps ~15 % headroom, land as `chore(ci): tune size-limit` with the reasoning (what landed that pushed the bundle up).

## Lighthouse CI

Runs against three anonymous routes: `/`, `/login`, `/register`. 3 runs per URL, scores taken as the median.

| Category | Level | Threshold |
|---|---|---:|
| Performance | error (blocks merge) | 0.90 |
| Accessibility | error | 0.95 |
| Best practices | warn | 0.85 |
| SEO | warn | 0.85 |

Disabled assertions (see `lighthouserc.json`):
- `uses-long-cache-ttl`, `uses-text-compression` — dev-server served by Next standalone, no reverse proxy. Production deploy picks these up via the platform (CDN / Nginx), not the app.
- `csp-xss` — not yet applied; tracked separately as a security refinement.
- `is-on-https`, `redirects-http` — local compose is plain HTTP by design.

**Why the article detail page isn't in the URL list**: rendering `/article/<slug>` requires a seeded DB row. Adding a seeding step inside the LHCI job would couple it to the Bruno conformance path. Article-detail perf is covered by the Playwright suite's behaviour assertions + a future `#24 Phase 2` run against a seeded stack.

**Retuning**: the gate is "block if below target", not "aim for target". If a feature legitimately drops perf (e.g. a new paywall iframe), tune the threshold down in the same PR that introduces the drop, with the tradeoff documented in the PR body. If perf drops unintentionally, fix the cause rather than tuning.

## What #24 deliberately doesn't ship (follow-ups)

- **axe-playwright** — threading `injectAxe` + `checkA11y` into every page-level spec is its own scope (a11y violation triage surfaces when you turn it on). Filed as a separate `type/feature` once #24 Phase 1 lands.
- **Per-URL LHCI budgets** — current config applies the same threshold to every URL. If route-specific floors matter (say, the editor page has a looser perf budget because of the markdown runtime), encode them in `assertions.*` overrides.

## Local iteration

```
pnpm --filter @conduit/web build    # rebuild before size-limit
pnpm -C apps/web exec size-limit
pnpm compose:up                     # LHCI needs the live stack
pnpm run lhci
```

LHCI runs against `http://localhost:3100` by default (local worktree's dev-bootstrap port). CI's workflow `sed`-substitutes to `http://localhost:3000` before running so the same `lighthouserc.json` serves both environments.

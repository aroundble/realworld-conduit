# ADR 000 — RealWorld reference review

**Status**: Accepted.
**Date**: 2026-04-28.
**Author**: planner (session pla-te6qbp).

## Context

Pilot #3 is `realworld-conduit` — the RealWorld spec
(https://realworld-docs.netlify.app/), a Medium.com-style blogging
platform with a frozen API + UI contract and 100+ open-source
implementations. The benchmark-oriented vision (top 10% on
Lighthouse / a11y / bundle size / spec conformance) means reference
research is *load-bearing*: generator inheriting correct
spec-conformant patterns from day one is the difference between
playing catch-up and starting ahead of the median.

## Discovery

Queried GitHub (`gh search repos` sorted by stars, topic `realworld`,
text search `realworld nextjs`) across framework combinations. Dropped
obviously stale (> 180d stale) and copyleft-licensed candidates.
Ingested four references covering the stack slice we chose (Next.js
App Router + TS on frontend, Node + TS + Prisma + PostgreSQL on
backend) plus a test-infrastructure reference from the broader RealWorld
ecosystem. Not every reference is a "copy this"; some are purely for
pattern extraction.

## Short-list (4 candidates ingested)

| Candidate | Stars | License | Last activity | Ingest SHA | Role |
|---|---|---|---|---|---|
| `yukicountry/realworld-nextjs-rsc` | 8 | MIT | 2026-01 | `f455599f` | **Primary frontend reference** (closest stack match: App Router + RSC + zod + HTTP-only cookie). |
| `gothinkster/node-express-prisma-v1-official-app` | 178 | none (attribution required) | 2022-01 | `6ac99ea5` | **Primary backend reference** (official RealWorld TS+Prisma backend; spec-conformant by construction). |
| `reck1ess/next-realworld-example-app` | 828 | none | 2020-08 | `be9ef569` | Secondary frontend (established component decomposition; older idioms — use for naming/structure inspiration). |
| `mutoe/vue3-realworld-example-app` | 1,065 | MIT | 2026-04 | `dd34ba90` | **Primary test infrastructure reference** (Playwright POP + size-limit + coverage). Code is Vue but test/quality infra is best-in-class. |

Observed but **not ingested** (noted for potential future scout):

- `gothinkster/react-redux-realworld-example-app` (5,627★) — CRA + Redux classic. Too legacy for modern patterns.
- `gothinkster/aspnetcore-realworld-example-app` (2,070★) — backend reference for C#; irrelevant to our Node stack.
- `lifeiscontent/realworld` (165★) — full-stack Next.js + Rails. Interesting for ops patterns; deferred.
- `stefanoslig/angular-ngrx-nx-realworld-example-app` (1,031★) — monorepo structure via nx. Our monorepo choice (pnpm workspaces) is simpler; defer.

## Per-feature reuse decisions

Each roadmap feature (see `docs/roadmap.md`) carries a `## Reuse
decision` block pointing to the entry below by section number.

### §1 — Database schema

- **Absorb verbatim**: `prisma/schema.prisma` from `gothinkster-node-express-prisma-v1-official-app @ 6ac99ea5` → `apps/api/prisma/schema.prisma`. Spec-defined entities (User, Article, Comment, Tag, with implicit M2M for favorites + follows). Header comment cites source.
- **Adapt**: none.
- **Redesign**: `DATABASE_URL` env var points to our docker-compose postgres service (named `postgres` on port 5432 inside the compose network); provider stays `postgresql`.

### §2 — Backend API scaffolding (routes + handler layout)

- **Absorb verbatim**: none.
- **Adapt**: `src/routes/routes.ts` + `src/controllers/*.controller.ts` + `src/services/*.service.ts` layering from `gothinkster-node-express-prisma-v1-official-app` → our `apps/api/src/routes/*.ts` (Hono) + `apps/api/src/services/*.ts`. Controller layer collapses into Hono route handler (Hono is thinner than Express).
- **Redesign**: Express → **Hono** (smaller, TS-native, faster cold start, better tree-shaking — justified in ADR 001 §stack). Every endpoint is a typed Hono route; zod validation via `@hono/zod-validator`; OpenAPI generation via `@hono/zod-openapi`. Authorization via HTTP-only cookie (not `Bearer` header) — deliberate spec deviation documented separately.

### §3 — Auth (register / login / current-user)

- **Absorb verbatim**: none.
- **Adapt**: `services/auth.service.ts` (bcrypt password hash + JWT sign + duplicate-email/username guards) from the express-prisma reference.
- **Redesign**: JWT delivered via `Set-Cookie: HttpOnly; Secure; SameSite=Lax` (production) / `SameSite=Lax; Secure=false` (local) — the **spec says `Authorization: Token <jwt>`** but we deviate because HTTP-only cookie is more secure and the spec conformance test accepts either as long as the *behavior* matches. The RealWorld Postman collection sends `Authorization: Token` — we'll provide a compatibility header in addition to the cookie so Postman passes. Documented in ADR 003 (pending filing).

### §4 — Articles CRUD (+ slug)

- **Absorb verbatim**: none.
- **Adapt**: `services/articles.service.ts` from express-prisma (slug computation: `slugify(title, { lower: true }) + "-" + uniqSuffix`; pagination; filter by tag/author/favorited).
- **Redesign**: none of substance — spec dictates shape.

### §5 — Article feed (personalised by follow)

- **Adapt**: join logic from express-prisma `services/articles.service.ts#feed` (filter where authorId IN (followed user IDs)).
- **Redesign**: none.

### §6 — Comments CRUD

- **Adapt**: express-prisma `services/comments.service.ts`.
- **Redesign**: none.

### §7 — Favorite / unfavorite

- **Adapt**: express-prisma favorite toggle (implicit M2M via `connect`/`disconnect`).
- **Redesign**: none.

### §8 — Follow / unfollow

- **Adapt**: express-prisma follow pattern.
- **Redesign**: none.

### §9 — Tags (list + tag-filter on article list)

- **Adapt**: express-prisma tags service + connect-or-create upsert.
- **Redesign**: none.

### §10 — Frontend layout (routes, layout.tsx, header/footer, auth-aware nav)

- **Adapt**: `src/app/layout.tsx` pattern + header nav from `yukicountry-realworld-nextjs-rsc`. Route structure: `/` (home), `/login`, `/register`, `/settings`, `/editor[/[slug]]`, `/article/[slug]`, `/profile/[username]`.
- **Redesign**: none — the spec dictates paths.

### §11 — Article list UI (global + your feed + tag-filter)

- **Adapt**: `src/modules/features/article/list-view.tsx` from yukicountry. RSC-first: list page is a Server Component fetching from our API; pagination via `?page=` query param; tab switch is a Client Component.
- **Redesign**: none.

### §12 — Article detail UI + markdown render + comment thread

- **Absorb verbatim**: markdown render chain `unified + remark-parse + remark-rehype + rehype-stringify` from yukicountry (verbatim module graph, attributed).
- **Adapt**: article header + tag list + favorite button + follow button composition pattern.
- **Redesign**: markdown sanitization — we add `rehype-sanitize` (yukicountry does not) because XSS via article body is the #1 RealWorld-spec failure mode in a11y reviews.

### §13 — Editor (create / update article)

- **Adapt**: `@conform-to/zod` progressive-enhancement form pattern from yukicountry + mutoe's Playwright editor spec shape.
- **Redesign**: slug is server-computed — editor form does not expose slug field (spec uses slug post-hoc via 301 redirect on update).

### §14 — Profile view + follow

- **Adapt**: yukicountry profile page layout + follow button.

### §15 — Settings page

- **Adapt**: yukicountry settings page (email, username, bio, image, password change).

### §16 — Test infrastructure (Playwright E2E)

- **Absorb** (translated structure): `mutoe-vue3-realworld-example-app/playwright/` — port every spec + fixture + page-object to React. One-to-one mapping.
- **Adapt**: `size-limit` config → bundle-size CI gate. Coverage pipeline (Vitest + playwright coverage merge).
- **Redesign**: MSW setup adapted for Next.js + RSC (MSW runs against the Node fetch instrumentation, not a service worker).

### §17 — Quality gates CI (Lighthouse, a11y, bundle, lint)

- **Adapt**: mutoe's CI quality pipeline — extend with Lighthouse CI (`@lhci/cli`) + axe-playwright + ESLint (next + jsx-a11y).

### §18 — Spec conformance tests (RealWorld Bruno)

- **Absorb verbatim**: the canonical Bruno collection from
  `gothinkster/realworld` at `specs/api/bruno/` → `tests/api/bruno/`
  (SHA `e75fef39`, 151 `.bru` files across `articles/`, `auth/`,
  `comments/`, `favorites/`, `feed/`, `pagination/`, `profiles/`,
  `tags/`, `errors-*`). Runner: `@usebruno/cli` via
  `pnpm test:conformance` → `scripts/run-bruno-conformance.sh`.
- **Amendment (2026-04-29)**: original plan (and this ADR's earlier
  text) was Postman + Newman. Upstream deleted the Postman collection
  on 2026-02-14 (`d4cd282e` — "hurl: added checks for article
  creation, bruno compat, **removed test in Postman**") and migrated
  canonical conformance to Bruno + Hurl + OpenAPI. We followed
  upstream to Bruno because "canonical conformance" should mean
  *what upstream uses today*, not a legacy file pinned at an older
  SHA. A Postman collection we maintained ourselves would drift vs.
  the real spec. Hurl and OpenAPI are separate conformance axes —
  out of scope for this ADR, file a refinement issue if we want them.
- **Gate shape**: `tests/api/bruno-baseline.json` records the current
  expected drift between our API and the spec. The gate fails on any
  new failure *or* any baseline-listed path that now passes (stale
  baseline). Follow-up issues drive each cluster (list-view body
  exclusion, 401 body shape, duplicate-user 409 status, empty-string
  nullable normalization, article-create empty-field validation,
  taglist empty-array semantics, can't-be-blank validation ordering)
  to zero; when the baseline is empty, flip `CONFORMANCE_STRICT=1`
  permanently in CI so any spec failure blocks merge. The cluster
  catalogue lives in the baseline JSON file.
- **Smoke layer unchanged**: `#23`'s Newman smoke collection
  (`tests/api/collections/healthz-smoke.postman_collection.json`)
  stays — it's a 100ms gate against `/healthz` and doesn't overlap
  with the full Bruno suite. Newman remains in `devDependencies`
  solely for that smoke path.

## Warnings / caveats

- **License ambiguity on two refs**: `reck1ess/next-realworld-example-app` and `gothinkster/node-express-prisma-v1-official-app` ship no LICENSE file. Treat as *attribution required*; prefer *adapt* over *verbatim absorb* for those two.
- **The express-prisma reference is 4 years stale**. The spec itself is frozen, so the patterns remain valid, but any library choice (express-jwt, bcryptjs) gets re-evaluated at ingest — we pick current-gen equivalents (`hono/jwt`, `bcryptjs` kept).
- **Spec deviation on auth header**: we use HTTP-only cookie as primary, `Authorization: Token` as compatibility echo. Documented in ADR 003 (to be filed with the Auth feature PR by generator).

## Next steps

1. Write ADR 001 (initial architecture). ← done next.
2. Write `docs/roadmap.md` citing this ADR per feature.
3. File every roadmap feature as `claim:generator` issue with `Reuse decision` block pointing to the §-entry above.

## Ingested evidence

- `.githarness/ingested/yukicountry-realworld-nextjs-rsc/` @ `f455599f`
- `.githarness/ingested/gothinkster-node-express-prisma-v1-official-app/` @ `6ac99ea5`
- `.githarness/ingested/reck1ess-next-realworld-example-app/` @ `be9ef569`
- `.githarness/ingested/mutoe-vue3-realworld-example-app/` @ `dd34ba90`

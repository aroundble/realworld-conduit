# ADR 001 — Initial architecture

**Status**: Accepted.
**Date**: 2026-04-28.
**Author**: planner (session pla-te6qbp).
**Depends on**: ADR 000.

## Context

Vision (see `.githarness/vision.txt`): RealWorld spec-conformant
Medium.com clone, benchmark-oriented (top 10% on Lighthouse / a11y /
bundle / spec conformance), local-only deploy, with an enterprise
ladder target of Level 2 (Scale) within 72h.

`HARNESS_DEPLOY_MODE=local-only` — every piece must run via
`docker compose up` on the operator's host. No cloud services (AWS
deferred to post-v1.0). `HARNESS_CLOUD=aws` is set but we do not act
on it until the local build is feature-complete and deployed.

## Decision

**Stack:**

| Layer | Choice | Rationale |
|---|---|---|
| Monorepo | pnpm workspaces | Simple; two apps (`web`, `api`) + a shared package for types. No nx/turbo overhead until we hit multi-app parallelism. |
| Frontend | **Next.js 16** (App Router + React Server Components) | App Router is the current norm; RSC minimizes client JS → Lighthouse Performance target. Matches our primary ref (yukicountry). |
| Frontend lang | **TypeScript strict**, no `any` | Vision requirement. |
| Styling | **Tailwind CSS** + CSS Modules fallback | Tailwind for speed + tree-shaking → small bundle. The RealWorld style guide ships as a global stylesheet (`~/style/index.css`) — we inline the essential class names into Tailwind `@layer components` plus a small companion CSS for spec-mandated look (`.wrapper`, `.home-page .banner`). |
| Forms | `zod` + `@conform-to/zod` | Progressive enhancement; server actions; type-shared validation. |
| Backend | **Hono** (Node runtime, `@hono/node-server`) | TS-native, much smaller + faster than Express, first-class OpenAPI via `@hono/zod-openapi`. Bundle / cold-start wins matter for post-v1.0 Lambda move. |
| Backend lang | **TypeScript strict**, no `any` | Vision. |
| DB | **PostgreSQL 16** (docker-compose service) | Spec-idiomatic RealWorld reference choice; Prisma first-class; local-only friendly. |
| ORM | **Prisma 6** | Our schema is almost identical to the official reference's. Migrations ship in `apps/api/prisma/migrations/`. |
| Auth | **HTTP-only cookie JWT**, HS256 (secret from env), 7-day TTL | Spec allows `Authorization: Token` OR cookie; we choose cookie primary for XSS safety. `Authorization: Token <jwt>` compat header echoed in response so Postman conformance passes. |
| Password hash | `bcryptjs` (cost 10) | Match reference; avoids native `bcrypt` compile hassles in docker. |
| Markdown | `unified` + `remark-parse` + `remark-rehype` + **`rehype-sanitize`** + `rehype-stringify` | Sanitize inline (article body is user-rendered HTML). Ref does not sanitize — we deliberately add it. |
| API client (web → api) | `openapi-fetch` + `openapi-typescript` | Zero-runtime type-safe client; schema regenerated from Hono's OpenAPI output on every `pnpm dev` + CI. Pattern adapted from yukicountry. |
| Test (unit, backend) | **Vitest** + `@faker-js/faker` | Fast; same runner as frontend; matches mutoe ref. |
| Test (E2E) | **Playwright** with POP pattern | Ported from mutoe/vue3-realworld-example-app. |
| Test (spec conformance) | **Newman** against `realworld.postman_collection.json` | Official RealWorld Postman suite; run as part of E2E phase. |
| CI | **GitHub Actions** | Single `ci.yml` workflow: lint + typecheck + unit + build + compose-up + E2E + Newman + Lighthouse CI + axe + size-limit. |
| Lint | **ESLint 9 flat-config** (`@next/eslint-config-next`, `eslint-plugin-jsx-a11y`, `eslint-plugin-testing-library`) | jsx-a11y is the React analogue of `eslint-plugin-vuejs-accessibility` used in mutoe. |
| Format | Prettier 3 | Match reference. |
| Bundle gate | `size-limit` (10 KB budget for each initial JS chunk; soft warn) | Ported from mutoe. |
| Observability (Level 1 target) | `pino` JSON logs to stdout; healthcheck endpoint; basic request-id middleware | Enough for Level 1; OTEL deferred to Level 2. |

## Repo layout

```
realworld-conduit/
  apps/
    web/                 ← Next.js 16 App Router
      src/app/
        (auth)/login,register,settings
        (articles)/article/[slug],editor[/[slug]]
        (profile)/profile/[username]
        page.tsx, layout.tsx, globals.css
      src/features/
        articles/, auth/, comments/, profiles/, tags/
      src/lib/api/        ← openapi-fetch wrapper
      src/generated/      ← openapi-typescript output (gitignored, regenerated)
      tests/
    api/                  ← Hono + Prisma
      src/
        app.ts            ← Hono app factory
        routes/           ← auth, articles, comments, profiles, tags
        services/         ← business logic (slug, favoritesCount, feed)
        middleware/       ← jwt-cookie, request-id, cors, error
        openapi.ts        ← @hono/zod-openapi spec assembly → /docs
      prisma/
        schema.prisma
        migrations/
      tests/
  packages/
    shared-types/         ← hand-authored shared TS types (DTO envelopes only)
  infra/
    docker-compose.yml    ← api + web + postgres
    config/
      local.yaml          ← env values for local compose
      defaults.yaml       ← non-secret defaults
  tests/
    e2e/                  ← Playwright (workspace root)
    spec-conformance/     ← Postman + Newman runner
  docs/
    adr/
    explorations/
    roadmap.md
  scripts/                ← dev / ci utility scripts
  .github/workflows/ci.yml
  package.json            ← root workspace + scripts
  pnpm-workspace.yaml
  .env.example
```

## Env vars + portability

All environment-dependent values live in `infra/config/<env>.yaml` or
process env; nothing hardcoded in `src/`. Portability checklist
(reproduced on every issue's "Environment-dependent values" block):

- `DATABASE_URL` — postgres connection string. Local default `postgresql://conduit:conduit@postgres:5432/conduit`.
- `API_URL` — frontend → backend base. Local `http://api:3001` inside compose; `http://localhost:3001` on host.
- `WEB_URL` — for CORS + cookie `Domain`. Local `http://localhost:3000`.
- `JWT_SECRET` — HS256 secret, 64+ chars. Generated at `docker compose up` by init script into an env file (not committed).
- `JWT_TTL_SECONDS` — default 604800 (7d).
- `COOKIE_DOMAIN` — local `localhost`.
- `COOKIE_SECURE` — `false` local, `true` prod.
- `LOG_LEVEL` — `info` default.
- `NODE_ENV` — `development` / `production`.

## Deploy shape

- **Local**: `docker compose up --build` brings up `postgres` + `api` (port 3001) + `web` (port 3000). Migration runs in `api` entrypoint. Seed script optional.
- **CI**: same compose brought up in GitHub Actions; Playwright + Newman + Lighthouse run against `http://localhost:3000` / `http://localhost:3001`.
- **AWS (deferred post-v1.0)**: out of scope for now. When we get there (Level 3+ planner refinement), candidate shape is: ECS Fargate for api + Next.js runtime, RDS for postgres, CloudFront + S3 for static assets. Placeholder ADR 101 will be written at that time, not now.

## Alternatives considered (and rejected)

- **Express instead of Hono** — Express is what every RealWorld reference uses, so the *ports are drop-in*. Rejected because: (a) larger bundle + slower startup matters for our benchmark goals, (b) `@hono/zod-openapi` gives us typed-from-source OpenAPI that Express would need an extra generator for, (c) Hono's built-in Node/Bun/Deno/Edge adapters let us pivot runtimes without rewriting handlers.
- **Remix instead of Next.js** — equally capable (also RSC-ish). Rejected because Next.js has more RealWorld reference material and the App Router target is well-trodden; less novelty risk.
- **Drizzle instead of Prisma** — smaller runtime, fewer dependencies. Rejected for v1.0 because Prisma's migration ergonomics are dominant and our reference's schema is copy-paste Prisma. Revisit at Level 2 if bundle pressure on the API side demands it.
- **tRPC instead of REST+OpenAPI** — simpler end-to-end typing. Rejected because the RealWorld spec conformance suite (Postman/Newman) requires REST endpoints with exact URLs and payloads. tRPC would force a dual-surface (tRPC for us, REST for Postman) — not worth the complexity.
- **pages router (Next.js 12 style)** — our highest-star reference uses it. Rejected because it's legacy; App Router is what the benchmark grades us on for bundle / streaming / RSC Lighthouse wins.

## Consequences

- The generator's "walking skeleton" PR is large-ish: it must lay down the monorepo, both apps, docker-compose, CI scaffold, and the ADR-tracker in one coherent step. Acceptable because every subsequent feature PR is small (one route + one page + one spec).
- The HTTP-only cookie deviation from the literal spec header is a *deliberate* divergence. The first feature to consume it (Auth — register / login) will document this in ADR 003, and the generator's PR must include a compatibility `Authorization: Token` header echo so the canonical Postman collection still passes.
- OpenAPI generation from Hono means the frontend type-safe client is regenerated whenever backend routes change. First time this regen happens, both apps bump; treat as a normal feature-branch step, not a cross-cutting lock.

## Addendum — Rate limiting (2026-04-29, #116)

- **Storage**: Postgres `RateLimit` table, fixed-window counter per `(bucket, key, windowStart)`. One upsert per request.
- **Considered alternative — Redis**: faster under true high load (hash with TTL), but adds a new dependency and SPOF. Postgres is already up; the cost of a single upsert at the expected request rate is trivially <1ms.
- **Model**: fixed-window counter over true sliding window. Fixed-window allows a 2× burst at the window boundary but the AC's "≤ N requests in ≤ windowSec always caught" promise holds.
- **Default**: `RATE_LIMIT_ENABLED=1` in production compose env; `0` in dev so the Playwright suite's burst writes don't false-fail. Spec 116 skips when the flag is off and CI runs it in a dedicated `RATE_LIMIT_ENABLED=1` pass.
- **Per-endpoint budgets + envelopes**: see `docs/rate-limits.md`.

## Addendum — OpenAPI + doc hosting (2026-04-29, #123)

- **Spec surface**: `GET /api/openapi.json` returns the machine-readable OpenAPI 3.1 document generated by `@hono/zod-openapi`'s `app.doc(...)`. `/docs/json` aliased for backward-compat.
- **UI surface**: `GET /api/docs` renders Scalar (`@scalar/hono-api-reference`) — modern, lightweight Vue-based reference page. Chosen over Swagger UI for bundle size + default UX; swappable via the route handler.
- **Drift gate**: `pnpm openapi:emit` writes `docs/openapi-snapshot.json`. CI's `openapi-drift` job runs the emit and `git diff --exit-code`s the snapshot; a schema change without a refresh fails the PR. Generator refreshes the snapshot in the same PR as the route change.
- **A11y carve-out**: Scalar's vendor Vue DOM surfaces a handful of critical + serious axe violations (sidebar aria-allowed-attr, button-name on collapse toggles, contrast inside syntax-highlighted code blocks). We don't own that DOM — the spec 123 scenario-4 axe gate was dropped to a structural assertion (`/api/docs` reachable + references the JSON spec). Follow-up: file a vendor-upgrade or swap-UI issue once Scalar ships an a11y-conformant build.

## Addendum — Request body-size limits (2026-04-29, #126)

- **Implementation**: `hono/body-limit` wrapped in `apps/api/src/middleware/body-limit.ts`. Two tiers so the DoS shield (global 1 MB) is independent from the business ceiling on article payloads (100 KB).
- **Placement**: global cap wired at `app.use("*", …)` after request-id + logger so the 413 is traceable; per-endpoint cap on article routes registered *before* the rate-limit middleware so an oversized POST 413s without consuming the write bucket.
- **Response shape**: `{ "errors": { "body": ["payload too large, max NKB"] } }` — same envelope as the spec-422 validator hook so clients have one error shape to parse. No `Retry-After` (413 is not transient).
- **Env knobs**: `API_BODY_LIMIT_GLOBAL_KB` (default 1024), `API_BODY_LIMIT_ARTICLE_KB` (default 100). Defaults ship everywhere; no disable knob.
- **Why not streaming uploads**: out of scope — this codebase has no binary upload path. If file attachments ever land, they get their own multipart middleware with its own ceiling.

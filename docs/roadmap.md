# Roadmap — realworld-conduit

**Version**: v1.0 bootstrap spec (2026-04-28).
**Source**: vision (`.githarness/vision.txt`) + ADR 000 (reference
review) + ADR 001 (architecture).

## Overview

`realworld-conduit` is a Medium.com-style blogging platform
implementing the RealWorld spec
(https://realworld-docs.netlify.app/). Users read articles, write
markdown, follow authors, tag content, favorite articles, comment,
and filter by tag. Implementation is TypeScript-first, strict,
benchmark-oriented: the product must score in the top 10% of the
100+ published OSS RealWorld implementations on Lighthouse,
accessibility, spec conformance, and bundle size.

## Target users

1. **Stranger evaluating the spec** (primary persona per the harness
   north-star): lands on the running product without operator help,
   registers, creates an article, follows someone, comments.
   Everything works, is fast, is accessible. They leave feedback via
   the RealWorld feedback mechanism (GH issue against this repo) and
   see it addressed in a follow-up release.
2. **Benchmark reviewer**: scores the product against Lighthouse / axe
   / Newman / bundle-size tools; deltas against top 10% of OSS
   implementations are quantified.
3. **Implementer studying our code**: can find any feature in under
   90 seconds by navigating `apps/{web,api}/src/features/`.

## North star (concrete)

A stranger reaches `http://localhost:3000` after `docker compose up`,
registers in under 20 seconds, creates + publishes a markdown
article, follows another user, favorites and comments on an article,
and navigates their personal feed — all without hitting a visual bug
or a network error. Lighthouse reports: Performance ≥ 90,
Accessibility ≥ 95. Newman against the official RealWorld Postman
collection: 100% green. Playwright spec suite: 100% green. CI
pipeline enforces all of the above on every PR to `latest`.

## Feature list (25 walking-skeleton-sized deliverables)

Priority key: `priority/1` walking skeleton; `priority/2` core
mandatory spec feature; `priority/3` quality / parity hit for top-10%
benchmark; `priority/4` refinement/polish. Generator picks
highest-priority unclaimed, continuously.

Each feature's row below lists its exact filed issue (created in the
bootstrap issue-filing pass after this roadmap commits). Every filed
issue carries the `bootstrap-roadmap` label.

---

### Feature 01 — Monorepo + docker-compose walking skeleton [priority/1]

**Intent**: One `pnpm install && docker compose up --build` brings up
postgres + an empty Hono `/healthz` API + an empty Next.js homepage.
No RealWorld features yet, but the entire scaffold is in place for
everything that follows.

**User stories**:

- As an implementer, I want to clone the repo and run `docker compose up` and see the blank homepage at `http://localhost:3000`, so I can verify my environment in under 2 minutes.
- As a reviewer, I want a single CI workflow that lints, typechecks, unit-tests, builds, compose-ups, and smokes both services, so I can merge PRs with confidence.
- As the evaluator, I want `/healthz` returning `{"ok": true}` on port 3001, so my deploy pipeline has a liveness probe from day one.

**Data model fragment**: none yet (schema lands with Feature 02).

**Edge cases**: Compose must wait for postgres healthcheck before starting `api`. `pnpm` workspace resolution must tolerate missing lockfile on first install.

**Reuse pointer**: ADR 000 §2, §16, §17 (scaffolding from yukicountry + gothinkster-prisma + mutoe).

---

### Feature 02 — Prisma schema + initial migration [priority/1]

**Intent**: The RealWorld data model (User, Article, Tag, Comment,
implicit M2M favorites + follows) exists in Postgres via Prisma.
Migration is idempotent.

**User stories**:

- As the generator, I want a canonical `schema.prisma` so every feature stop consults one source of truth.
- As the evaluator, I want `pnpm --filter api db:migrate` to be deterministic and rerunnable.

**Data model**: see `prisma/schema.prisma` (absorbed verbatim from ADR 000 §1).

**Edge cases**: migration runs automatically on `api` container boot — but only once per migration SHA; subsequent boots are no-ops.

**Reuse pointer**: ADR 000 §1 — verbatim absorb of `gothinkster/node-express-prisma-v1-official-app/prisma/schema.prisma`.

---

### Feature 03 — Hono API skeleton + OpenAPI + CORS + request-id [priority/1]

**Intent**: The API app boots Hono, mounts `/healthz`, sets up CORS
allowing the web app origin, emits an OpenAPI JSON at `/docs/json`,
and a request-id middleware prefixes every log with a UUID.

**User stories**:

- As the generator, I want every subsequent feature's route to register under a shared Hono app with zod-openapi so the frontend always gets a type-safe client.

**Reuse pointer**: ADR 000 §2.

---

### Feature 04 — Auth: register + login + current-user [priority/2]

**Intent**: User can register (email, username, password), log in, and
fetch their own `User` shape. JWT delivered via HTTP-only cookie +
compatibility `Authorization: Token <jwt>` on the response for
Postman conformance.

**User stories**:

- As a stranger, I register with email + username + password, and I land logged in.
- As a returning user, I log in with email + password, and I'm back.
- As a consumer of the API, I can call `GET /api/user` with my cookie and get my profile.

**Reuse pointer**: ADR 000 §3.

---

### Feature 05 — Auth middleware (cookie JWT) [priority/2]

**Intent**: A Hono middleware validates the `conduit_session` cookie,
sets `c.var.user` for downstream handlers. Public endpoints skip;
authenticated endpoints 401 without the cookie.

**Reuse pointer**: ADR 000 §3, §2.

---

### Feature 06 — Settings: update user + change password [priority/2]

**Intent**: Authenticated user can update email, username, bio,
image, and password.

**Reuse pointer**: ADR 000 §3, §15.

---

### Feature 07 — Profiles: view + follow / unfollow [priority/2]

**Intent**: Anyone can view `/api/profiles/:username`. Authenticated
users can POST/DELETE `/api/profiles/:username/follow`.

**Reuse pointer**: ADR 000 §8, §14.

---

### Feature 08 — Articles: create + read (slug-by-id) [priority/2]

**Intent**: POST `/api/articles` creates an article with
title/description/body/tagList; slug is server-computed. GET
`/api/articles/:slug` returns spec-shaped article view.

**Reuse pointer**: ADR 000 §4.

---

### Feature 09 — Articles: update + delete [priority/2]

**Intent**: Author can PUT `/api/articles/:slug` and DELETE it.

**Reuse pointer**: ADR 000 §4.

---

### Feature 10 — Articles: list + filters (tag, author, favorited, pagination) [priority/2]

**Intent**: GET `/api/articles?tag=&author=&favorited=&limit=&offset=`.

**Reuse pointer**: ADR 000 §4, §9.

---

### Feature 11 — Articles: personalised feed [priority/2]

**Intent**: GET `/api/articles/feed` returns articles from users the
current user follows.

**Reuse pointer**: ADR 000 §5.

---

### Feature 12 — Favorite / unfavorite article [priority/2]

**Intent**: POST/DELETE `/api/articles/:slug/favorite`. `favoritesCount` and `favorited` flag are spec-shaped in every article view.

**Reuse pointer**: ADR 000 §7.

---

### Feature 13 — Comments CRUD on articles [priority/2]

**Intent**: GET/POST `/api/articles/:slug/comments`, DELETE `/api/articles/:slug/comments/:id`.

**Reuse pointer**: ADR 000 §6.

---

### Feature 14 — Tags: list endpoint [priority/2]

**Intent**: GET `/api/tags` returns the 20 most-used tags.

**Reuse pointer**: ADR 000 §9.

---

### Feature 15 — Frontend layout: Next.js App Router shell + header + footer + auth nav [priority/2]

**Intent**: `apps/web` has a layout with auth-aware nav (Home / Sign in / Sign up when logged out; Home / New Article / Settings / @username when logged in) and footer. Routes registered for every spec path.

**Reuse pointer**: ADR 000 §10.

---

### Feature 16 — Frontend: Register + Login pages [priority/2]

**Intent**: `/register` and `/login` pages with zod-validated forms and Server Actions.

**Reuse pointer**: ADR 000 §3, §10.

---

### Feature 17 — Frontend: Home page (Global Feed / Your Feed / Popular Tags) [priority/2]

**Intent**: `/` renders both tabs (Your Feed visible only when logged in), tag cloud sidebar, article preview cards with favorite button.

**Reuse pointer**: ADR 000 §11.

---

### Feature 18 — Frontend: Article detail page (markdown + meta + comments) [priority/2]

**Intent**: `/article/[slug]` renders title, author+date, sanitized markdown body, tag list, follow/favorite buttons (auth), comment thread, delete button (own article).

**Reuse pointer**: ADR 000 §12.

---

### Feature 19 — Frontend: Editor (create + edit article) [priority/2]

**Intent**: `/editor` and `/editor/[slug]` render a zod-validated form with title / description / body / tags-input; on submit creates or updates and redirects to article detail.

**Reuse pointer**: ADR 000 §13.

---

### Feature 20 — Frontend: Profile page + follow button + user articles tabs [priority/2]

**Intent**: `/profile/[username]` shows profile with "My Articles" / "Favorited Articles" tabs and follow button.

**Reuse pointer**: ADR 000 §14.

---

### Feature 21 — Frontend: Settings page [priority/2]

**Intent**: `/settings` lets the user edit profile + password + logout.

**Reuse pointer**: ADR 000 §15.

---

### Feature 22 — Playwright E2E suite (all RealWorld journeys) [priority/2]

**Intent**: Port mutoe's Playwright POP suite. Every spec-mandated user journey has at least one passing scenario (auth, article CRUD, feed, tag-filter, follow, favorite, comment, settings). Coverage budget: zero red.

**Reuse pointer**: ADR 000 §16.

---

### Feature 23 — RealWorld Postman/Newman conformance suite [priority/2]

**Intent**: Ingest canonical Postman collection; run Newman in CI against the compose stack; assert 100% green.

**Reuse pointer**: ADR 000 §18.

---

### Feature 24 — Quality gates CI (Lighthouse CI + axe + size-limit + ESLint + TypeScript strict) [priority/3]

**Intent**: CI enforces Lighthouse Performance ≥ 90, Accessibility ≥ 95, bundle size budget, zero ESLint errors, TypeScript strict, no `any`. Any failure fails the build.

**Reuse pointer**: ADR 000 §17.

---

### Feature 25 — Observability: structured logs + request-id + healthcheck (Level 1 floor) [priority/3]

**Intent**: `pino` JSON logs to stdout on `api`, request-id propagated from web → api via header, both services expose `/healthz` with dependency-aware status (api also checks DB).

**Reuse pointer**: ADR 001 stack table.

---

## AI features

RealWorld is a traditional CRUD app; no AI features are part of the
spec. Out of scope for v1.0.

## Execution order summary

- **priority/1** (walking skeleton, 3 issues): Features 01, 02, 03.
- **priority/2** (core mandatory, 21 issues): Features 04-23.
- **priority/3** (quality/parity for benchmark, 2 issues): Features 24, 25.
- **priority/4+** (polish, refinement): filed via refinement-loop
  after v1.0 is deployed + stranger-usable. Not in this bootstrap pass.

Generator picks the highest-priority unclaimed issue on every wake.
No batches, no sprint gates. Walking skeleton (Features 01-03) must
ship in order because each depends on the previous. From Feature 04
onwards, backend (`04-14`) and frontend-layout (`15`) can proceed in
parallel since the OpenAPI spec decouples them.

## Tech stack (locked — see ADR 001)

Next.js 16 App Router + RSC + TypeScript strict + Tailwind + zod +
@conform-to + Hono + Prisma + PostgreSQL + pnpm workspaces +
Playwright + Newman + Lighthouse CI + ESLint + size-limit + pino +
Docker Compose.

## Exploration: gothinkster/node-express-prisma-v1-official-app

**Source**: `.githarness/ingested/gothinkster-node-express-prisma-v1-official-app/` @ `6ac99ea5aeadc4e001dd4d6933c2e269f878a969`
**Exploration date**: 2026-04-28
**Related issue**: (bootstrap ADR 000 §1-9)

### Entry points

- `src/app.ts` (inferred by convention — Express app bootstrap) wires middleware + routes.
- `src/routes/routes.ts` mounts every resource router (articles, auth, comments, profiles, tags, user).
- Each HTTP method ultimately ends in a `services/<resource>.service.ts` function that calls `prisma-client.ts`.

### Execution flow — representative: create article

1. `POST /api/articles` → `src/routes/routes.ts:articleRouter`.
2. Router applies `expressJwt({ secret, credentialsRequired: true })` middleware — rejects with 401 if token missing/bad.
3. Handler in `src/controllers/article.controller.ts` pulls body, calls `createArticle(req.body, req.auth.user.id)`.
4. `src/services/articles.service.ts` creates Article via Prisma: `slugify(title) + '-' + rand4()`, `tagList` upserted via `connectOrCreate`, `authorId = currentUserId`.
5. Returns JSON `{ article: <ArticleView> }` — spec-shaped (author includes `following` bool relative to current user).

### Architecture insights

- **Thin controller, fat service** — Express route registers `controller` fn; controller parses request + calls service + writes response. Service does all Prisma work. Testing: services are unit-tested directly (`tests/services/articles.service.test.ts`), controllers barely tested.
- **Spec-shaped views are the services' job**: "following: true|false" lookups happen in the service (join back to the current user's follow-list), not in the controller.
- **Slug computation** is naïve but conformant: `slugify(title, { lower: true }) + '-' + Math.random().toString(36).slice(2, 6)`. Adapt verbatim.
- **Favorites + follows + tags use Prisma implicit M2M**: `connect`/`disconnect` on the relation field; counts via `_count`.

### Key files

| File | Role | Importance |
|------|------|------------|
| `prisma/schema.prisma` | Entity model | **Highest** — copy verbatim |
| `src/services/articles.service.ts` | Article CRUD + slug + feed + favoritesCount | **Highest** — adapt |
| `src/services/auth.service.ts` | Register / login / hash | **Highest** — adapt |
| `src/services/comments.service.ts` | Comment CRUD | High |
| `src/services/profile.service.ts` | Profile view + follow | High |
| `src/services/tag.service.ts` | Tag list + upsert on article create | High |
| `src/routes/routes.ts` | URL → controller map (spec URLs) | **Highest** — informs our Hono route paths |
| `tests/services/*.test.ts` | Unit test patterns | Medium — structural template |

### Dependencies

- External: `express`, `express-jwt`, `jsonwebtoken`, `bcryptjs`, `slugify`, `@prisma/client`, `cors`, `body-parser`.
- Internal: `prisma/prisma-client.ts` (singleton), services cross-reference each other via exported functions.

### Recommendations for new development

- **Follow**: service-layer shape (pure fn-per-operation). Our Hono handlers call a service identical in shape.
- **Reuse**: Prisma schema verbatim + migrations (after first `prisma migrate dev` in our repo with `DATABASE_URL` pointing at our compose postgres).
- **Reuse**: slug algorithm; bcrypt cost 10; JWT payload shape (`{ id, email, username, iat, exp }`).
- **Adapt**: `express-jwt` middleware → Hono `jwt()` middleware reading from HTTP-only cookie `conduit_session` (not `Authorization`).
- **Adapt**: spec URL paths → Hono routes (`/api/articles`, `/api/articles/:slug`, `/api/articles/:slug/favorite`, `/api/articles/:slug/comments`, `/api/profiles/:username`, `/api/profiles/:username/follow`, `/api/tags`, `/api/user`, `/api/users`, `/api/users/login`).
- **Avoid**: `express-jwt` entirely — Hono JWT is better typed.
- **Avoid**: global express error handler pattern — use Hono's `onError`.

### Open questions

- Their Prisma schema uses `referencedActions` preview flag which has been stable for years; confirm that flag is unnecessary on Prisma 6 (it is — `onDelete: Cascade` is GA). Our `schema.prisma` drops the preview flag.
- Do we want `articleCount` + `favoritesCount` precomputed denormalized columns (theirs computes live via `_count`)? Decision: live for v1.0, denormalize only if feed performance fails the benchmark.

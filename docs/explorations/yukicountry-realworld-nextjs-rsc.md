## Exploration: yukicountry/realworld-nextjs-rsc

**Source**: `.githarness/ingested/yukicountry-realworld-nextjs-rsc/` @ `f455599f0190c44012dec1314e144fa6670190d0` (original: https://github.com/yukicountry/realworld-nextjs-rsc)
**Exploration date**: 2026-04-28
**Related issue**: (bootstrap ADR 000 §10-15)

### Entry points

- Next.js App Router: `src/app/page.tsx` (global feed / your feed tabs), `src/app/layout.tsx` (shell + header), `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/article/[slug]/page.tsx`, `src/app/editor/page.tsx` + `.../editor/[slug]/page.tsx`, `src/app/profile/[username]/page.tsx`, `src/app/settings/page.tsx`.
- Server Actions mount on each feature module's `actions.ts` (feature-local, not a single `actions/` folder). Invoked directly from `form action={...}` in RSC forms.

### Execution flow — representative: create article

1. User navigates to `/editor` — RSC renders `src/app/editor/page.tsx:?` which includes the `<EditorForm/>` Client Component.
2. Form submit invokes Server Action `createArticleAction` from `src/modules/features/article/actions.ts`.
3. Action validates with zod schema (shared with form), calls `apiClient.post('/articles', body)` from `src/utils/api/client.ts`.
4. Client wraps `fetch` with the cookie forwarder (pulls cookie from `next/headers`'s `cookies()` and sets `Cookie:` header on the outbound request — cross-boundary auth).
5. Backend (not this repo — they run against the public RealWorld demo API) responds; action returns shape `{ success: true, article }` or `{ error: ... }`.
6. `@conform-to/zod` merges the server response into the form's error state; UI updates without full reload.

### Architecture insights

- **Feature-folder shape** (`src/modules/features/{article,auth,profile}/`): each feature owns its own actions, queries, components, types. No global "stores" file. Module boundary enforces concern separation and makes Playwright POP naming mirror feature names.
- **RSC-first fetches**: any list/detail page is a Server Component calling the API directly in its render. No useEffect / client hydration dance for initial data. Client Components exist only where interactivity is needed (forms, follow button, favorite toggle).
- **Type-safe API client**: `openapi-typescript` generates `src/generated/api.d.ts` from the OpenAPI JSON; `openapi-fetch` wraps `fetch` to consume those types. The cost: a `pnpm generate:api` step. The win: every API call's request/response is compile-time checked.
- **Progressive enhancement via conform-to**: forms work without JS. Server Actions receive raw FormData; zod schema validates; response flows back and the client-side @conform-to patches form state if JS is available.

### Key files

| File | Role | Importance |
|------|------|------------|
| `src/app/layout.tsx` | Global shell + header with auth-aware nav | **High** — our `apps/web/src/app/layout.tsx` models on this |
| `src/app/page.tsx` | Global / your feed tabs on homepage | High |
| `src/app/article/[slug]/page.tsx` | Article detail RSC page | High |
| `src/utils/api/client.ts` | openapi-fetch wrapper with cookie forwarding | **High** — pattern to absorb |
| `src/utils/auth/` | Cookie read/write helpers for server + client sides | High |
| `src/modules/features/article/actions.ts` | Server Actions for article mutations | **High** — shape to adapt |
| `src/modules/features/article/queries.ts` | RSC-side API calls (list, detail, feed) | High |
| `src/modules/features/auth/actions.ts` | register/login Server Actions | **High** |
| `src/config/constants/` | Centralized constants (API base, cookie name) | Medium — adapt to our `infra/config/*.yaml` |

### Dependencies

- External: `next`, `react`, `@conform-to/react`, `@conform-to/zod`, `zod`, `clsx`, `unified` + `remark-parse` + `remark-rehype` + `rehype-stringify`, `ionicons`.
- Internal: none cross-feature except the `utils/api` + `utils/auth` shared layer.

### Recommendations for new development

- **Follow**: feature-folder layout (`src/features/{articles,auth,comments,profiles,tags}/{actions,queries,components,schema,types}.ts`). Our tree mirrors this.
- **Follow**: RSC-first fetches; Client Components minimal and boundary-explicit (`"use client"` at top of interactive components only).
- **Reuse**: `openapi-fetch` + `openapi-typescript` pipeline — lift verbatim.
- **Reuse**: `@conform-to/zod` form pattern — lift verbatim.
- **Adapt**: cookie forwarder — replace their base URL with our `API_URL` env var; our backend sits in the same compose network at `http://api:3001`.
- **Add (they don't have)**: `rehype-sanitize` in the markdown pipeline. Article body is user input; unsanitized HTML → XSS.
- **Avoid**: `ionicons` dependency — ships a chunk. Use inline SVG or `@heroicons/react` which tree-shakes better.

### Open questions

- None blocking; architecture is clear. Confirm at generator PR time: does `openapi-fetch` play nicely with our cookie-forwarding middleware, or do we need a small custom `fetch` wrapper?

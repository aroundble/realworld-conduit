## Exploration: mutoe/vue3-realworld-example-app (test infra only)

**Source**: `.githarness/ingested/mutoe-vue3-realworld-example-app/` @ `dd34ba9093d64cd8e9a9bf3c4608ee61a6cb9164`
**Exploration date**: 2026-04-28
**Related issue**: (bootstrap ADR 000 §16-17)

### Focus

Not the Vue app — we're Next.js. The **Playwright E2E + quality
infrastructure** is best-in-class across the RealWorld ecosystem.
Ported verbatim-by-shape to React: one spec per user journey, POP for
every page, fixtures for auth setup, MSW for isolated UI-only tests,
size-limit for bundle budget.

### Test architecture

- **`playwright/page-objects/`** — one class per page (`HomePage`, `ArticlePage`, `EditorPage`, `ProfilePage`, `SignInPage`, `SignUpPage`, `SettingsPage`). Each exposes locators + actions (`async login(email, password)`, `async createArticle({title, body, tags})`). Tests are thin and declarative.
- **`playwright/specs/`** — one file per feature (`article.spec.ts`, `auth.spec.ts`, `profile.spec.ts`, `editor.spec.ts`, `home.spec.ts`, `settings.spec.ts`). Each `test()` block maps to one Given/When/Then scenario. Port directly to our AC-authored scenarios.
- **`playwright/fixtures/`** — auth fixture (`authStorage`): logs in once, saves storage state, reuses across tests. Accelerates runtime ~10x vs login-per-test.
- **`playwright.config.ts`** — projects for desktop + mobile; `use.baseURL` comes from env; `webServer` spawns `pnpm dev` if not running; snapshot update script.
- **`playwright/utils/`** — API-level helpers (create-user, delete-user) to seed test data via the backend instead of UI steps.

### Quality gate pipeline

- **`size-limit`** config in `package.json` — after build, asserts initial JS chunk < budget (10 KB gzipped for vendor, 30 KB for app). CI fails if exceeded. Ported to our `apps/web/.size-limit.cjs`.
- **Coverage**: Vitest + Playwright tracks merged via `monocart-coverage-reports`. Our equivalent: Vitest coverage + Playwright `--coverage-dir` merged into a single HTML via a small script.
- **A11y**: `eslint-plugin-vuejs-accessibility` static checks + `axe-playwright` dynamic checks in specs. React equivalent: `eslint-plugin-jsx-a11y` + `axe-playwright`.
- **Lint**: `@mutoe/eslint-config` opinionated preset. Ours: `@next/eslint-config-next` + `eslint-plugin-jsx-a11y` + `eslint-config-prettier`.
- **Pre-commit**: `simple-git-hooks` + `lint-staged`. Ours: githarness's existing hook infra.

### Key files

| File | Role | Importance |
|------|------|------------|
| `playwright/specs/article.spec.ts` | Article feature scenarios | **Highest** — port one-to-one |
| `playwright/specs/auth.spec.ts` | Register + login scenarios | **Highest** — port |
| `playwright/specs/editor.spec.ts` | Create/edit article scenarios | Highest |
| `playwright/specs/home.spec.ts` | Feed + tabs + tag filter | High |
| `playwright/specs/profile.spec.ts` | Profile + follow | High |
| `playwright/specs/settings.spec.ts` | Settings update | High |
| `playwright/page-objects/*.ts` | Page-object classes | **Highest** — port structure |
| `playwright/fixtures/authStorage.ts` | Authenticated fixture | High |
| `playwright.config.ts` | Runner config | **Highest** — adapt verbatim |
| `package.json#size-limit` | Bundle budget config | High |

### Dependencies (test-only)

- `@playwright/test`, `@testing-library/vue` (→ `@testing-library/react` for us), `@testing-library/jest-dom`, `msw` (stays), `happy-dom` (→ `jsdom` for React), `size-limit`, `monocart-coverage-reports`, `vitest`, `@vitest/coverage-v8`.

### Recommendations for new development

- **Reuse**: `playwright.config.ts` + `playwright/` layout wholesale.
- **Reuse**: `size-limit` configuration approach.
- **Adapt**: every spec file (one per feature). Each spec's `test()` block is a Given/When/Then scenario — map directly to our planner-filed AC scenarios.
- **Adapt**: auth fixture pattern.
- **Redesign**: MSW setup for Next.js (service-worker vs node-interceptor); component snapshot testing with React is via `@testing-library/react` + `jest` serializer (not `@testing-library/vue`).

### Open questions

- Does Playwright's `webServer` config play well with our `docker compose up` in CI? Answer is known — yes, either compose manages the server OR Playwright spawns it; CI uses compose, local dev can use either.

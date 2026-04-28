# BP — auth roles: local vs prod

**Catalog ref**: docs/14-bp-catalog.md §13.
**Level**: mandatory.

## Why

Local development needs fast role switching (admin / developer /
user) to exercise permission paths without a real IdP. Dev and prod
need the real thing or audit and access control become theatre.

Mixing them — shipping local-auth code to dev/prod, or relying on
IdP for local dev — breaks one side or the other.

## Rule

### Local (docker-compose, laptop)

- Auth mode: `dev`. Users come from a hardcoded list
  (`DEV_USERS` env or equivalent). Role switch is a dropdown /
  query-param / header, not a real identity check.
- No real secrets. `.env` carries placeholder / dev-only values
  (expiry ≤ 1 day, scope-restricted).
- `.env` is gitignored. `.env.example` is tracked and documents
  every variable.

### Dev / staging

- Auth mode: `sdk` or equivalent — real identity provider (Cognito,
  Auth0, whatever) but a service-account shortcut is allowed for
  E2E (e.g. Cognito AdminInitiateAuth).
- Secrets live in Secrets Manager (AWS) or the project's equivalent
  vault. IaC reads them at deploy time.
- No `DEV_USERS` in this environment. If `DEV_USERS` appears, the
  deploy fails CI.

### Demo / prod

- Auth mode: `managed` — real IdP, real Hosted UI (or equivalent).
  No service-account shortcuts in the user-visible flow. Service
  accounts for health-check / E2E only.
- Secrets in Secrets Manager with rotation.
- `DEV_USERS` must not exist.

## How the harness enforces it

- `.env.example` ships with `AUTH_MODE=dev`, `DEV_USERS=admin,dev,user`.
- `prompts/generator.md` DoD grep excludes `DEV_USERS` from
  dev/prod configs.
- `prompts/evaluator.md` reviews: if `AUTH_MODE=dev` is present in
  any non-local config, request changes.
- IaC sample (CDK) shows reading secrets from Secrets Manager, not
  from `.env` at build time.
- `docker-compose.yml` references only the local mode; `infra/*`
  templates reference real IdP.

## Migration

Projects inherited from other stacks often have hardcoded users in
production configs. On re-init, the planner files an issue
`migrate-auth-roles` and the generator does it as a dedicated PR.
Do not mix with other work — auth changes are always one PR alone.

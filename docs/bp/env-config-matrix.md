# BP — env / config matrix

**Catalog ref**: docs/14-bp-catalog.md §9.
**Level**: mandatory.

## Why

Every environment — `local`, `dev`, `stg`, `prd` (the canonical
four; the project may add more) — needs a consistent way to tell
the code "you're in environment X". Doing this with
`if NODE_ENV === 'production'` scattered through the codebase
pollutes logic and makes it impossible to add a new environment
without a code change.

## Rule

- **One source**: `infra/config/<env>.yaml` (or equivalent). One file
  per environment, same schema.
- **One resolver**: a single bootstrap in the app reads `CONFIG_ENV`
  (or whatever the project picks), loads the right YAML, and passes
  a typed config object everywhere. Nothing reads env vars directly
  outside this bootstrap.
- **One grep**: `grep -E 'localhost:[0-9]|(http|https)://[^{]|/home/'
  <changed-files>` passes clean on every PR. Generator does this as
  part of DoD; result goes in the PR body.

## Schema (example)

```yaml
# infra/config/dev.yaml
environmentCode: dev
domain: dev.app.example.com
auth:
  mode: sdk
  providerPoolId: us-west-2_abc123
  providerClientId: xxx
database:
  url: "{from-secrets-manager: app/dev/db-url}"
cache:
  url: "redis://cache.dev.example.com:6379"
featureFlags:
  newCheckoutEnabled: true
  auditAllRequests: false
```

The loader interpolates `{from-secrets-manager: ...}` references at
bootstrap. Raw secret values never sit in the YAML.

## Local override

- `.env` carries small-scope overrides during local development
  (single laptop). `.env.example` documents every variable.
- CI and deploy runtimes never read `.env`. They read the YAML plus
  the runtime's secret source.

## What the prompts enforce

- `prompts/generator.md` DoD: "portability grep must be clean
  before opening a PR" (evidence in PR body).
- `prompts/evaluator.md` review: "if a PR changes behavior without
  corresponding config changes, ask where the new value goes."
- Reviewer also verifies that secrets referenced from YAML exist in
  the secret store for the target env.

## Anti-patterns (reject)

- `const DB_URL = "postgres://user:pass@prod-db/..."` (hardcoded).
- `if (process.env.NODE_ENV === 'prod') { /* different code */ }`
  (behavior divergence via env flags; use config values instead).
- Scattering `process.env.X` reads throughout the code (one central
  resolver; everything else receives typed config).

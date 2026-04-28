# Project Best Practices (BP)

Every file in this directory is a distilled best practice that
`githarness init` places into the project. These are the rules the
harness expects every agent and human to follow.

The authoritative source — what's mandatory vs recommended vs
optional, and where in the codebase each BP lives — is
`docs/14-bp-catalog.md` in the githarness package.

## Contents

- `auth-roles-local-vs-prod.md` — role switching (admin/dev/user)
  locally, real IdP in dev/prod. Secrets flow `.env` → Secrets
  Manager.
- `compose-with-buildkit-secrets.md` — build-time secrets without
  leaking into image layers.
- `ecr-image-asset-hash.md` — let the IaC framework assign image
  tags by content hash; never set `IMAGE_TAG` manually.
- `env-config-matrix.md` — how env-dependent values flow from
  `infra/config/<env>.yaml` to runtime, and what the generator must
  grep for before opening a PR.
- `feature-flag-flip-discipline.md` — every off-by-default flag
  ships with a flip PR plan in the same sprint.
- `post-deploy-evidence.md` — every `UPDATE_COMPLETE` runs the full
  E2E suite and emits three evidence artifacts.
- `e2e-report-layout.md` — the `tests/e2e/test-results/<env>/...`
  tree and the `index.html` cascade.
- `frozen-modules.md` — project-declared set of paths agents never
  modify directly (upstream vendored code, etc.).

Project teams may add more BPs here. If a BP graduates from
project-specific to harness-wide, propose a PR to the githarness
repo.

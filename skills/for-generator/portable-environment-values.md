---
name: portable-environment-values
description: Use when writing or reviewing code that references URLs, ports, hostnames, secrets, file paths, region codes, or account IDs. Enforces extraction into config / env. Applies always; includes the portability grep the generator DoD requires.
---

# Skill — Portable environment values

**For**: generator (must extract), evaluator (must verify),
planner (must name in issue bodies).
**Applies always**. No project is exempt.

## The principle

**No hardcoded environment-dependent values in the code.** URLs,
ports, hostnames, secrets, timeouts, feature flags, regions,
account IDs, file paths — all of them live in config or env, not
in source.

A value is "environment-dependent" if it could legitimately be
different in dev, staging, prod, the developer's laptop, CI, and
the evaluator's remote E2E run. If any two of those environments
would use different values, the value is env-dependent.

A PR that merges hardcoded env-dependent values permanently
corrupts the integration branch — you cannot fix the problem by
later extracting the values because every copy, fork, and
downstream deployment carries them forward.

## The portability check

Every project defines a portability check — a one-liner (grep,
linter rule, pre-commit hook) that scans a diff for forbidden
patterns. The generator runs it before opening a PR; the
evaluator reproduces it before merging.

The forbidden pattern list for most projects includes at minimum:

- `localhost:[0-9]` or `127\.0\.0\.1` in runtime code.
- `http(s)?://[a-z][^{]*` where the string is a concrete URL
  rather than a templated config lookup.
- `/home/[a-z]+/` or similar developer-specific absolute paths.
- Inline secret-shaped strings (API keys, JWT headers, AWS keys,
  GitHub PATs) — this is also a pre-commit quality hook concern.
- Hardcoded region codes like `us-east-1`, `ap-northeast-2`, or
  AWS account IDs (12-digit numerics), unless clearly scoped to
  an infra-only file that is already env-bound.

Projects extend this list as needed. The baseline is the
generator's DoD step 3; the evaluator's DoD step 4 is the
verification.

## Where values go

- **Runtime config** — a config file loaded at startup (YAML,
  TOML, env-var block, SSM parameters, etc.), chosen by an
  environment identifier the project defines.
- **Secrets** — never in config files committed to git. Use the
  project's secret store (Secrets Manager, Vault, sealed-secrets,
  etc.). The config file references the secret by name.
- **Feature flags** — named, defaulted off, documented in the
  PR's "Flag activation plan" block if introduced by that PR.

## What this rules out (examples)

- A test that hits `http://localhost:8080/api/users`. The port
  is environment-specific; the host is environment-specific.
  Replace with a config lookup.
- A Dockerfile `CMD` that embeds a region. The region belongs
  in the container's env at deploy time.
- A README snippet that says "set `export API_KEY=sk-..."` with
  a real key inline. Redact and document the expected shape.
- A path `/Users/alice/code/proj/assets` in a script. Use a
  relative path or `$REPO_ROOT`.

## Related skills

- `skills/for-generator/reproducible-local-environment.md` — the runtime
  companion; portability is what makes reproducibility work.
- `skills/ops/env-config-matrix.md` — how to lay out the config file
  itself across environments.

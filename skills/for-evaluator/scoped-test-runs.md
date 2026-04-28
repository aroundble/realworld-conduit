---
name: scoped-test-runs
description: Use when reviewing a PR to decide which subset of Playwright / Newman / UAT tests to run. Defines the project-owned tests/affected-map.yaml schema that maps source-file globs to test scopes, the shared-file triggers that force a full run, and the fallback posture. Replaces "run the entire suite on every PR" with "run what the PR touches plus a 2h full-regression cadence" — the compromise between merge-latency and coverage surfaced by the 2026-04-28 vibe-studio pileup (16 PRs stuck on a pre-existing regression unrelated to any of them).
---

# Skill — Scoped test runs (+ shared-file triggers)

## Why this skill exists

Observation 2026-04-28 04:20Z on vibe-studio: 16 open PRs, 0
merged in 2h, evaluator doing 3-4 min of full-matrix tests per
PR. Two failure modes simultaneously:

1. **Latency**: each PR pays the full-stack reboot + full-matrix
   cost whether or not the PR touched that matrix.
2. **Baseline contamination**: `latest` was carrying 14 failing
   Playwright specs from a pre-existing regression. The gate's
   "failed == 0" rule blocked every PR even though none of them
   caused the failures.

v0.2.39 introduces scoped runs (this skill) + baseline triage
(`live-bdd-verification` skill, v0.2.39 update) in tandem.

## The contract — `tests/affected-map.yaml`

Projects opt in by creating this file. The schema:

```yaml
# Files whose change triggers a FULL run (shared infrastructure).
# These globs use ** for deep wildcards.
full_triggers:
  - "packages/shared/**"      # shared lib touched by every scope
  - "packages/db/**"          # schema/migration changes
  - "docker-compose.yml"      # stack topology
  - "Dockerfile*"
  - "*.lock"                  # pnpm-lock / uv.lock / go.sum
  - "package.json"
  - ".github/workflows/**"    # CI pipeline
  - "infra/**"                # IaC

# Scopes: each maps a set of source-file globs to a set of test
# assets. When a PR changes a file matching `files`, the matching
# scope's specs/newman/uat are included in the run.
scopes:
  web-feed:
    files:
      - "apps/web/app/(feed)/**"
      - "apps/web/components/Feed*"
      - "apps/web/components/DealCard*"
    specs:
      - "tests/e2e/specs/feed*.spec.ts"
    newman:
      - "tests/api/collections/feed.postman_collection.json"
    uat:
      - "tests/uat/specs/browse*.uat.ts"

  api-articles:
    files:
      - "apps/api/src/articles/**"
      - "apps/api/src/handlers/article*"
    specs:
      - "tests/e2e/specs/article*.spec.ts"
    newman:
      - "tests/api/collections/articles.postman_collection.json"

  auth:
    files:
      - "apps/api/src/auth/**"
      - "apps/web/app/(auth)/**"
      - "apps/web/lib/session.ts"
    specs:
      - "tests/e2e/specs/auth*.spec.ts"
      - "tests/e2e/specs/login*.spec.ts"
    newman:
      - "tests/api/collections/auth.postman_collection.json"
    uat:
      - "tests/uat/specs/signup-and-first-session.uat.ts"
```

Every scope must have `files`, `specs`, `newman`, `uat`. Empty
lists are fine (`newman: []` if the scope has no API surface).

## Fallbacks (conservative)

1. **No `tests/affected-map.yaml`** → gate runs FULL. Project
   has not opted into scoping.
2. **No scope matches the changed files** → gate runs FULL
   (conservative — we don't know what's affected).
3. **`gh pr diff` fails** → FULL.
4. **Any `full_triggers` glob matches** → FULL.

Scoping is OPTIONAL — but the ROI is high: a 10-scope project
typically runs 1-2 scopes per PR instead of 10, saving 5-10x
the merge-gate time.

## Runner — `tests/run-scoped.sh`

Projects ship a runner that honors `GATE_SCOPES` and
`GATE_FULL` envs:

```bash
#!/usr/bin/env bash
# tests/run-scoped.sh — run the subset (or full) tests matching the env.
# GATE_FULL=1 → all specs, all collections, all personas.
# GATE_SCOPES="a b c" → union of scope assets per affected-map.yaml.
set -euo pipefail

if [[ "${GATE_FULL:-0}" == "1" ]]; then
  npx playwright test --reporter=json --output=tests/e2e/test-results/
  for c in tests/api/collections/*.postman_collection.json; do
    npx newman run "$c" \
      --reporters junit --reporter-junit-export "tests/api/results/$(basename "$c" .postman_collection.json).xml"
  done
  npx playwright test --config tests/uat/playwright.config.uat.ts
  exit 0
fi

# Scoped run. Read the map + GATE_SCOPES, expand to file lists.
scopes="${GATE_SCOPES:-}"
python3 scripts/resolve-scope-assets.py "$scopes" > /tmp/scope-assets.json
specs=$(jq -r '.specs | join(" ")' /tmp/scope-assets.json)
newmans=$(jq -r '.newman | join(" ")' /tmp/scope-assets.json)
uats=$(jq -r '.uat | join(" ")' /tmp/scope-assets.json)

[[ -n "$specs" ]] && npx playwright test $specs --reporter=json
for c in $newmans; do
  [[ -f "$c" ]] && npx newman run "$c" --reporters junit \
    --reporter-junit-export "tests/api/results/$(basename "$c" .postman_collection.json).xml"
done
[[ -n "$uats" ]] && npx playwright test $uats --config tests/uat/playwright.config.uat.ts
```

The project-owned `scripts/resolve-scope-assets.py` reads the
map and returns the union of assets. The generator authors the
map + the runner when bootstrapping the test infrastructure
(the same PR that creates `tests/affected-map.yaml`).

## Baseline pairing

Scope-aware runs are half the story. The other half is
**baseline triage** — see
`skills/for-evaluator/live-bdd-verification.md` (v0.2.39
update). In short: run the same scopes on the BASE tip first,
save the failing-test identifiers to
`tests/baseline-cache/<scope-hash>.json`, then require the
PR's fail set to be a subset of the baseline's.

Without baseline triage, scoping doesn't help when `latest` is
red. The two mechanisms are co-designed — do not ship one
without the other.

## 2h full-regression cadence

The per-PR gate runs scoped. The 2h watchdog wake
(`[T2 full-regression wake]`) runs FULL. That's the coverage
compensation: scoped runs catch PR-specific regressions fast;
the 2h full run catches cross-scope regressions that scoping
would miss. Together: per-PR latency stays low, detection
coverage stays high.

## Anti-pattern — don't do scoping without the map

If a project doesn't have `tests/affected-map.yaml`, DO NOT
invent scopes at review time ("this PR changed `feed.tsx`, so
I'll run feed tests only"). That's the failure mode the map
exists to prevent — **ad-hoc scoping is self-certifying**,
which means leniency drift. Either write the map (so scope
decisions live in git and are reviewable) or run FULL.

## Map maintenance

The map is a live document. When a new area is added:

- The PR that introduces the area updates `affected-map.yaml`
  with its scope.
- Evaluator's review of that PR checks the map update.
- A PR that adds code but does NOT update the map falls into
  the "no scope match" fallback (FULL run), which is a
  friction signal to actually add the map entry.

## When NOT to use

- Very small projects (< 10 specs total) — FULL run is fast
  enough that the map adds more friction than value.
- Monolithic UIs where every change touches shared state —
  most scopes would trigger FULL anyway. Evaluate ROI.
- Exploration / prototype phase — map churns; defer until
  the module structure stabilizes.

## Related

- [`live-bdd-verification`](live-bdd-verification.md) —
  baseline triage pairing (same release).
- [`api-test-newman`](api-test-newman.md) — Newman
  collection layout that scopes reference.
- [`uat-user-acceptance`](uat-user-acceptance.md) — UAT
  persona specs that scopes reference.
- `scripts/eval-affected-scopes.sh` + `.py` — the resolver.
- `scripts/eval-merge-gate.sh` — the consumer.
- `scripts/eval-baseline-save.sh` — baseline capture.

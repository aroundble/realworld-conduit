# BP — E2E report layout

**Catalog ref**: docs/14-bp-catalog.md §14.
**Level**: mandatory.

## Directory tree

```
tests/e2e/test-results/
  index.html                             ← latest per env (all envs)
  <env>/
    index.html                           ← run list for this env
    <yyyymmdd>/                          ← UTC date, sortable
      index.html                         ← runs for this day
      <hhmmss>/                          ← UTC time of the run start
        index.html                       ← summary for this run
        <branch-slug>-<sha8>.html        ← the actual report file
        <branch-slug>-<sha8>.log         ← raw run log
        summary.json                     ← machine-readable run meta
```

- `<env>`: `local` | `dev` | `stg` | `prd` — the canonical
  tiers. Projects may add their own (e.g. `demo`, `canary`)
  but must declare the full set in their CLAUDE.md.
- `<yyyymmdd>` and `<hhmmss>`: **UTC**. Directory names are stable
  across operator timezones.
- `<branch-slug>`: the branch name's slug (see
  `scripts/issue-to-slug.sh`) — e.g. `fix-auth-timeout-42`.
- `<sha8>`: commit short SHA the run was made from.

## Why this layout

- **Sortable** by name → default shell listing already in chronological
  order.
- **Per-PR history** on the same day: same PR may be re-run multiple
  times (initial, rework, final). Multiple HTML files land under
  successive `hhmmss` directories, each tagged by its SHA.
- **Index.html cascade** — every level summarises the level below.
  Operator opens `test-results/index.html` in a browser, drills down.
- **Browsable from any terminal** via `python -m http.server` at the
  repo root, or via a static host.

## summary.json schema

```json
{
  "env": "dev",
  "commit": "a3f2c1b8...",
  "commit_short": "a3f2c1b8",
  "branch": "fix/auth-timeout-on-refresh-42",
  "branch_slug": "fix-auth-timeout-on-refresh-42",
  "pr_number": 42,
  "pr_url": "https://github.com/owner/repo/pull/42",
  "run_name": "20260425/071500",
  "started_at_utc": "2026-04-25T07:15:00Z",
  "duration_seconds": 252,
  "total": 234,
  "passed": 234,
  "failed": 0,
  "suites": [
    { "name": "api", "passed": 120, "failed": 0 },
    { "name": "ui", "passed": 45, "failed": 0 },
    { "name": "integration", "passed": 69, "failed": 0 }
  ],
  "previous_run": "20260425/071500"
}
```

`previous_run` points to the same PR's previous run in UTC
`yyyymmdd/hhmmss` form so the day's `index.html` can show
evolution.

## How it's generated

Every run of `tests/e2e/run-e2e.sh` must:

1. Compute the target directory as above.
2. Drop `<branch-slug>-<sha8>.html`, `.log`, `summary.json`.
3. Invoke `scripts/generate-e2e-index.sh` which rewrites:
   - `test-results/index.html`
   - `test-results/<env>/index.html`
   - `test-results/<env>/<yyyymmdd>/index.html`
   - `test-results/<env>/<yyyymmdd>/<hhmmss>/index.html`

The generator script reads every `summary.json` it finds under
`test-results/` and emits the four levels.

## Timezone in the presentation

Directory names and `summary.json` timestamps stay UTC. The
rendered HTML respects `HARNESS_TZ` (from the outer environment)
and displays:

```
2026-04-25 16:15 KST (07:15Z)
```

Both rendered so the operator sees local-first, auditor sees UTC.

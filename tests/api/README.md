# tests/api/ — RealWorld API conformance

Two conformance layers ride side-by-side here:

| Layer | Purpose | Runner | Files |
|---|---|---|---|
| Smoke (#23) | Fast sanity check that lands on every PR | Newman | `collections/healthz-smoke.postman_collection.json` + `scripts/run-newman-smoke.sh` |
| Full conformance (#36) | Canonical RealWorld Bruno suite against the live API | `@usebruno/cli` | `bruno/` (151 `.bru` files) + `scripts/run-bruno-conformance.sh` |

Both write JUnit / JSON reports under `tests/api/results/<timestamp>/`.

## Full conformance (`pnpm test:conformance`)

The `bruno/` directory is a **verbatim snapshot** of
`gothinkster/realworld` upstream at `specs/api/bruno/` (SHA
`e75fef39`). Upstream migrated away from Postman to Bruno on
2026-02-14 (`d4cd282e`); ADR §18 captures the reasoning for matching
that choice.

### Running locally

```
pnpm compose:up                # bring up api + web + postgres
pnpm test:conformance          # reset db + run bruno + write report
open tests/api/results/latest/bruno-report.html
```

The script resets the database before the run (truncate + identity
restart, leaves the schema intact). Set `SKIP_DB_RESET=1` to re-run
against existing state — useful when iterating on a single failing
assertion.

### Environment

`tests/api/bruno/environments/compose.bru` sets `host` to
`http://localhost:3101` (the compose project's `API_HOST_PORT`).
Override via editing that file or pointing `bru run --env <name>` at
a different env file under the same directory.

### What the gate enforces

`pnpm test:conformance` exits non-zero on any assertion failure,
which feeds the CI `conformance` job. Any regression — a broken
`favorited` field shape, a wrong 403 vs 422, a missing spec header
— is a red check that blocks merge to `latest`.

### Failure triage

1. **Open the HTML report** — `tests/api/results/latest/bruno-report.html`
   lists every failed assertion with the actual vs. expected response.
2. **Classify**:
   - **Our API is wrong** — the upstream spec is the contract; fix
     the API and add a regression test per the normal generator loop.
   - **Upstream assertion drifted from our agreed deviation** — if our
     choice is documented in an ADR, document the drift in this PR's
     comment and propose an assertion override (the evaluator decides
     whether to `.skip` the specific assertion with an ADR link, or
     whether the deviation should be reversed).
   - **Upstream bug** — happens occasionally; file upstream, skip the
     assertion locally with a link to the upstream issue.
3. **Never silently skip** — every skipped assertion must carry an
   inline comment explaining why and linking to the ADR / upstream
   issue that justifies it.

### Re-ingesting from upstream

When `gothinkster/realworld` ships collection changes:

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/gothinkster/realworld.git /tmp/realworld
cd /tmp/realworld && git sparse-checkout set specs/api/bruno
cp -r /tmp/realworld/specs/api/bruno/* "$REPO/tests/api/bruno/"
cd "$REPO"
# Preserve our compose env — restore it if the upstream sync wiped it:
git checkout -- tests/api/bruno/environments/compose.bru
```

Record the new upstream SHA in this README's header and in the PR
body. The planner's `repo-ingest` workflow automates this when a
larger re-sync is needed.

## Smoke (`pnpm test:conformance:smoke`)

Unchanged from #23 — one Newman run of the healthz collection,
designed to finish in ≤ 15 seconds. Acts as a cheap pre-gate so the
full conformance suite doesn't fire for PRs that clearly can't serve
any request.

## Layout

```
tests/api/
  README.md                            (this file)
  bruno/                               (151 .bru files, upstream verbatim)
    articles/ auth/ comments/ favorites/ feed/ pagination/
    profiles/ tags/ errors-*/          (canonical spec surface)
    environments/
      compose.bru                      (our-authored, points at :3101)
    bruno.json collection.bru
  collections/
    healthz-smoke.postman_collection.json  (#23)
  results/
    <UTC-timestamp>/                   (per-run reports)
      bruno-report.html  bruno-report.json
    latest                             (symlink → freshest run)
```

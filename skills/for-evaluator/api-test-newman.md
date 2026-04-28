---
name: api-test-newman
description: Evaluator runs a Newman (Postman CLI) collection against the live stack as a required merge gate. Every PR touching an HTTP API has a matching Postman collection in tests/api/collections/; Newman runs it, produces a JUnit report, and the evaluator attaches the report summary to the merge comment. Covers auth, happy path, error paths (400/401/403/404/422/5xx), rate-limit, concurrency. Complements Playwright browser E2E; API tests catch bugs the browser doesn't reach.
origin: githarness (complements ECC `browser-qa` + `e2e-testing`)
---

# Skill — API test (Newman) as a merge gate

## Why Newman on top of Playwright

Playwright covers UI scenarios (`browser-qa`, `e2e-testing`).
But a lot of a web product's surface is **HTTP-only**:

- Internal service-to-service calls (web → api → collector).
- Public APIs consumed by non-browser clients.
- Webhooks, cron-triggered endpoints, background workers.
- Error paths (4xx/5xx) that are tedious to drive through UI.

Newman (the CLI runner for Postman collections) exercises those
paths at the protocol level. Every API endpoint in the product
has a corresponding Postman request with tests (assertions on
status, body shape, headers). CI / the evaluator's merge gate
runs Newman against `http://localhost:<port>` after
`docker compose up -d` brings the stack healthy.

## Collection layout

```
tests/api/
├── collections/
│   ├── auth.postman_collection.json
│   ├── guardrails.postman_collection.json
│   └── deals-feed.postman_collection.json
├── environments/
│   ├── local.postman_environment.json
│   └── dev.postman_environment.json
├── results/
│   ├── newman-YYYYMMDD-HHMMSS.xml     # JUnit output
│   ├── newman-YYYYMMDD-HHMMSS.json    # Machine-readable
│   └── latest -> newman-YYYYMMDD-HHMMSS.xml
└── run.sh
```

One collection per feature area (not per endpoint). Collection
naming mirrors the area taxonomy in GitHub labels.

## What a Newman collection proves

For every endpoint covered:

- **Happy path**: HTTP 2xx with expected body shape. One
  request per documented scenario.
- **Auth**: 401 without token; 403 with wrong role; 200 with
  right role.
- **Validation**: 400 / 422 on malformed input with specific
  error shape (match the OpenAPI / pydantic / zod contract).
- **Not found**: 404 on missing resource ID.
- **Idempotency**: where applicable, two identical POSTs
  produce identical side effects (same 201 or 200-with-link).
- **Rate-limit**: if the endpoint advertises a rate-limit
  header, exceeding it yields 429 with `Retry-After`.
- **Ordering**: multi-step flows (create → read → update →
  delete) in one collection, with Postman variables carrying
  IDs between requests.

## Running

```bash
# 1. Stack up.
docker compose up -d --build
./scripts/wait-for-healthy.sh

# 2. Run all collections.
for col in tests/api/collections/*.postman_collection.json; do
  npx newman run "$col" \
    -e tests/api/environments/local.postman_environment.json \
    --reporters cli,junit,json \
    --reporter-junit-export "tests/api/results/newman-$(basename "$col" .postman_collection.json).xml" \
    --reporter-json-export "tests/api/results/newman-$(basename "$col" .postman_collection.json).json" \
    || exit 1
done

# 3. Aggregate into latest symlink.
(cd tests/api/results && ln -sfn "$(ls -1t *.xml | head -1)" latest)
```

A single failing assertion fails the run; the evaluator's
merge gate (`scripts/eval-merge-gate.sh`) detects the
non-zero JUnit failure count and blocks the merge.

## How Postman collections get authored

Generator's DoD for any PR touching an HTTP endpoint:

1. Add or update the Postman collection covering the endpoint.
2. One request per AC scenario in the linked issue (same
   Given/When/Then mapping as
   `skills/for-all-roles/bdd-acceptance-scenarios.md`).
3. Use Postman's `pm.test(...)` assertions on status + body.
4. Run Newman locally; confirm all requests green.
5. Commit the collection + updated environment files.

Planner's DoD for filing an issue with an API surface:

- AC scenarios include the explicit HTTP verb + path + body
  shape + expected status / body shape.
- Example scenario the generator can translate directly:

  ```
  Scenario: List deals for an anonymous visitor
    Given no session cookie is set
    When the visitor GETs /api/deals?limit=20
    Then the response status is 200
    And the response body contains {items: Array(20), cursor: String}
    And each item has {id, title, price, merchant, fetched_at}
    And the response sets a tenant-id cookie in the response header
  ```

## Integration with the merge gate

`scripts/eval-merge-gate.sh` gate 6 is the Newman check:

```bash
# Gate 6: Newman API tests fresh + passing
newman_report=tests/api/results/latest
if [[ ! -L "$newman_report" ]]; then
  fail "no tests/api/results/latest symlink — Newman never ran"
fi
failures=$(xq -r '.testsuites["@failures"]' "$newman_report" 2>/dev/null || echo 0)
if [[ "$failures" != "0" ]]; then
  fail "Newman reports $failures failing API tests"
fi
```

If the gate fails, the evaluator swaps the PR back to
`claim:generator` with the failing request + response body
captured in a `## 수정 요청` comment. No merge happens.

## Relationship to other skills

- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../for-all-roles/bdd-acceptance-scenarios.md)
  — the AC format that produces Newman requests.
- [`skills/for-evaluator/live-bdd-verification.md`](live-bdd-verification.md)
  — the UI-layer counterpart run simultaneously.
- [`skills/for-evaluator/browser-qa.md`](browser-qa.md) — ECC
  skill for the visual layer; Newman covers the protocol
  layer underneath.
- [`skills/for-evaluator/uat-user-acceptance.md`](uat-user-acceptance.md)
  — the end-user acceptance layer that runs on top of both.

## When NOT to apply

- Pure frontend PRs with no API surface change — skip
  Newman; Playwright covers. The gate honors
  `HARNESS_GATE_SKIP_API=1` but the evaluator must justify
  the skip in the merge comment.
- Documentation / CI / harness PRs — skip both API and
  compose gates (the script accepts `HARNESS_GATE_SKIP_COMPOSE=1`).

## Performance budget

A full Newman run should complete in under 30 seconds for a
small product (< 50 endpoints). Over that, split collections
by area and run in parallel. A run > 5 minutes means the
collection has bloat; prune duplicates.

---
name: test-reports-layout
description: Use when generating or consuming E2E test reports. Canonical directory layout (tests/e2e/test-results/<env>/<yyyymmdd-UTC>/<hhmmss-UTC>/) with summary.json, per-suite HTML, and latest symlink — enabling cross-run comparison and grep-based audit.
---

# Skill — Test Reports Layout & User-Intent Discipline

Observed failure mode: the report directory becomes a flat graveyard
of timestamped folders. Local, dev, staging runs all pile into the
same directory. The `latest` symlink points to whichever ran most
recently regardless of environment. After a few weeks, nobody can
answer "what was the state of dev yesterday afternoon?" in under
several minutes.

The test author thinks of these as *logs*. The operator and evaluator
need them to be *evidence* — searchable, attributable, and
interpretable at a glance.

This skill defines the layout and metadata required to make the
reports useful.

## Directory layout

Required structure under the project's test-results root:

```
tests/e2e/test-results/
├── index.json                       # global catalog (see below)
├── local/
│   ├── 20260424-142033-PR51/        # timestamp + PR number
│   │   ├── summary.json
│   │   ├── meta.json
│   │   ├── get_curls.log
│   │   ├── sdk-compat.log
│   │   └── ...
│   ├── 20260424-155011-adhoc/       # no PR = adhoc run
│   └── latest -> 20260424-155011-adhoc
├── dev/
│   ├── 20260424-143300-PR51/
│   ├── latest -> 20260424-143300-PR51
├── staging/
└── prod/
```

Rules:
- **`<env>/` is the first level.** Reports from different
  environments never mix.
- **`<timestamp>-PR<N>` or `<timestamp>-adhoc`** as the leaf directory
  name. PR linkage is explicit when it exists.
- **`<env>/latest`** is a symlink to the most recent run *for that
  env* only. Cross-env `latest` does not exist.
- Same layout under `tests/bench/reports/` and any other structured
  test output directory.

## `meta.json` — the one-file evidence packet

Every run writes a `meta.json` alongside `summary.json`. Fields:

```json
{
  "env": "dev",
  "timestamp": "20260424-143300",
  "started_at": "2026-04-24T14:33:00Z",
  "finished_at": "2026-04-24T14:41:22Z",
  "duration_sec": 502,
  "commit": "ab12cd34",
  "pr_number": 51,
  "pr_url": "https://github.com/<owner>/<repo>/pull/51",
  "base_url": "https://api.example.com",
  "user_intents_covered": [
    "admin can register a new guardrail and existing VKs see it immediately"
  ],
  "suites": {
    "sdk-compat": {"total": 30, "passed": 29, "failed": 0, "skipped": 1},
    "guardrails": {"total": 12, "passed": 12, "failed": 0, "skipped": 0}
  },
  "known_flakes": [
    {"name": "guardrails-all::bedrock-judge-kr-topic", "tracked_in": "#49"}
  ]
}
```

The fields make the run citable in one link. Reviewers point at the
directory path; the receiver opens `meta.json` and knows exactly
what happened.

## `index.json` — the cross-run catalog

The test runner (or a post-processing hook) appends a summary of
each run to `tests/e2e/test-results/index.json` at the root:

```json
{
  "runs": [
    {
      "env": "dev", "timestamp": "20260424-143300", "pr": 51,
      "commit": "ab12cd34", "passed": 41, "failed": 0,
      "user_intents": ["admin can register a new guardrail..."],
      "path": "dev/20260424-143300-PR51"
    },
    ...
  ]
}
```

Kept sorted by timestamp descending, capped at the last 100 runs.
Older entries rotated into `index-YYYY-MM.json` archives.

Operator query examples:

```bash
# recent dev runs with their PR
jq '.runs[] | select(.env == "dev") | "\(.timestamp) PR#\(.pr) \(.user_intents[0])"' index.json | head -20

# any run that covered a specific user intent
jq '.runs[] | select(.user_intents | map(contains("admin can register")) | any)' index.json
```

## User Intent — the BDD-lite requirement

Every test suite file begins with a `USER_INTENT` docstring listing
one or two sentences of what the suite proves from a user's
perspective. Example:

```python
# tests/e2e/test_e2e_guardrails_matrix.py
"""
USER_INTENT:
  An admin configures a guardrail rule and a user making an API call
  that violates the rule receives a clear block response. Legitimate
  requests from the same user pass through unchanged.

Technical scope:
  SDK × guardrail kind matrix (OpenAI / Anthropic / Bedrock × jailbreak
  / profanity / PII).
"""
```

The test runner extracts the `USER_INTENT` block and copies it into
`meta.json` (`user_intents_covered`). This is what an evaluator cites
in the PR evidence comment — "the suite that validates this PR's User
Intent" references the USER_INTENT, not the filename.

**PR description** mirrors the pattern. Every PR contains a `## User
Intent` section near the top:

```markdown
## User Intent

Admins need guardrail changes to take effect immediately. Currently the
sidecar caches guardrail configs for 10 seconds, so a newly added rule
may not block for up to 10s after activation. This PR adds a pub/sub
invalidation channel so the cache busts on change.

**How a user notices**: admin adds a rule in the UI, opens a terminal
with a curl that would violate, sends the request. Before this PR:
might succeed for up to 10s. After: blocked on the first attempt.

**E2E that proves it**: `test_guardrails_matrix::test_cache_busts_on_add`
```

An evaluator's first read is: does the User Intent match the reality
the code produces? If the technical solution is correct but the
User Intent isn't achieved (e.g., flag still off), the PR is not
ready to merge — comment and request the flip PR or behavior fix.

## Where this lives in the harness

- `CLAUDE.md.example` and `prompts/generator.md` require the PR's
  `## User Intent` section.
- `prompts/evaluator.md` requires the evaluator to cite the User
  Intent-covering suite in the evidence comment.
- Every project's test runner should produce `meta.json` and update
  `index.json`. If the runner doesn't natively, a `scripts/test-
  report-wrap.sh` can post-process after the existing runner finishes.

## Why this matters

Without User Intent: reviewers verify "tests pass" but not "feature
works as a user would experience it". The two are not the same.
Flags left off, mocked environments, wrong assertions — all produce
"tests pass" while the user-observable behavior is broken.

Without structured reports: after one week of runs, nobody can
retrieve "was dev green on PR #51?" without manually reading log
files. Two weeks in, the answer becomes "we don't know."

The skill costs a few extra seconds per PR and a short file per test
suite. The payoff is an audit trail that stays readable for months.

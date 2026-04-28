---
name: silent-failure-detection
description: Use during code review or failure triage. Hunts for swallowed errors, inadequate fallbacks, empty catch blocks, error-to-success conversion, and missing alerting paths — defects that pass tests because the test never asks the right question. Adapted from everything-claude-code's silent-failure-hunter agent under MIT.
---

# Skill — Silent-failure detection

**For**: evaluator (primary), generator (secondary — before opening PR).
**Applies always** during review of any code that handles
errors, async operations, network calls, or external services.

## The principle

**Silent failures are the most expensive class of bug a harness
can ship: they do not surface in logs, do not fail tests, and
degrade production quietly until a user reports symptoms.** The
evaluator is the last gate before merge, and this skill names
the patterns to scan for.

## Anti-patterns to flag as BLOCK on PR review

### 1. Empty or swallowing catch blocks

```ts
try {
  await riskyThing();
} catch {}
//                 ← swallowed, no logging, no rethrow, no alert
```

```python
try:
    risky_thing()
except Exception:
    pass
```

Flag as 🔴 BLOCK. Even "I don't care about this error" deserves
a one-line `logger.debug(...)` or a comment justifying the
deliberate swallow.

### 2. Error-to-success conversion

```js
let result;
try {
  result = await lookup(key);
} catch {
  result = null;   // ← caller cannot distinguish "not found" from "lookup failed"
}
return result;
```

The caller now gets `null` in two categorically different
cases. Flag as 🔴 BLOCK unless the return type is
`Either<Error, Value>` or similar and the call site handles
both cases explicitly.

### 3. Dangerous fallbacks

```python
try:
    config = load_config()
except Exception:
    config = {}    # ← service runs with empty config, no alert
```

Flag as 🔴 BLOCK. Failed config loads must either abort startup
or emit a red alert. A service that starts with empty config
looks healthy on every probe and serves wrong content forever.

### 4. Retry-without-bound

```ts
while (true) {
  try {
    return await callApi();
  } catch {
    await sleep(100);
  }
}
```

Flag as 🔴 BLOCK. Unbounded retry with no backoff / no cap is
a denial-of-service waiting for a transient upstream outage.

### 5. Missing alerts on background failures

```js
worker.on("error", (err) => {
  console.error(err);   // ← goes to a log nobody reads
});
```

If the worker is load-bearing (e.g. processes user requests,
emits metrics, runs a cron task), a `console.error` is
effectively a silent failure. Flag as 🟡 note on first
offense, 🔴 BLOCK on repeat.

### 6. Test passes because test is lying

Look for tests that:

- Mock the exact thing the production path fails on.
- Assert only `result !== null` when the real failure mode is
  `result === wrong_value`.
- Skip the case that makes the bug visible
  (`@pytest.mark.skip` / `xit` / `.skip()` without an issue
  link).

Flag as 🔴 BLOCK if the test's coverage claim is material.

## How this fits into the evaluator's DoD

Add one line to the evaluator's merge comment:

> `silent-failure scan: ok` (or `silent-failure scan: 2 🟡
> notes posted, no blocks`)

This forces the evaluator to have actually looked at the
error-handling paths in the PR, rather than skim-reading the
happy path.

## What this rules out

- Review comments that say "LGTM" on a PR that touches a
  try/catch without examining what the catch does.
- Merging a PR whose error-handling delta is invisible in the
  review comment.

## Adapted from

- `affaan-m/everything-claude-code`:
  `agents/silent-failure-hunter.md` (MIT). The anti-pattern
  list above extends the original with explicit categories and
  specific review-comment formatting per the
  [`human-readable-artifacts`](../for-all-roles/human-readable-artifacts.md)
  skill.

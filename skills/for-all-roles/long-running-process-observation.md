---
name: long-running-process-observation
description: Use when starting a process that will run more than ~30 seconds (CDK deploy, docker build, full E2E, ECS rolling). Forbids blind sleep; requires active monitoring via getProcessOutput with step-transition reporting.
---

# Skill — Long-running process observation

**For**: generator, evaluator.
**Applies when**: the session starts a process that takes more
than ~30 seconds (build, deploy, large test run, data pipeline).

## The principle

**The session actively observes long-running processes — it
does not `sleep` and hope. Each step transition produces a
visible update; each failure is reported at the top of the
session's output, not buried.**

## Why

A session that runs `./deploy.sh && sleep 600 && echo done` is
offline for ten minutes. If the deploy fails at minute three,
nobody knows until the sleep is over. If the deploy hangs, the
session is indistinguishable from the deploy being stuck. When
the watchdog or the operator checks the pane, all they see is
nothing happening — which is the worst observable state.

Active observation turns a blind wait into a series of short
updates, each of which is an artifact a human or the watchdog
can read.

## What "active observation" means

- Start the long-running command in the **background** (e.g.
  `nohup ... > /tmp/log 2>&1 & disown`, or the session
  runtime's equivalent `run_in_background` feature).
- Every 5–15 seconds, read the process's current stdout /
  stderr, log file, or status stream. Report a one-line
  summary of progress (not the full log).
- When a **step transition** happens (CloudFormation stack
  status changes, container phase changes, test suite begins,
  build phase advances), produce a one-line update: "stack is
  now UPDATE_IN_PROGRESS" / "suite 2/5 started" /
  "Dockerfile: building layer 14/20".
- At **completion** (success or failure), read the final
  output and report the result + the relevant excerpt. On
  failure, quote the last 10–30 lines before the error.
- **Never** sleep for the total expected duration and then
  check once at the end.

## What this rules out

- `sleep 600; check_result` — blind wait.
- `tail -F /tmp/log` foreground — blocks the session entirely.
- Running the long command in the foreground without
  intermediate updates — the session is unresponsive to the
  watchdog for the whole duration.
- Reporting "deploy finished" without citing the final
  status, the commit/stack id that deployed, or the log tail.
- Reporting a failure without the last-N-lines excerpt that
  shows the actual error.

## The observe loop pattern

Pseudocode (language-agnostic):

```
start the process in background, capture PID or handle
start_time = now()

loop:
    output = read_new_output(handle)   # non-blocking
    status = check_status(handle)      # running? finished? exit code?

    if output contains a recognized transition marker:
        emit_update(one_line_summary(output))

    if status is finished:
        emit_final(status, last_N_lines(output))
        break

    if now() - start_time > soft_timeout:
        emit_warning("still running after X; last output: …")

    wait short_interval (5–15 seconds)
```

The key invariant: **every iteration produces at most one
short update to the session's output**, so the pane remains
live and the watchdog sees progress rather than silence.

## Escape hatches

- **Processes known to be sub-30s**: run foreground, no
  observation loop. A `git commit` or a single `pytest` is
  not "long-running".
- **Processes with no intermediate output** (a statically-linked
  binary that prints only on completion): the observation loop
  still runs, but its updates are simply "still running, no
  output yet" at each check. This is still more informative
  than a blind sleep.

## Related skills

- `skills/for-evaluator/post-deploy-verification-gate.md` — the
  verification step that happens after the deploy finishes.
- `skills/for-evaluator/deployment-pipeline.md` — the sequence of
  long-running steps a deploy traverses.

---
name: autonomy-safeguards
description: Use during any long-running (>1 hour) or unattended (overnight / 24/7) session. Enforces token tracking, cost budget awareness, stuck-loop detection, and cooperative exit before context fatigue degrades output. Inspired by riv2025 long-horizon coding demo's TokenTracker + state machine patterns.
---

# Skill — Autonomy safeguards

**For**: all roles, most binding on sessions that run unattended
for hours (generator on a long feature, evaluator on a
multi-PR review queue, planner on a multi-day roadmap
expansion).
**Applies when**: the session is either (a) explicitly
long-horizon, (b) woken repeatedly by the watchdog without an
operator in attendance, or (c) above 50% of its context budget.

## The principle

**A 24/7 session must actively guard its own quality.**
Long-running autonomy degrades in three specific ways; the
session watches for each and takes cooperative action *before*
the operator has to intervene.

## The three failure modes (and each one's guard)

### 1. Context fatigue

Symptom: the session starts repeating prior work, losing
thread coherence, producing visibly shorter or more hedged
responses than at the session's start.

Guard: check the context footer (`Xh Ym · ↓ Nk tokens`) at the
top of every turn. If `N >= 0.8 × token_limit` (typical
warning threshold), transition to the **WINDING_DOWN** state
— finish the current step, commit a `wip:` checkpoint, do not
pick up new work, end the turn. The next wake will trigger the
graceful-handoff skill which spawns a successor.

Do not try to "push through" near the limit. Every turn past
the warning line produces lower-quality output than the next
session's first turn would produce on the same work.

### 2. Stuck loop (silent idle)

Symptom: the session wakes, runs pickup script, classifies the
same signals as "out of scope", ends the turn — three wakes in
a row with identical signatures.

Guard: the Stop hook already dedups on signal signature and
lets the session exit after two identical attempts (see
`.claude/hooks/stop-pickup-next.sh`). If you find yourself
about to emit the second identical "idle" message, **first
leave a visible tracker note**: either a comment on the
highest-count item explaining why this role cannot act, or
application of the `blocked` label with a reason. Silent idle
on a non-empty signal vector is the single worst failure mode
of a 24/7 harness.

If `HARNESS_SESSION_ROLE` advertises a role whose prompt file
does not exist, the Stop hook injects a role-identity drift
WARNING (see `docs/role-identity.md`). Respect it: surface
the drift to the operator, do not self-resolve on "out of
scope".

### 3. Cost explosion

Symptom: the session runs a retry loop — command fails, LLM
retries it with minor variation, fails again, retries, etc. —
burning tokens without producing forward progress.

Guard: watch the response pattern across the last 3–5 turns.
If three consecutive tool invocations on the same target
(same file, same command, same URL) have failed the same way,
stop retrying. Either (a) escalate to an issue comment so the
operator sees the failure pattern, or (b) reassign the work
(`claim:human` on the issue) and move on.

Claude's retry instinct is useful for transient failures
(network blip, race condition) but catastrophic for
deterministic failures (the command is actually wrong). Three
strikes is the rule.

### 4. External-service failure masquerading as "needs human"

Symptom: an external dependency — GitHub Actions billing
suspended, Docker Hub rate limit, npm registry 503, OpenAI
quota exhausted, Vercel deploy failed — makes one step of the
pipeline fail. The agent tags the PR `claim:human`, posts a
note, and stops.

**This is an autonomy leak disguised as a safety measure.**
`claim:human` means "a human needs to look at this"; if the
harness is supposed to run 24/7, that translates to "halt for
N hours". Enterprise harnesses do not halt on external
outages — they reroute around them.

Guard: when an external service fails, do **three** things
before applying `claim:human`:

1. **Reroute to local equivalent.** CI green not available →
   run the same unit + E2E suites locally via `docker compose`
   and attach the local report as evidence. Remote deploy
   blocked → verify on local compose and merge with
   "cloud-deploy deferred due to external outage, re-verify
   when service returns" note.
2. **Document the outage** in a `blocked-external:<service>`
   label on the PR, NOT `claim:human`. `blocked-external` is a
   label the planner's Branch 5 Audit watches; if the label
   is still present > 4 hours, planner files a `claim:planner`
   tracking issue with a suggested workaround. `claim:human`
   is reserved for issues that **genuinely** require a human
   decision (licensing, billing, policy) — not for outages
   that will resolve on their own.
3. **Continue the queue.** Never block the whole session on
   one PR that hit an external outage. Swap the stuck PR to
   `blocked-external:<service>` and pick up the next one.

Case study: 2026-04-28 03:00Z, hot-deal CI failed because
GitHub Actions billing was suspended. Evaluator tagged PR
#109 `claim:human` and stopped picking up work for 45 minutes.
Correct behavior: `blocked-external:github-actions`, verify
the hotfix on local compose + local Playwright, merge with
evidence, continue.

**`claim:human` is never a terminal state for 24/7 autonomy.**
If you find yourself about to apply it, re-read this guard.
The only items that genuinely claim a human are:
- Billing / payment method updates (requires card).
- License agreement changes (requires signature).
- New cloud account creation (requires identity verification).
- Policy decisions the operator has specifically deferred.

Everything else has a local or cached workaround. Find it.

## Related skills

- `.claude/skills/graceful-handoff/SKILL.md` — the handoff
  skill that fires when this one detects context fatigue.
- [infrastructure-lookup-fallback](../for-evaluator/infrastructure-lookup-fallback.md)
  — a pattern that reduces one specific source of retry loops
  (hardcoded references that do not exist in the target).
- [canonical-test-location](canonical-test-location.md) — a
  pattern that reduces one-off test-script loops.

## Reference implementations worth studying

- `anthropics/riv2025-long-horizon-coding-agent-demo`:
  `src/token_tracker.py` lines 17–150 — the SessionTotals +
  cost-cap + warning-threshold pattern. Licensed
  Apache-2.0; re-implementation fine with attribution.
- `anthropics/riv2025-long-horizon-coding-agent-demo`:
  `claude_code.py` lines 50–51, 137–146 — explicit state
  machine (`continuous` / `pause` / `run_once` / `run_cleanup`
  / `terminated`) and completion-signal heuristics.
- `affaan-m/everything-claude-code`: `agents/loop-operator.md`
  — the operator-as-agent pattern for watching a long loop and
  escalating on stall / failure / cost drift. MIT licensed.

---
name: scope-discipline
description: Use when a new feature request arrives or an existing backlog item threatens to expand. Checks the request against the numbered roadmap; out-of-scope requests go to docs/ideas/ rather than into the next PR.
---

# Skill — Scope discipline

**For**: all roles, most binding on planner.
**Applies always**.

## The principle

**Every session keeps a short, numbered roadmap of what counts
as in-scope right now, and asks of every incoming request "is
this a current roadmap item?" before acting. Requests outside
the current roadmap go to an ideas file, not into the next
PR.**

This is what lets a 24/7 harness stay on trajectory across
weeks of work instead of drifting into whatever looks
interesting today.

## Why this is load-bearing

Autonomous sessions + enthusiastic operators is the classic
scope-creep recipe. Without discipline, the backlog grows
faster than delivery, the roadmap becomes aspirational rather
than operational, and six months later the project has fifty
half-built features and no shipped ones.

A fixed numbered roadmap, read at the top of every planner
session, keeps the question "what are we shipping this week?"
answered in one line.

## The roadmap shape

The project's canonical roadmap file (typically
`docs/roadmap.md`) contains:

- A small ordered list of goals the project is currently
  working toward, each a sentence or two with a clear outcome,
  ordered by **core-feature progression** (sketch → demo →
  every feature in every environment, hardening).
- A "current stage" marker showing where the project sits in
  that list.
- An **out-of-scope** section listing things the project is
  deliberately *not* doing now.

The planner uses this ordering to set priority on the issues it
writes. Priority is **ordering**, not a stop signal (see
`CLAUDE.md` → "Coordination primitives"); the generator picks
up the highest-priority unclaimed item within its role scope
and works it without asking.

Example:

```markdown
# Roadmap

## Current goals (in order)

1. **Gateway phase 2** — AgentCore gateway integration so
   clients switch from runtime-direct to a managed gateway.
   Unblocks feature families 2–4. ~2–3 weeks.
2. **Developer portal MVP** — key management / usage / docs
   landing page. Unblocks external adopter trial. ~2–3 weeks.
3. **User-facing catalog** — read-only agent catalog + chat.
   Unblocks end-user feedback loop. ~3–4 weeks.
4. **Delivery hardening** — fresh-deploy runbook + environment
   separation. ~2–3 weeks.
5. **Public release prep** — license / docs site / credential
   scrub. ~2 weeks.

## Currently at

Goal 2 (developer portal), mid-sprint. Goal 1 shipped last
week.

## Out of scope (deliberately not now)

- Feature X — not validated by user demand; parked in
  `docs/ideas/feature-x.md`.
- Technology Z — no reason to adopt before goal 5 is in flight.
```

## The four-question check

When a new feature request arrives (from the operator, a user,
or spontaneous idea), the planner asks:

1. **Does it serve a current roadmap goal?**
2. **Does it contribute to at least two of: shipping a current
   goal / preparing a public release / validating future
   demand?**
3. **Is it generally useful** rather than a single-client ask?
4. **Can a working proof-of-concept be built in two weeks?**

If any answer is **no**, the request is out of scope. Planner
replies: "This is out of scope for the current roadmap. I can
log it in `docs/ideas/<slug>.md` if you want it re-evaluated
when we reach a later goal." Log and move on.

## Ideas file

Out-of-scope requests go to `docs/ideas/<slug>.md`:

- One file per idea.
- Body: the request as received, the rejection reason, what
  would need to change for this to re-enter scope.
- Re-evaluated when the project moves to the next roadmap
  goal.

The file survives; the distraction does not.

## What this rules out

- **Starting implementation** on a request before the planner
  has confirmed it is in scope.
- **Renegotiating priority** mid-sprint without a planner
  decision and an ADR if the reason is non-trivial.
- **"While I'm here" additions** to an in-scope PR that
  expand its footprint. A PR touches the scope of its issue.
  Incidental discoveries open a follow-up issue.
- **Silent backlog growth** — requests that vanish into
  agent memory without becoming either issues or ideas files.

## Planner's session-start ritual

The planner's first action on session start (and first action
after a handoff) is to re-read the roadmap file. This is
non-negotiable. A session that does not know the current
priority order cannot make scope decisions correctly.

## Related skills

- `prompts/planner.md §"Four branches"` — scope discipline is
  how Branch 3 (issue shaping) decides what gets issued.
- `skills/for-all-roles/human-readable-artifacts.md` — ideas files,
  rejection comments, and scope decisions are all artifacts
  that must be legible later.

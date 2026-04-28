---
name: evidence-bearing-pr
description: Use when opening or reviewing a pull request; ensures the PR body carries User Intent, Upstream reuse decision, reproducible-environment output, full E2E summary, portability check, and infra diff so the evaluator can approve or reject without verbal context.
---

# Skill — Evidence-bearing PR

**For**: generator (must produce), evaluator (must verify).
**Applies always**.

## The principle

**A PR is the generator's handoff to the evaluator, and the
handoff is the evidence.** The evaluator must be able to decide
to approve, deploy, or request changes by reading the PR body,
with no verbal context from the generator.

Anthropic's 2026-03 three-agent blog calls out this pattern
implicitly: "agents communicate via files rather than direct
message passing. One agent writes structured artifacts (specs,
contracts, feedback reports); the next reads and responds within
that file." The PR is that structured artifact for the
generator-to-evaluator handoff.

## What the PR body must contain

Six sections, in order. Each section has a specific purpose; a
missing section is a handoff failure.

### 1. `Closes #<N>`

Machine-readable link back to the issue. Required on the final
PR description, not on every commit. Automatically closes the
issue on merge.

### 2. `User Intent`

Copied from the issue. If the PR's scope shifted during
implementation, the generator updates the User Intent and
**links back** to the original planner-authored version so the
divergence is visible.

### 3. `Upstream reuse`

One of:

- `Adapted from <owner/repo@SHA> (<license>) — see
  docs/adr/NNN-<slug>.md. Attribution present in: <file list>`
  when the issue's Reuse decision cited an upstream.
- `Scratch implementation — ADR docs/adr/NNN-<slug>.md
  documents why no viable upstream was available` when the
  planner ruled scratch in the issue.
- `n/a — one-liner / doc change / follow-up to parent feature`
  for trivial work.

### 4. `Evidence`

The DoD-required artifacts per the generator's DoD:

- **Reproducible local environment up** — output of the
  project-defined stack-up command.
- **Full local E2E** — summary (total / passed / failed) and
  path to the full report.
- **Portability check** — output of the project's portability
  check, clean or annotated.
- **Infra diff** (if IaC touched) — summary of intended
  changes.

Each piece must be reproducible. The evaluator will rerun at
least one; hand-edited "evidence" produces a failed review.

### 5. `Flag activation plan` (conditional)

Required when this PR introduces a feature flag defaulting off.
Must name the flip PR number (open it in the same sprint) or
say explicitly "flip pending — same sprint". Flags that merge
off and are never flipped are a deployment-pipeline failure
mode this block is designed to prevent.

### 6. `Deployment pipeline checklist` (template)

A checkbox list the evaluator fills in as they walk the pipeline:

```
- [x] Local compose build / reproducible env up
- [x] Local full E2E pass
- [ ] Dev IaC diff — evaluator fills
- [ ] Dev deploy — evaluator fills
- [ ] Dev remote E2E — evaluator fills
- [ ] Post-deploy evidence — evaluator fills
- [ ] Merge message — evaluator fills
```

## What this rules out

- "Evidence: tests pass" without pasted output.
- Evidence from a previous commit (not the PR's head).
- Markdown formatting that hides rather than shows (collapsed
  `<details>` around evidence that is actually failing).
- PR descriptions that only say "per issue #N" with no body of
  their own — the issue and the PR serve different readers and
  both need text.

## Related

- `docs/06-commit-patterns.md §"PR description anatomy"` — the
  exact template this skill formalizes.
- `skills/ops/post-deploy-evidence.md` — the concrete post-deploy
  evidence format.

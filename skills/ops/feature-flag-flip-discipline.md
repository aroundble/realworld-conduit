---
name: feature-flag-flip-discipline
origin: githarness (distilled from Heimdal)
---

A feature flag defaulting off is a code drop, not a release. The
same-sprint flip PR is generator work. If it doesn't land, the flag
is labelled `flag-abandoned`. Rule:
`docs/bp/feature-flag-flip-discipline.md`.

## PR body required block

```markdown
## Flag activation plan

- Flag: HEIMDAL_GUARDRAIL_NEGCACHE_ENABLED
- Default in this PR: false (all environments)
- Planned flip PR: #47 (draft)         # or: "flip pending — same sprint"
- Target environment for flip: dev + wontagh
- Rollback: set to false, redeploy (feature has no persistent side
  effects)
```

## Flip PR shape

The smallest PR possible that changes only the default value for
the target environments:

```ts
// infra/config/dev.yaml (diff)
 featureFlags:
-  negcacheEnabled: false
+  negcacheEnabled: true
```

No logic changes. No test changes. A flip PR's diff should be
5 lines or fewer in most cases.

## Evaluator's weekly check

```bash
# list PRs merged in the last 5 business days that had a flag plan
gh pr list --state merged --search "merged:>=$(date -u -d '5 days ago' +%Y-%m-%d) in:body \"Flag activation plan\""
# for each, confirm a flip PR exists
```

If a flip PR is missing:

- `gh issue edit <original-issue> --add-label flag-abandoned`
- Comment on the original issue asking the decision: enable /
  revert / canary-only.
- cc the planner.

## Anti-patterns

- Flipping a flag via a deploy-time env override instead of a PR
  (drift between code and runtime).
- Merging the feature and the flip in one PR (two risk profiles
  mixed).
- "We'll flip after we measure" with no date — becomes
  `flag-abandoned`.

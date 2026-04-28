# Skills — routing map

Skills are markdown files that Claude Code auto-loads when the
session's current task matches the skill's description. They
encode **principles** (not code) — the how-to that goes with a
rule.

This directory is organized by **audience** (which role reads
what) at the top, and by **stack** underneath for skills that
only apply when a specific technology is in use.

## Top-level

| Directory | Who reads | What's in it |
|---|---|---|
| [for-generator/](for-generator/) | generator | Build-and-prove-it-works skills: reproducible local environment, portable env values, evidence-bearing PR, SDK-first integration. |
| [for-evaluator/](for-evaluator/) | evaluator | Review-deploy-merge skills: post-deploy verification gate, deployment pipeline, immutable infrastructure, IaC config-driven portability, lookup fallback, resource naming, public-access default-deny. |
| [for-all-roles/](for-all-roles/) | planner + generator + evaluator | Cross-role operational discipline: canonical test location, E2E single entrypoint, human-readable artifacts, long-running process observation, scope discipline. Also includes [ecc-rules/](for-all-roles/ecc-rules/) — 10 general engineering rules ported from [everything-claude-code](https://github.com/affaan-m/everything-claude-code) under MIT. |
| [stacks/](stacks/) | whichever role uses the stack | Stack-specific implementations of the for-evaluator / for-generator principles — `aws-cdk/`, `docker/`, `nextjs/`, `terraform/`, `auth/`. |
| [ops/](ops/) | mostly evaluator | Operational utilities that apply across stacks: env-config matrix, feature-flag flip discipline, post-deploy evidence format, test-reports layout. |

## How this directory is meant to be read

A session does **not** read everything in this directory. Claude
Code's skill loader matches the session's current task against
each skill's description (the first few lines of the skill file)
and surfaces only the relevant ones.

The routing by audience is a hint to the loader and a
signpost to the human reader:

- A session running as the `generator` role is most likely to
  match skills in `for-generator/`, `for-all-roles/`, and any
  `stacks/<stack>/` whose technology the project uses.
- A session running as the `evaluator` role is most likely to
  match skills in `for-evaluator/`, `for-all-roles/`, and any
  stack-relevant `stacks/<stack>/`.
- A session running as the `planner` role is most likely to
  match skills in `for-all-roles/` (especially
  `scope-discipline.md`).

A skill in `for-evaluator/` is not *forbidden* to the generator;
it is simply less likely to be relevant. When it *is* relevant
(e.g. generator touching IaC on a PR), Claude will still load
it, because the skill's description — not the folder name —
drives the match.

## Adding a new skill

Before writing, answer three questions:

1. **Who reads this?** One role, two, or all three. That
   decides the `for-*` folder.
2. **Is this universal or stack-specific?** Universal →
   top-level `for-*`. Stack-specific → `stacks/<stack>/`.
3. **Does a skill on this already exist?** Prefer extending the
   existing skill to splitting off a new one. Over-
   proliferation dilutes the auto-match signal.

Format (see any existing skill):

```markdown
# Skill — <Short title>

**For**: <role(s)>.
**Applies when**: <condition>.

## The principle

<One-paragraph statement of the rule.>

## What this rules out

<Concrete examples of the anti-pattern.>

## Escape hatches / exceptions

<When the rule does not apply.>

## Related skills

<Cross-references.>
```

## Relationship to prompts

`prompts/<role>.md` describes the **role identity** —
what the session is for, what it does, what it does not do.
Skills describe **principles** — how to do specific kinds of
work correctly.

Prompts do not mandate skills by name. Skill discovery lives in
the skill's own description; the role prompt describes identity
only. This is the authoring rule established in PR #12.

## Relationship to MCP servers

Some stacks need runtime knowledge that outlives any single
skill file — e.g. the latest CDK API, the current Next.js
devtools. Those live in `stacks/<stack>/mcp-servers.json`
(paired with the stack's skills) and are wired into the
project's `.mcp.json` at `init` time. See `docs/stack-mcp.md`
(forthcoming).

## Relationship to .claude/skills/

The `.claude/skills/` directory at the repo root holds **skills
that the harness itself invokes** (notably `graceful-handoff/`,
which drives session lifecycle). Those are operational skills
for the harness runtime; everything in this `skills/` tree is
project-level discipline distributed with the template.

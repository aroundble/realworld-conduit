# BP — frozen modules

**Catalog ref**: docs/14-bp-catalog.md §17.
**Level**: mandatory (per project).

## Why

Every codebase inherits upstream code — vendored libraries, forked
SDKs, generated files. Agents that "fix" these in-repo produce:

- Out-of-sync forks that can't pull upstream patches.
- Silent diverges that break re-builds.
- Copyright and license risk.

The project declares which paths are frozen. Agents respect the list.

## How the project declares it

In the project's `CLAUDE.md`, under `# <Project>-specific`, a
section:

```markdown
## Frozen modules

- `vendor/<upstream-name>/` — upstream Apache 2.0. Touch via
  supported extension points (plugins, config, wrappers) only.
- `services/<name>/proto-generated/` — code-generated from
  `.proto` files; never edit by hand.
- `ui/node_modules/` — generated.

To change behavior sourced from a frozen path, write a plugin, a
wrapper, or a config patch. If the root cause is genuinely inside
a frozen path, file an issue for the planner with `claim:human` so
the operator decides on a fork or an upstream PR.
```

Agents read this list on every session start (it's part of
`CLAUDE.md`) and refuse edits that land inside any listed prefix.

## What agents do on violation

Generator: refuses to open the PR. Explicitly cites the frozen
path in the refusal message.

Evaluator: on a PR that modifies a frozen path, requests changes and
points at this BP. Never merges.

Planner: on an issue whose acceptance criteria requires modifying a
frozen path, reframes the issue to target the supported extension
point (plugin, config, wrapper). If no extension point exists,
escalates to the operator with `claim:human`.

## What isn't frozen (but looks like it)

- `docs/` — documentation always open to edits (by the planner or
  through docs PRs).
- `scripts/` — harness-owned scripts. Observer PRs edit them.
- Lockfiles (`package-lock.json`, `poetry.lock`, etc.) — regenerated
  by routine dependency work; not frozen.

If a path is unclear, ask the operator once and record the
clarification in the project's `CLAUDE.md`. Don't guess.

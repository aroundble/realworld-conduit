---
name: reproducible-local-environment
description: Use when bringing up the project's stack locally or running end-to-end tests. Forbids running business logic against the host toolchain directly; requires the project-defined reproducible environment (docker compose, kind, Nix, cargo workspace, etc.).
---

# Skill — Reproducible local environment

**For**: generator (primary), evaluator (verifier).
**Applies when**: the project has any runtime component (service,
worker, CLI that integrates with external systems). Projects that
are pure library code use a thinner variant; see "Trivial case"
below.

## The principle

**Business logic is developed and verified inside the project's
reproducible environment. The developer's host toolchain is a
driver, not a runtime.**

Every dev box, every evaluator machine, every CI runner, every
production container must produce the same behavior on the same
input. The only way to guarantee that is to make the runtime
environment itself a reproducible artifact — a declarative spec
(compose file, kind cluster, Nix flake, cargo manifest with pinned
deps, etc.) that builds the same stack from the same commit.

Any code path that works on one developer's host but not inside
the reproducible environment is a regression waiting to happen
the moment the PR lands somewhere else.

## The project's contract

Every project using `githarness` must define two commands in its
own `CLAUDE.md` or top-level `README.md`:

1. **Bring the stack up reproducibly** — one command that builds
   and starts every service the project needs locally. Examples:
   - Docker: `docker compose up -d --build`
   - Kubernetes: `./scripts/kind-up.sh`
   - Rust monorepo: `cargo build --workspace --locked`
   - Python service: `uv sync && ./scripts/dev-up.sh`
   - Nix: `nix develop -c dev-up`
2. **Run the full E2E suite through that stack** — one command
   that exercises the real user path end-to-end, not a
   hand-picked subset. Examples:
   - `./tests/e2e/run-e2e.sh`
   - `cargo test --test e2e --features integration`
   - `pytest tests/e2e -m 'not flaky'`

The generator runs both, captures their output, and attaches it
as PR evidence. The evaluator reproduces at least one of them
before approving.

## What this rules out

- Running business logic directly against the host toolchain
  (`node server.js`, `python -m app`, `cargo run`, `go run
  ./...`) when the project has a reproducible environment
  defined. The host toolchain has different paths, different
  env, different dependency versions, and different defaults
  than the reproducible environment — success there does not
  prove the code works.
- Running a subset of tests and calling it E2E. "Full" means
  what the contract says.
- Silencing a failing suite by marking it flaky. Flakes open a
  follow-up issue; they do not merge into the PR's evidence.

## Escape hatch

Unit-scope tests that are pure (no I/O, no network, no env
reads, no filesystem mutation outside tmp) can run on the host
toolchain for speed. Anything that touches a service, a
database, a queue, or an external dependency runs through the
project's reproducible environment.

## Trivial case

A project that is pure library code with no runtime component
still needs:

- A build that runs from a clean clone without manual steps.
- A test command that exercises the public API.

The project's `CLAUDE.md` states which of these two commands
plays the role of "bring up" and which plays "run E2E".

## Related skills

- Stack-specific: `skills/stacks/docker/compose-with-buildkit-secrets.md` for
  Docker Compose projects.
- `skills/for-generator/portable-environment-values.md` — the portability
  companion.

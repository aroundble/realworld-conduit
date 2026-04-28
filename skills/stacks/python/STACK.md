# Stack — Python

Enable this stack for projects using Python as a primary
application language (FastAPI, Flask, Django, async workers,
ML serving, CLI tools, data pipelines).

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [fastapi-service-pattern.md](fastapi-service-pattern.md) | generator | FastAPI layout: app factory, routers, dependency injection, auth middleware, pydantic models, async handlers, health endpoint, OpenAPI export. |
| [python-reproducible-env.md](python-reproducible-env.md) | generator | `uv` / `pyproject.toml` discipline, lockfile, `.python-version`, docker compose packaging, editable installs in dev. |
| [pytest-bdd-pattern.md](pytest-bdd-pattern.md) | generator + evaluator | pytest-bdd for Given/When/Then scenarios mirroring the planner's issue AC; alternative `behave` setup if project prefers. |

## When to enable

Enable if the project:

- Has (or will have) a Python-authored backend, worker, or CLI.
- Uses FastAPI, Flask, Django, Quart, Starlette, or a raw ASGI
  framework.
- Runs data/ML pipelines in Python (Prefect, Airflow, Dagster,
  raw scripts).

Do **not** enable if the project is pure frontend or pure
Node/Go/Rust with no Python artifacts. Overlap with other
stacks (e.g. Python BFF in front of a Go service) is fine —
enable both.

## Reproducible-environment contract

A Python project that opts into this stack MUST:

1. Pin Python version in `.python-version` (or `pyproject.toml`
   `requires-python`). Default to the latest CPython LTS
   available in the project's deploy image.
2. Use `uv` (preferred) or `pip-tools` to produce a lockfile.
   No `pip install -r requirements.txt` without a lockfile.
3. Ship a `Dockerfile` based on the project's standard Python
   base image; `docker compose up` brings the service up with
   one command.
4. Provide `./scripts/dev-up.sh` (or the project's canonical
   entrypoint) that runs the stack plus any dependent
   services (Postgres, Redis, etc.).

## BDD contract

Per `skills/for-all-roles/bdd-acceptance-scenarios.md`, every
issue's AC is Given/When/Then scenarios. The generator's
Playwright spec covers user-facing UI; Python-only services
(no UI) cover their scenarios through pytest-bdd + httpx
against the running container. See
`pytest-bdd-pattern.md` for the recipe.

## Deploy mode notes

- **`local-only`**: docker compose brings the Python service
  up on `localhost:<port>`. Playwright or curl probes the port.
  No cloud dependencies; sub in `sqlite`, `localstack`, or
  mocked S3 as needed.
- **`cloud`**: CDK/Terraform deploys the same image to ECS /
  Cloud Run / Lambda. The Dockerfile is the same; the deploy
  target changes. Do not maintain two Dockerfiles.

## Related

- [`skills/for-generator/reproducible-local-environment.md`](../../for-generator/reproducible-local-environment.md)
  — the universal reproducible-env contract; this stack's
  `python-reproducible-env.md` is the Python-specific
  implementation.
- [`skills/stacks/docker/STACK.md`](../docker/STACK.md) — the
  compose layer the Python service runs under.
- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../../for-all-roles/bdd-acceptance-scenarios.md)
  — the AC format pytest-bdd implements.

# Stack — Docker Compose

Enable this stack for projects using Docker Compose as the
reproducible local environment.

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [compose-with-buildkit-secrets.md](compose-with-buildkit-secrets.md) | generator | Secret passing into `docker build` via BuildKit `--mount=type=secret` (not `ARG`, which bakes tokens into image layers). |

## MCP server wired by this stack

None currently. Docker's own `docker compose` CLI is the
primary interface; no MCP wrapper is necessary for routine use.

If the project needs container runtime introspection (layer
inspection, image scanning), the operator can add a custom MCP
definition manually.

## When to enable

Enable this stack if the project:

- Defines services via `docker-compose.yml` and runs them
  locally through `docker compose up`.
- Uses BuildKit secret mounts or is about to adopt them.

Do **not** enable if the project:

- Uses plain `Dockerfile` + `docker run` without compose.
- Uses Kubernetes locally via `kind` / `minikube` — a
  `stacks/kubernetes/` is a candidate future stack.

## Related

- [`skills/for-generator/reproducible-local-environment.md`](../../for-generator/reproducible-local-environment.md)
  — the universal reproducible-environment principle that
  Docker Compose is one implementation of.

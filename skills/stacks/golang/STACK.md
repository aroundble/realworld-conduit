# Stack — Go

Enable this stack for projects using Go as a primary
application language (HTTP services, CLI tools, workers,
high-throughput backends).

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [gin-service-pattern.md](gin-service-pattern.md) | generator | Service layout (cmd/ + internal/), Gin router, middleware (auth, request-id, recovery), handler vs. service layer, pgx for Postgres, health + readiness endpoints. |
| [go-reproducible-env.md](go-reproducible-env.md) | generator | `go.mod` + `go.sum` + `.go-version`, vendoring posture, docker compose multi-stage build, golangci-lint config. |
| [godog-bdd-pattern.md](godog-bdd-pattern.md) | generator + evaluator | godog (Gherkin in Go) mirroring planner's Given/When/Then scenarios; net/http + testcontainers for live-boundary testing. |

## When to enable

Enable if the project:

- Has (or will have) a Go-authored backend, worker, or CLI.
- Uses Gin, Fiber, Echo, chi, or raw `net/http`.
- Runs performance-sensitive pipelines (high-RPS APIs,
  pub/sub consumers, gRPC servers).

Do **not** enable if the project is pure frontend or has no
Go artifacts. Overlap with other stacks is fine (Go service
behind a Next.js BFF, Go tool alongside Python).

## Reproducible-environment contract

A Go project that opts into this stack MUST:

1. Pin Go version in `go.mod` (`go 1.23`) AND `.go-version`
   (exact patch, e.g. `1.23.4`). `go.mod` is the language
   floor; `.go-version` is the build-identity.
2. Commit `go.sum`. Reject PRs missing it.
3. Ship a multi-stage `Dockerfile`: `golang:1.23-alpine`
   builder → `gcr.io/distroless/static` runtime. Binary is
   statically linked.
4. Provide `./scripts/dev-up.sh` bringing the service plus
   dependent compose services (postgres, redis, etc.) up in
   one command.

## BDD contract

Per `skills/for-all-roles/bdd-acceptance-scenarios.md`, every
issue's AC is Given/When/Then scenarios. For Go services
without a UI, godog reads the same `.feature` files the
planner wrote and drives the HTTP surface via `net/http` or
`testcontainers-go` for database-involved scenarios. See
`godog-bdd-pattern.md`.

For full-stack projects (Go backend + Next.js frontend),
Playwright covers the UI scenarios and godog covers the API-
only scenarios; keep the feature files in separate subfolders.

## Deploy mode notes

- **`local-only`**: docker compose runs the binary in
  `distroless` container on `localhost:<port>`. Playwright
  (if UI) or curl/godog (if API-only) probes the port.
- **`cloud`**: CDK/Terraform deploys same image to ECS /
  Cloud Run / App Runner. Static binary means extremely
  small images (< 20MB typical). Dockerfile does not change
  between local and cloud.

## Related

- [`skills/for-generator/reproducible-local-environment.md`](../../for-generator/reproducible-local-environment.md)
  — the universal reproducible-env contract.
- [`skills/stacks/docker/STACK.md`](../docker/STACK.md) — the
  compose layer the Go service runs under.
- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../../for-all-roles/bdd-acceptance-scenarios.md)
  — the AC format godog implements.

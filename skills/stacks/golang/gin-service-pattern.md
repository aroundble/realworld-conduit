---
name: gin-service-pattern
description: Use when building or reviewing a Go HTTP service. Covers cmd/ + internal/ layout, Gin router composition, middleware (auth, request-id, recovery, panic handler), handler vs. service layer separation, pgx for Postgres, health + readiness endpoints, and the "E2E exercises the real user path" rule for HTTP-only Go backends.
---

# Skill — Gin service pattern for githarness

A pattern for the **generator** when the stack is a Go HTTP
service (Gin, but the shape applies equally to Fiber / Echo /
chi with trivial syntax swaps).

## The shape we recommend

```
service/
  cmd/
    api/
      main.go                    # entrypoint, wires deps, starts server
  internal/
    app/
      app.go                     # NewApp(cfg) — constructs router + deps
    config/
      config.go                  # env-driven, viper or plain os.Getenv
    handlers/
      guardrails.go              # http.HandlerFunc-style, thin
      health.go
    services/
      guardrail.go               # business logic, framework-free
    repos/
      guardrail_pg.go            # pgx-backed
    middleware/
      auth.go
      request_id.go
      recovery.go
    models/
      guardrail.go               # request / response / domain types
  migrations/
    0001_init.sql
  tests/
    bdd/
      features/
        guardrails.feature
      steps/
        guardrail_test.go
  go.mod
  go.sum
  .go-version
  Dockerfile
  docker-compose.yml
```

## Handler vs. service vs. repo

Three layers. Each does exactly one thing.

```go
// internal/services/guardrail.go — framework-free
package services

import (
    "context"
    "errors"
)

type GuardrailService struct {
    repo GuardrailRepo
}

func NewGuardrailService(repo GuardrailRepo) *GuardrailService {
    return &GuardrailService{repo: repo}
}

func (s *GuardrailService) Create(
    ctx context.Context, tenantID string, in CreateGuardrailInput,
) (*Guardrail, error) {
    exists, err := s.repo.ExistsByName(ctx, tenantID, in.Name)
    if err != nil {
        return nil, err
    }
    if exists {
        return nil, ErrAlreadyExists
    }
    return s.repo.Insert(ctx, tenantID, in)
}

var ErrAlreadyExists = errors.New("guardrail already exists")

// internal/handlers/guardrails.go — Gin-aware
package handlers

import (
    "net/http"
    "github.com/gin-gonic/gin"
)

type GuardrailHandler struct {
    svc *services.GuardrailService
}

func (h *GuardrailHandler) Create(c *gin.Context) {
    var payload models.CreateGuardrailInput
    if err := c.ShouldBindJSON(&payload); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    tenantID := c.GetString("tenant_id")
    g, err := h.svc.Create(c.Request.Context(), tenantID, payload)
    if errors.Is(err, services.ErrAlreadyExists) {
        c.JSON(http.StatusConflict, gin.H{"error": "already exists"})
        return
    }
    if err != nil {
        c.Error(err) // picked up by the error middleware
        return
    }
    c.JSON(http.StatusCreated, g)
}
```

Rules:

- **Service layer has zero `gin` or `net/http` imports.** It
  accepts a `context.Context` and domain structs, returns
  domain structs + errors.
- **Handler is thin.** Parse → call service → map error →
  write response. No business logic.
- **Repo is an interface.** Service depends on the interface,
  not the concrete pgx implementation. Makes unit tests
  trivial; integration tests use the real pgx against a
  testcontainers postgres.

## Router composition

```go
// internal/app/app.go
package app

import (
    "github.com/gin-gonic/gin"
)

func NewRouter(cfg *config.Config, deps *Deps) *gin.Engine {
    r := gin.New()
    r.Use(middleware.RequestID())
    r.Use(middleware.Recovery(cfg.DebugMode))
    r.Use(middleware.Logger())

    // Health — never auth-gated.
    r.GET("/health", deps.HealthHandler.Live)
    r.GET("/ready", deps.HealthHandler.Ready)

    // Auth-gated API.
    api := r.Group("/")
    api.Use(middleware.Auth(cfg.JWTSecret))
    {
        api.POST("/guardrails", deps.GuardrailHandler.Create)
        api.GET("/guardrails", deps.GuardrailHandler.List)
        api.DELETE("/guardrails/:name", deps.GuardrailHandler.Delete)
    }

    return r
}
```

Groups make the auth boundary explicit. A reviewer can see
which routes are protected without reading middleware source.

## Auth middleware

```go
// internal/middleware/auth.go
package middleware

import (
    "net/http"
    "strings"
    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
)

func Auth(secret string) gin.HandlerFunc {
    return func(c *gin.Context) {
        header := c.GetHeader("Authorization")
        token := strings.TrimPrefix(header, "Bearer ")
        if token == "" {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
            return
        }
        claims := jwt.MapClaims{}
        _, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
            return []byte(secret), nil
        })
        if err != nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
            return
        }
        c.Set("tenant_id", claims["tenant_id"])
        c.Set("role", claims["role"])
        c.Next()
    }
}
```

Secret from env (`os.Getenv("JWT_SECRET")`) at startup, never
from per-request lookup. Claims extraction on the `gin.Context`
is the seam service-layer code reads via `ctx.Value`.

## Health endpoints

```go
// internal/handlers/health.go
package handlers

import (
    "context"
    "net/http"
    "time"
    "github.com/gin-gonic/gin"
    "github.com/jackc/pgx/v5/pgxpool"
)

type HealthHandler struct {
    pool *pgxpool.Pool
}

func (h *HealthHandler) Live(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *HealthHandler) Ready(c *gin.Context) {
    ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
    defer cancel()
    if err := h.pool.Ping(ctx); err != nil {
        c.JSON(http.StatusServiceUnavailable, gin.H{"status": "db-down", "error": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
```

`/health` is liveness — process is running. `/ready` is
readiness — dependencies reachable. docker compose healthcheck
targets `/health` with a `wget` probe; a k8s readinessProbe
targets `/ready`.

## Dockerfile

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /out/api /api
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
USER nonroot:nonroot
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD ["/api", "-healthcheck"] || exit 1
ENTRYPOINT ["/api"]
```

- `CGO_ENABLED=0` for static binary.
- `-trimpath -ldflags="-s -w"` strips debug symbols, small image.
- `distroless/static:nonroot` — no shell, no package manager,
  no root user. ~2MB base.
- `-healthcheck` flag implemented in main that does `http.Get
  /health` against localhost and exits 0/1 — avoids needing
  `wget` in the image.

## BDD pattern (HTTP-only)

See `godog-bdd-pattern.md` for the full recipe. For Go
backends with no UI, the `Then` clause reads the HTTP response
and asserts status + body; the evaluator's evidence is the
curl / response JSON quoted in the merge comment, not a
screenshot.

## The evaluator's review questions

1. Is there a `cmd/` → `internal/` separation, or is everything
   in `main.go`?
2. Are services framework-free (no `gin` imports in
   `internal/services/`)?
3. Are repo interfaces defined in the service package so
   tests can substitute implementations?
4. Is auth middleware applied via `gin.Group`, so the auth
   boundary is visible in the router definition?
5. Does `/ready` exercise the database pool with a timeout, or
   is it a stub?
6. Is the Dockerfile multi-stage with `distroless/static`
   runtime?
7. Is there a godog suite covering each AC scenario?
8. Does `docker compose up` bring the service to healthy in
   under 15 seconds?

## Related

- [`go-reproducible-env.md`](go-reproducible-env.md) — the
  `go.mod` / `.go-version` / lockfile contract.
- [`godog-bdd-pattern.md`](godog-bdd-pattern.md) — BDD
  scenarios driving Gin handlers.
- [`skills/for-generator/reproducible-local-environment.md`](../../for-generator/reproducible-local-environment.md)
  — the universal reproducibility contract.

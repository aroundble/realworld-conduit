---
name: fastapi-service-pattern
description: Use when building or reviewing a FastAPI service. Covers app factory + routers, pydantic models, dependency injection for auth/DB, health endpoint, OpenAPI export, and the "E2E exercises the real user path" rule for HTTP-only backends.
---

# Skill — FastAPI service pattern for githarness

A pattern for the **generator** when the target stack is a
Python FastAPI backend. Enforces the BDD / E2E discipline from
`skills/for-all-roles/bdd-acceptance-scenarios.md` for
HTTP-only services (no UI, so the BDD boundary is the HTTP
surface instead of a browser).

## The shape we recommend

```
api/
  src/
    app.py                     # create_app() factory
    config.py                  # pydantic-settings, env-driven
    routers/
      __init__.py
      auth.py
      guardrails.py            # one router per resource
      health.py                # /health + /ready
    models/
      pydantic/                # request/response models
      db/                      # SQLAlchemy / SQLModel entities
    services/
      guardrail_service.py     # business logic, framework-free
    deps.py                    # Depends(...) providers
    middleware/
      auth.py
      request_id.py
      error_handler.py
    main.py                    # `uvicorn api.src.main:app`
  tests/
    unit/
    integration/
    bdd/                       # pytest-bdd features + step defs
      features/
        guardrails.feature
      steps/
        guardrail_steps.py
  pyproject.toml
  uv.lock
  Dockerfile
  .python-version
```

## App factory

Separate app construction from run entry. Factory lets tests
spin the app with overridden dependencies.

```python
# api/src/app.py
from fastapi import FastAPI
from .routers import auth, guardrails, health
from .middleware import request_id, error_handler, auth as auth_mw
from .config import Settings

def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(
        title=settings.service_name,
        version=settings.service_version,
        docs_url="/docs" if settings.expose_docs else None,
    )
    app.add_middleware(request_id.RequestIDMiddleware)
    app.add_middleware(error_handler.ErrorHandlerMiddleware)
    app.add_middleware(auth_mw.AuthMiddleware, settings=settings)
    app.include_router(health.router)
    app.include_router(auth.router, prefix="/auth")
    app.include_router(guardrails.router, prefix="/guardrails")
    return app

# api/src/main.py
from .app import create_app
app = create_app()
```

## Pydantic for I/O, services for logic

```python
# api/src/models/pydantic/guardrail.py
from pydantic import BaseModel, Field
from typing import Literal

class GuardrailCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    severity: Literal["warn", "block"] = "block"

class GuardrailOut(BaseModel):
    id: str
    name: str
    severity: Literal["warn", "block"]
    created_at: str

# api/src/services/guardrail_service.py
# No FastAPI imports here. Business logic is framework-free so
# unit tests don't need a TestClient.
class GuardrailService:
    def __init__(self, repo: "GuardrailRepo"):
        self.repo = repo
    async def create(self, tenant_id: str, payload: GuardrailCreate) -> GuardrailOut:
        if await self.repo.exists(tenant_id, payload.name):
            raise AlreadyExists(payload.name)
        return await self.repo.insert(tenant_id, payload)

# api/src/routers/guardrails.py
from fastapi import APIRouter, Depends
from ..deps import current_tenant, guardrail_service

router = APIRouter()

@router.post("", response_model=GuardrailOut, status_code=201)
async def create_guardrail(
    payload: GuardrailCreate,
    tenant_id: str = Depends(current_tenant),
    svc: GuardrailService = Depends(guardrail_service),
):
    return await svc.create(tenant_id, payload)
```

The **service** layer is what unit tests hit. The **router**
layer is what BDD tests hit (through `httpx.AsyncClient` or a
live uvicorn). Two layers of assertions, two contracts.

## Auth middleware

Two flavors most projects need:

```python
# api/src/middleware/auth.py — JWT bearer
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
import jwt

EXEMPT = {"/health", "/ready", "/docs", "/openapi.json"}

class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings):
        super().__init__(app)
        self.secret = settings.jwt_secret
        self.algo = settings.jwt_algo

    async def dispatch(self, request: Request, call_next):
        if request.url.path in EXEMPT:
            return await call_next(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
        try:
            claims = jwt.decode(token, self.secret, algorithms=[self.algo])
        except jwt.PyJWTError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
        request.state.auth = claims
        return await call_next(request)
```

Rules:

- Secret from env / Secrets Manager, not hardcoded.
- Bearer on every endpoint except health/docs/openapi.
- JWT exp/iat enforced — not ignored.
- Role lives in the claim, not looked up per request (unless
  the project explicitly needs live revocation).

## Health endpoints

Every FastAPI service has exactly these two:

```python
# api/src/routers/health.py
from fastapi import APIRouter
from ..deps import db_pool

router = APIRouter()

@router.get("/health")
async def health():
    # liveness — process is alive, event loop responding
    return {"status": "ok"}

@router.get("/ready")
async def ready(pool = Depends(db_pool)):
    # readiness — dependencies reachable
    async with pool.acquire() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ready"}
```

`docker compose` healthcheck targets `/health`; the evaluator's
`docker compose ps` reads "Up (healthy)" because of this route.
`/ready` is what a load balancer or kube readinessProbe points
at. If the project conflates the two, fix it — "healthy but
DB-down" is a legitimate state for `/health` to return.

## Dockerfile

```dockerfile
FROM python:3.13-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.13-slim AS runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY api ./api
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "api.src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`uv sync --frozen --no-dev` produces a reproducible install
from the lockfile and omits dev deps. No runtime hits the
network for packages.

## BDD pattern (HTTP-only service)

See `pytest-bdd-pattern.md` for the full recipe. The key line:
for services with no UI, the BDD `Then` clause reads the HTTP
response, not a browser screenshot. A scenario like:

```gherkin
Scenario: Admin creates a guardrail and enforcement takes effect
  Given an admin bearer token with tenant_id "t1"
  When the admin POSTs to /guardrails with {"name": "profanity", "severity": "block"}
  Then the response status is 201
  And the response body includes {"name": "profanity", "severity": "block"}
  And a subsequent POST /chat with profanity returns 403
```

The evaluator still runs live against docker compose, but the
`Then` evidence is curl output + JSON in the merge comment
instead of a screenshot. Visual-evidence skill doesn't apply to
pure-HTTP services; the HTTP response body IS the visual
evidence.

## The evaluator's review questions

1. Is there a service layer separate from routers? (unit-testable)
2. Is auth middleware enforced everywhere except health/docs?
3. Are pydantic models used for ALL request/response — no raw
   `dict` returned from a router?
4. Does `/ready` actually exercise a dependency, or is it a
   stub returning `{"ok": true}`?
5. Is there a pytest-bdd suite covering each AC scenario?
6. Does `docker compose up` bring the service to
   `Up (healthy)` within 30s?
7. Are env vars wrapped in `pydantic-settings` (Settings class),
   not `os.environ.get(...)` scattered across modules?

## Related

- [`python-reproducible-env.md`](python-reproducible-env.md) —
  the `uv` + lockfile + `.python-version` contract.
- [`pytest-bdd-pattern.md`](pytest-bdd-pattern.md) — how BDD
  scenarios attach to FastAPI routers.
- [`skills/for-generator/reproducible-local-environment.md`](../../for-generator/reproducible-local-environment.md)
  — the universal reproducibility contract.

#!/usr/bin/env bash
# smoke — verify the walking-skeleton compose stack is up and healthy.
#
# Checks:
#   1. postgres service is healthy (docker compose ps)
#   2. GET ${WEB_URL}/         → HTTP 200, non-empty body
#   3. GET ${API_URL_HOST}/healthz → HTTP 200, {"ok":true}
#
# Exits non-zero on any failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

WEB_URL_HOST="${WEB_URL:-http://localhost:${WEB_HOST_PORT:-3000}}"
API_URL_HOST="http://localhost:${API_HOST_PORT:-3001}"

COMPOSE="docker compose -f infra/docker-compose.yml --env-file .env"

echo "[smoke] postgres health"
if ! $COMPOSE ps postgres --format json | grep -q '"Health":"healthy"'; then
  echo "[smoke] postgres not healthy" >&2
  $COMPOSE ps
  exit 1
fi

echo "[smoke] GET ${API_URL_HOST}/healthz"
api_body=$(curl -fsS "${API_URL_HOST}/healthz")
# /healthz returns { ok, checks: { db } } per #25's observability floor.
# Use a shape assertion (ok=true AND checks.db=ok) rather than literal
# equality so the smoke catches db-fail (`checks.db=fail` → 503) the
# same way it catches api-down, and so additive extensions to the
# envelope (future `checks.queue`, `checks.cache`) don't break smoke.
if ! printf '%s' "$api_body" | jq -e '.ok == true and .checks.db == "ok"' >/dev/null; then
  echo "[smoke] unexpected api body: $api_body" >&2
  exit 1
fi

echo "[smoke] GET ${WEB_URL_HOST}/"
web_body=$(curl -fsS "${WEB_URL_HOST}/")
if [[ -z "$web_body" ]] || ! printf '%s' "$web_body" | grep -qi '<html'; then
  echo "[smoke] web body missing <html> or empty" >&2
  exit 1
fi

echo "[smoke] all checks passed"

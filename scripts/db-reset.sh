#!/usr/bin/env bash
# db-reset — bring the compose database back to a clean migration-applied
# state. Used by `test:conformance` so every Bruno run starts from the
# same baseline (no leftover users / articles / favorites from prior
# runs colliding with collection fixtures).
#
# Usage:
#   bash scripts/db-reset.sh
#
# Env:
#   POSTGRES_USER     — default "conduit"
#   POSTGRES_DB       — default "conduit"
#   POSTGRES_PASSWORD — required (matches infra/docker-compose.yml)
#   POSTGRES_CONTAINER — default "conduit-postgres-1" (compose project name)
#
# The script truncates every app table (CASCADE handles join tables),
# which leaves the schema intact so Bruno runs start with an empty but
# migrated database. Truncate + RESTART IDENTITY resets sequence values
# so uid-generated emails / usernames don't collide across runs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

: "${POSTGRES_USER:=conduit}"
: "${POSTGRES_DB:=conduit}"

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  if [[ -f .env ]]; then
    # shellcheck disable=SC2046
    export $(grep -E '^POSTGRES_PASSWORD=' .env | xargs)
  fi
fi
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "[db-reset] POSTGRES_PASSWORD missing — run scripts/dev-bootstrap.sh or export it." >&2
  exit 1
fi

# docker exec into the postgres container is the portable way to speak
# psql without installing it on every contributor's host. Container
# name is the compose project's postgres service by default.
CONTAINER="${POSTGRES_CONTAINER:-conduit-postgres-1}"

docker exec -i \
  "$CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE
  "_UserFavorites",
  "_UserFollows",
  "_ArticleToTag",
  "Comment",
  "Article",
  "Tag",
  "User"
RESTART IDENTITY CASCADE;
SQL

echo "[db-reset] truncated conduit tables on container ${CONTAINER}"

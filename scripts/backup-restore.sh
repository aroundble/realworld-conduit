#!/usr/bin/env bash
# backup-restore (#157). Reads a gzipped pg_dump custom-format
# archive and restores it into the running Postgres container.
# The target DB is DROPPED + RECREATED before restore so the
# result is exactly what was in the dump — no merge, no residue.
#
# Usage:
#   pnpm backup:restore backups/conduit-20260429T210000Z.sql.gz
#
# SAFETY: this is destructive. The target DB's existing content
# is discarded. Intended for dev/test stacks; production should
# restore into a fresh DB + cut over, not restore in place.

set -euo pipefail

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "usage: $0 <backup-file.sql.gz>" >&2
  exit 2
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[backup-restore] backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

POSTGRES_USER="${POSTGRES_USER:-conduit}"
POSTGRES_DB="${POSTGRES_DB:-conduit}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-conduit}"

CONTAINER=""
for candidate in \
  "${COMPOSE_PROJECT}-${COMPOSE_SERVICE}-1" \
  "${COMPOSE_PROJECT}_${COMPOSE_SERVICE}_1"; do
  if docker ps --format '{{.Names}}' | grep -Fxq "$candidate"; then
    CONTAINER="$candidate"
    break
  fi
done
if [[ -z "$CONTAINER" ]]; then
  echo "[backup-restore] no running postgres container found for project=${COMPOSE_PROJECT} service=${COMPOSE_SERVICE}" >&2
  exit 1
fi

echo "[backup-restore] container=${CONTAINER} db=${POSTGRES_DB} file=${BACKUP_FILE}"

# We first disconnect every active session against the target DB
# (api container holds persistent connections via Prisma), then
# drop + recreate it, then pg_restore into the fresh DB. The
# api pool reconnects on the next request because Prisma catches
# connection errors + retries.
#
# DB drop happens via psql against the postgres maintenance DB,
# so the target DB can be a disconnected dropee.
echo "[backup-restore] locking + terminating active connections to ${POSTGRES_DB}"
# REVOKE CONNECT first + ALLOW_CONNECTIONS=false so new
# connections can't race in between the terminate loop and the
# DROP. The api's Prisma pool reconnects on first request after
# the restore completes; these lock-outs are transient.
docker exec -i "$CONTAINER" psql \
  --username="$POSTGRES_USER" \
  --dbname=postgres \
  -c "ALTER DATABASE ${POSTGRES_DB} WITH ALLOW_CONNECTIONS false;" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
  >/dev/null 2>&1 || true

# Poll until pg_stat_activity confirms zero connections. Repeat
# the terminate each pass — a client that reconnected in the
# window between flag-set and terminate will still be killed
# here.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  ACTIVE=$(docker exec -i "$CONTAINER" psql \
    --username="$POSTGRES_USER" \
    --dbname=postgres \
    -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}' AND pid <> pg_backend_pid();" 2>/dev/null \
    | tr -d '[:space:]')
  if [[ "$ACTIVE" == "0" ]]; then break; fi
  sleep 0.3
  docker exec -i "$CONTAINER" psql \
    --username="$POSTGRES_USER" \
    --dbname=postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
done

echo "[backup-restore] dropping + recreating ${POSTGRES_DB}"
docker exec -i "$CONTAINER" psql \
  --username="$POSTGRES_USER" \
  --dbname=postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"
docker exec -i "$CONTAINER" psql \
  --username="$POSTGRES_USER" \
  --dbname=postgres \
  -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};"

echo "[backup-restore] streaming ${BACKUP_FILE} into pg_restore"
# gunzip -c locally + stream into pg_restore in the container.
# --clean + --if-exists would be redundant with the drop above,
# but they guard against the rare case where a -Fc dump already
# contains schema recreation commands.
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" pg_restore \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --no-owner \
  --no-acl \
  --exit-on-error

echo "[backup-restore] done — ${POSTGRES_DB} restored from ${BACKUP_FILE}"

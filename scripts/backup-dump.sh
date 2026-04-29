#!/usr/bin/env bash
# backup-dump (#157). Streams pg_dump -Fc (custom format) out of
# the running Postgres container and writes a timestamped
# .sql.gz to backups/. Exit 0 on success, non-zero on any step
# that fails (docker not running, DB unreachable, disk full).
#
# Usage:
#   pnpm backup:dump             # default output dir: ./backups
#   BACKUP_DIR=/mnt/ops pnpm backup:dump
#
# The -Fc format is Postgres's native binary archive, smaller +
# faster to restore than plain SQL. Gzip adds a further ~3x
# compression. pg_restore (used by backup-restore.sh) is the
# only tool that can read -Fc output — plain SQL dumps would
# work with psql, but -Fc's resilience (parallel restore, file
# corruption detection) is worth the lock-in.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
POSTGRES_USER="${POSTGRES_USER:-conduit}"
POSTGRES_DB="${POSTGRES_DB:-conduit}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-conduit}"

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/conduit-${TS}.sql.gz"

# Resolve the container name. Compose v2 uses "<project>-<service>-<N>"
# (hyphenated) but an older project may use underscores; try both.
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
  echo "[backup-dump] no running postgres container found for project=${COMPOSE_PROJECT} service=${COMPOSE_SERVICE}" >&2
  echo "[backup-dump] hint: bring up the stack with 'docker compose -f infra/docker-compose.yml --env-file .env up -d'" >&2
  exit 1
fi

echo "[backup-dump] container=${CONTAINER} db=${POSTGRES_DB} user=${POSTGRES_USER}"
echo "[backup-dump] writing ${OUT}"

# -Fc: custom format. --no-owner / --no-acl: backups should be
# role-neutral so the restored DB adopts the target user, not the
# source user. Pipe through gzip before hitting disk so we never
# materialize the uncompressed dump.
docker exec "$CONTAINER" pg_dump \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  --no-acl \
  | gzip -9 > "$OUT"

SIZE="$(du -h "$OUT" | awk '{print $1}')"
echo "[backup-dump] done — ${OUT} (${SIZE})"

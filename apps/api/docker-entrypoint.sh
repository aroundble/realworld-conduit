#!/bin/sh
# Run Prisma migrations before handing off to the Hono server.
#
# prisma migrate deploy is idempotent: on a fresh database it applies every
# pending migration; on an already-migrated database it prints
# "No pending migrations to apply" and exits 0. The server only starts
# after this returns 0 — so an unreachable DB, a broken migration, or a
# schema drift fails the container at startup instead of at first query.

set -eu

echo "[api] running prisma migrate deploy"
node_modules/.bin/prisma migrate deploy
echo "[api] migrations applied"

exec "$@"

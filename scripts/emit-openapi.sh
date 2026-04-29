#!/usr/bin/env bash
# Emit the OpenAPI snapshot at docs/openapi-snapshot.json.
#
# Runs the in-process emitter (apps/api/src/scripts/emit-openapi.ts)
# via tsx so it doesn't require a pre-built dist or a live compose
# stack — just node_modules.
#
# CI drift gate calls this and then `git diff --exit-code` on the
# snapshot; a schema change without a snapshot refresh fails the PR.
# Generator refreshes the snapshot in the same PR as the route change.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT="docs/openapi-snapshot.json"

# Imports createApp(), which pulls in the Prisma client; the client
# module refuses to load without DATABASE_URL even though emit never
# makes a query. A dummy URL satisfies the module-init check and
# never connects (no await prisma.* calls in emit).
export DATABASE_URL="postgresql://conduit:dummy@localhost:5432/conduit-openapi-emit"

# `pnpm -C apps/api exec tsx` uses the api's local tsx binary so
# we don't need tsx at the repo root.
pnpm -C apps/api exec tsx src/scripts/emit-openapi.ts > "$OUT"

echo "[openapi-emit] wrote $OUT"

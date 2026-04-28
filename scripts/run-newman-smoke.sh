#!/usr/bin/env bash
# run-newman-smoke — execute the minimal Newman smoke and write the
# JUnit report the evaluator's gate 6 expects at
# tests/api/results/latest.xml (with a `latest` symlink for the gate's
# glob-free lookup).
#
# Usage:
#   bash scripts/run-newman-smoke.sh
#
# Env:
#   API_URL — base URL of the running API (default http://localhost:3001).
#
# Designed to run in ≤ 15s against the compose stack.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

API_URL="${API_URL:-http://localhost:3001}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS_DIR="tests/api/results"
RUN_XML="${RESULTS_DIR}/${TS}.xml"

mkdir -p "$RESULTS_DIR"

# newman's junit reporter writes to --reporter-junit-export <path>.
node_modules/.bin/newman run \
  tests/api/collections/healthz-smoke.postman_collection.json \
  --env-var "apiUrl=${API_URL}" \
  --reporters cli,junit \
  --reporter-junit-export "$RUN_XML"

# The gate reads tests/api/results/latest — symlink to the freshest
# run so subsequent runs supersede deterministically. Use -f so reruns
# overwrite cleanly.
ln -sf "$(basename "$RUN_XML")" "${RESULTS_DIR}/latest"

echo "[newman-smoke] wrote ${RUN_XML} and updated ${RESULTS_DIR}/latest"

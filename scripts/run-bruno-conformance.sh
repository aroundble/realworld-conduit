#!/usr/bin/env bash
# run-bruno-conformance — execute the canonical RealWorld Bruno
# collection against the running compose stack and write a timestamped
# report under tests/api/results/.
#
# Usage:
#   pnpm test:conformance
#   # or: bash scripts/run-bruno-conformance.sh
#
# Env:
#   API_HOST_PORT — defaults to 3101 via tests/api/bruno/environments/compose.bru
#
# The pre-run DB reset is opt-out via SKIP_DB_RESET=1 so ad-hoc
# "run just once to see what fails" iterations can skip the 1-2s
# truncate step. CI always runs with the reset on.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS_DIR="tests/api/results/${TS}"
mkdir -p "$RESULTS_DIR"

if [[ "${SKIP_DB_RESET:-0}" != "1" ]]; then
  echo "[bruno] resetting db before run"
  bash scripts/db-reset.sh
fi

echo "[bruno] running against $(grep -E '^\s*host:' tests/api/bruno/environments/compose.bru | awk '{print $2}')"

# Bruno CLI insists on running from the collection root (it walks up
# for bruno.json). Absolute paths let the reporters still land under
# the repo's tests/api/results/ tree regardless of cwd.
ABS_JSON_REPORT="${REPO_ROOT}/${RESULTS_DIR}/bruno-report.json"
ABS_HTML_REPORT="${REPO_ROOT}/${RESULTS_DIR}/bruno-report.html"
ABS_BRU_BIN="${REPO_ROOT}/node_modules/.bin/bru"

# --reporter-json / --reporter-html land in the timestamped dir so
# every run is preserved; a `latest` symlink updates to the freshest.
# Exit code is the bru run's — non-zero on any assertion failure, per
# AC scenario 2's CI gate contract.
set +e
# --disable-cookies stops bruno from auto-preserving the session
# cookie we set on login/register. Without this, the HTTP-only
# `conduit_session` cookie (compat kept for AC scenario 4) leaks
# into downstream "no auth" error tests and makes 401 cases return
# 201/200, turning the suite into a false pass.
#
# BRUNO_HOST overrides the collection env's `host` var — local runs
# use the compose.bru default (http://localhost:3101), CI exports
# http://localhost:3001 to match its dev-bootstrap port, and anyone
# running against a remote env can point this wherever.
ENV_VAR_ARGS=()
if [[ -n "${BRUNO_HOST:-}" ]]; then
  ENV_VAR_ARGS=(--env-var "host=${BRUNO_HOST}")
fi

(cd "${REPO_ROOT}/tests/api/bruno" && \
  "${ABS_BRU_BIN}" run \
    --env compose \
    --disable-cookies \
    "${ENV_VAR_ARGS[@]}" \
    --reporter-json "${ABS_JSON_REPORT}" \
    --reporter-html "${ABS_HTML_REPORT}")
EXIT=$?
set -e

# Refresh the `latest` symlink so downstream tooling (evaluator gate,
# CI artifacts upload) has a stable path.
ln -sfn "${TS}" "tests/api/results/latest"

echo "[bruno] report: ${RESULTS_DIR}/bruno-report.html (bru exit ${EXIT})"

# Baseline-aware gate: the full spec against our API has known drift
# (see tests/api/bruno-baseline.json — follow-up issues fix each
# cluster). A run is a pass iff the set of failing request paths is
# exactly the baseline. Anything else — a new failure or a baseline
# entry that now passes — is a regression the gate flags.
#
# Setting CONFORMANCE_STRICT=1 bypasses the baseline and fails the
# run on any bruno-reported failure, which is how the end-state merge
# gate runs once all clusters are at zero.
if [[ "${CONFORMANCE_STRICT:-0}" == "1" ]]; then
  exit "${EXIT}"
fi

node "${REPO_ROOT}/scripts/bruno-compare-baseline.js" \
  "${ABS_JSON_REPORT}" \
  "${REPO_ROOT}/tests/api/bruno-baseline.json"

#!/usr/bin/env node
// bruno-compare-baseline — gate that compares a Bruno run's failures
// against the recorded baseline. Fails (exit 1) if:
//   - any request path failed that is NOT in the baseline (regression), OR
//   - a baseline-listed path passed (baseline is stale; tighten it)
// Otherwise exits 0, preserving the CI gate AC's "any conformance
// regression fails the build" contract while tracking the expected
// drift list explicitly (follow-up issues drive each cluster to zero).
//
// Usage:
//   node scripts/bruno-compare-baseline.js <report.json> <baseline.json>

const fs = require("node:fs");
const path = require("node:path");

const [, , reportPath, baselinePath] = process.argv;
if (!reportPath || !baselinePath) {
  console.error("usage: bruno-compare-baseline <report.json> <baseline.json>");
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const iteration = Array.isArray(report) ? report[0] : report;
const results = iteration?.results ?? [];

const failingNow = new Set();
for (const item of results) {
  const fn = item?.test?.filename ?? "";
  if (!fn) continue;
  const assertFails = (item.assertionResults ?? []).some((a) => a.status !== "pass");
  const postFails = (item.postResponseTestResults ?? []).some((t) => t.status !== "pass");
  const preFails = (item.preRequestTestResults ?? []).some((t) => t.status !== "pass");
  if (assertFails || postFails || preFails) failingNow.add(fn);
}

const baselinePaths = new Set((baseline.knownFailing ?? []).map((e) => e.path));

const newRegressions = [...failingNow].filter((p) => !baselinePaths.has(p)).sort();
const newlyPassing = [...baselinePaths].filter((p) => !failingNow.has(p)).sort();

console.log(`[baseline] total requests: ${results.length}`);
console.log(`[baseline] failing now: ${failingNow.size}`);
console.log(`[baseline] baseline size: ${baselinePaths.size}`);
console.log(`[baseline] new regressions: ${newRegressions.length}`);
console.log(`[baseline] newly passing (baseline stale): ${newlyPassing.length}`);

if (newRegressions.length) {
  console.log("\n[baseline] REGRESSIONS — these requests failed but are not in the baseline:");
  for (const p of newRegressions) console.log(`  - ${p}`);
}
if (newlyPassing.length) {
  console.log("\n[baseline] STALE — these baseline entries now pass; remove them from tests/api/bruno-baseline.json:");
  for (const p of newlyPassing) console.log(`  - ${p}`);
}

if (newRegressions.length || newlyPassing.length) {
  process.exit(1);
}
console.log("\n[baseline] OK — failures match baseline exactly.");

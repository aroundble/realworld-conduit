import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const webBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const repoRoot = resolve(__dirname, "..", "..");

// Minimal gate-3/gate-4 smoke config. One project, one browser, no mobile
// emulation, no auth storage-state. The full Page-Object Pattern + auth
// fixture + mobile + axe layer ships in #35 on top of this baseline.
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 15_000,

  use: {
    baseURL: webBaseURL,
    screenshot: "only-on-failure",
    trace: "off",
  },

  reporter: [
    ["list"],
    // summary.json lands under tests/e2e/test-results/<utc-ts>/summary.json —
    // the merge-gate script (scripts/eval-merge-gate.sh) picks the freshest
    // summary.json under tests/e2e/test-results/ by mtime. Path is resolved
    // relative to the repo root, not the testDir.
    ["json", { outputFile: resolveSummaryPath(repoRoot) }],
  ],

  outputDir: resolve(repoRoot, "tests/e2e/test-results/_playwright-output"),
});

function resolveSummaryPath(root: string): string {
  if (process.env.PLAYWRIGHT_SUMMARY_PATH) {
    return process.env.PLAYWRIGHT_SUMMARY_PATH;
  }
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "Z");
  return resolve(root, `tests/e2e/test-results/${ts}/summary.json`);
}

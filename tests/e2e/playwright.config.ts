import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const webBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const repoRoot = resolve(__dirname, "..", "..");

// Playwright config. Two projects:
//   - `desktop` (default) — Chromium at desktop viewport. Runs every
//     spec; the existing suite was authored against this shape.
//   - `mobile` — Chromium with Pixel 5 device emulation. Runs only
//     specs tagged with `@mobile` (responsive-reflow assertions).
//     Use `pnpm test:e2e:mobile` to target just this project; the
//     full `pnpm test:e2e` runs both.
//
// #35 Phase 1 lands the mobile project + one responsive assertion
// on spec 17. Per-feature Phase-2 PRs widen the mobile coverage as
// page-objects extract.
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

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      // Desktop runs everything except @mobile-tagged specs —
      // those assertions (tap-target floor, reflow widths) only
      // make sense under the Pixel 5 viewport.
      grepInvert: /@mobile/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      // Mobile project only runs specs opted-in via @mobile tag —
      // prevents the existing 100+ desktop-authored tests from
      // running twice. Specs opt in via `test(..., { tag: '@mobile' })`
      // or by appending `@mobile` to the test title.
      grep: /@mobile/,
    },
  ],

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

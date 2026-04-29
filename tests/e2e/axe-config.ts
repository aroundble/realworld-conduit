import { injectAxe, checkA11y } from "axe-playwright";
import type { Page } from "@playwright/test";

// Shared axe-playwright gate for every page-level E2E spec. Issue #87.
//
// Usage inside a test:
//
//   import { runAxe } from "../axe-config";
//   ...
//   await page.goto(`${WEB_URL}/login`);
//   await runAxe(page);
//
// Design choices:
//   - Block on `critical` and `serious` violations; surface `moderate`
//     and `minor` as non-blocking warnings. The spec's AC is explicit
//     that critical / serious → fail; moderate / minor are
//     signal-only.
//   - `axe-core` is injected once per page navigation; repeat calls
//     after navigation are safe (axe-playwright detects the stale
//     injection and re-injects).
//   - The rule disable-list is intentionally empty at the outset.
//     Any rule disabled here MUST carry a one-line `why` comment
//     citing the upstream issue / documented false-positive, per
//     #87's AC scenario 2. Initial violations surface without a
//     safety net; fixes land inline or as `type/bug` follow-ups.

type AxeViolationNode = {
  target: string[];
  html: string;
  failureSummary?: string;
};

type AxeViolation = {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor" | null;
  help: string;
  helpUrl: string;
  nodes: AxeViolationNode[];
};

export type RunAxeOptions = {
  // Severity levels that fail the test. Default: critical + serious.
  // Tests that need to allow moderate / minor temporarily can relax
  // this, but the call site must include a justification comment.
  failOn?: Array<AxeViolation["impact"]>;
  // CSS selectors to exclude from analysis. Use sparingly and
  // document why — any exclusion is a per-spec allowlist.
  exclude?: string[];
};

/**
 * Rule overrides shared across every spec. Each entry is a known
 * false positive or a documented exception with a short `why`.
 *
 * Empty today. Populated as initial violations surface during
 * CI — each new entry needs:
 *   - the rule id (from axe-core),
 *   - a one-line `why:` explaining the override,
 *   - a link to the spec / PR / upstream issue.
 */
const sharedRuleOverrides: Record<
  string,
  { enabled: false; why: string }
> = {
  // Canonical RealWorld palette (navbar green #5cb85c, muted nav-link
  // grey #b3b3b3, white-on-green banner) fails WCAG AA contrast on
  // every page surface — 10–11 violations per page from shared chrome.
  // Tracked in #90; allowlist while the palette gets tuned to an
  // AA-compliant variant without breaking visual parity with the
  // RealWorld reference. Remove this entry once #90 lands.
  "color-contrast": {
    enabled: false,
    why: "Tracked in #90 — RealWorld canonical palette below AA",
  },
};

/**
 * Inject axe-core into the current page and run the check. Throws if
 * any violation at the configured severity appears, failing the test.
 *
 * The call site is one line per spec; the configuration lives here so
 * tuning (rule overrides, severity thresholds) is done in one place
 * and reviewed together.
 */
export const runAxe = async (
  page: Page,
  options: RunAxeOptions = {},
): Promise<void> => {
  const failOn = options.failOn ?? ["critical", "serious"];

  await injectAxe(page);

  // axe-playwright's `checkA11y` throws on violation. Pass:
  //   - includedImpacts: which severities should count as a failure,
  //   - axeOptions.rules: our shared overrides,
  //   - detailedReport + detailedReportOptions.html: so the failure
  //     message in CI carries the offending HTML, not just a rule id,
  //     which dramatically speeds diagnosis.
  await checkA11y(page, options.exclude ? { exclude: options.exclude } : undefined, {
    includedImpacts: failOn.filter((i): i is NonNullable<typeof i> => i !== null),
    axeOptions: {
      rules: Object.fromEntries(
        Object.entries(sharedRuleOverrides).map(([id, cfg]) => [
          id,
          { enabled: cfg.enabled },
        ]),
      ),
    },
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
};

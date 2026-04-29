// Bundle-size budget for apps/web.
//
// size-limit runs after `next build` and sums the compressed bytes of
// every file under `.next/static/chunks/`. The budgets are the upper
// bound — exceeding any of them fails the `pnpm size-limit` gate
// (see `.github/workflows/ci.yml`).
//
// Why these numbers: see docs/quality-gates.md. They started from
// the Next.js 16 walking-skeleton baseline + the markdown pipeline
// (unified + remark + rehype-sanitize) landed in #18 + the
// @conform-to runtime that auth / editor / settings share. Each
// entry is picked so the initial measurement lands about 10–15%
// under the budget — enough headroom to absorb small feature
// additions, tight enough that a runaway dep surfaces in review.
//
// Next.js 16 drops the legacy `main*.js` / `framework*.js` names in
// favour of fully-hashed chunks under `.next/static/chunks/`, so we
// measure the whole chunk directory rather than per-entry names.
//
// To retune: check the size-limit CI step's `Size` column, bump the
// relevant limit, land as `chore(ci): tune size-limit` with
// reasoning.

module.exports = [
  {
    // Every JS chunk Next emits. Includes framework, vendor, and
    // app code — Next 16 hashes them into one pool so the granular
    // split is no longer stable.
    name: "Chunks JS (gzipped)",
    path: ".next/static/chunks/*.js",
    gzip: true,
    limit: "320 KB",
  },
  {
    // CSS lives next to JS under Next 16.
    name: "Chunks CSS (gzipped)",
    path: ".next/static/chunks/*.css",
    gzip: true,
    limit: "30 KB",
  },
];

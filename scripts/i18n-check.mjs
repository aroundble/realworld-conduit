#!/usr/bin/env node
// i18n:check — verify every locale bundle has the same key set as
// `en/common.json`. Run in CI + locally before shipping any
// translation-touching PR.
//
// Exit codes:
//   0 — all locales match en
//   1 — divergence found (missing or extra keys)
//
// Output is intentionally diff-shaped so a failed CI log is
// actionable: "ko is missing `nav.foo`" / "de has extra
// `bar.baz`". No noise, just keys.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, "..", "apps", "web", "messages");
const DEFAULT_LOCALE = "en";

const flatten = (obj, prefix = "") => {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v, key));
    } else {
      out.push(key);
    }
  }
  return out.sort();
};

const loadBundle = (locale) => {
  const file = join(MESSAGES_DIR, locale, "common.json");
  return JSON.parse(readFileSync(file, "utf8"));
};

const listLocales = () =>
  readdirSync(MESSAGES_DIR).filter((name) =>
    statSync(join(MESSAGES_DIR, name)).isDirectory(),
  );

const main = () => {
  const locales = listLocales();
  if (!locales.includes(DEFAULT_LOCALE)) {
    console.error(`[i18n-check] default locale '${DEFAULT_LOCALE}' missing`);
    process.exit(1);
  }
  const baseKeys = new Set(flatten(loadBundle(DEFAULT_LOCALE)));
  let failed = false;

  for (const locale of locales) {
    if (locale === DEFAULT_LOCALE) continue;
    const keys = new Set(flatten(loadBundle(locale)));
    const missing = [...baseKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !baseKeys.has(k));
    if (missing.length > 0) {
      failed = true;
      console.error(`[i18n-check] ${locale} is missing keys:`);
      for (const k of missing) console.error(`  - ${k}`);
    }
    if (extra.length > 0) {
      failed = true;
      console.error(`[i18n-check] ${locale} has extra keys (not in ${DEFAULT_LOCALE}):`);
      for (const k of extra) console.error(`  - ${k}`);
    }
  }

  if (failed) {
    console.error("\n[i18n-check] FAILED — add the missing keys to keep locales in sync");
    process.exit(1);
  }
  console.log(
    `[i18n-check] OK — ${locales.length} locales, ${baseKeys.size} keys each`,
  );
};

main();

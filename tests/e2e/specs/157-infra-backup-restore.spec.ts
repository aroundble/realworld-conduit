import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #157 — pg_dump + pg_restore round-trip
// on the compose stack. Seeds an article, calls `pnpm
// backup:dump`, wipes the article from the DB, calls
// `pnpm backup:restore`, asserts the article re-appears.
//
// The spec shells out to the scripts rather than invoking
// pg_dump directly — that's the contract we ship; if the
// wrapper scripts drift, this spec catches it.

const pExecFile = promisify(execFile);

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BACKUPS_DIR = path.join(REPO_ROOT, "backups");

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const runBackupDump = async (): Promise<string> => {
  // Runs the script via pnpm so the package.json wiring is on
  // the hook. The backup file path is derivable from the
  // timestamp, but parsing the script's stdout is more robust.
  const { stdout } = await pExecFile(
    "pnpm",
    ["backup:dump"],
    { cwd: REPO_ROOT, timeout: 60_000 },
  );
  const match = stdout.match(/writing\s+(\S+\.sql\.gz)/);
  if (!match) throw new Error(`no backup path in stdout:\n${stdout}`);
  return match[1];
};

const runBackupRestore = async (file: string): Promise<void> => {
  await pExecFile(
    "pnpm",
    ["backup:restore", file],
    { cwd: REPO_ROOT, timeout: 60_000 },
  );
};

// Clean up test-created backups so the local backups/ dir
// doesn't accumulate across spec runs.
const cleanupBackupsBefore = (ts: number) => {
  if (!statSync(BACKUPS_DIR, { throwIfNoEntry: false })) return;
  for (const name of readdirSync(BACKUPS_DIR)) {
    if (!name.startsWith("conduit-") || !name.endsWith(".sql.gz")) continue;
    const full = path.join(BACKUPS_DIR, name);
    const s = statSync(full);
    if (s.mtimeMs >= ts) {
      try {
        unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  }
};

test.describe("issue #157 — pg_dump/restore round-trip", () => {
  test("Scenario 1: dump + restore round-trip preserves seeded articles", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const createdAfter = Date.now();

    // Seed three articles authored by a deterministic user so
    // we can verify post-restore row counts + content.
    const id = uniq();
    const jake = `br-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    await api.createArticle({ title: `br-1-${id}` });
    await api.createArticle({ title: `br-2-${id}` });
    await api.createArticle({ title: `br-3-${id}` });

    // Dump the current DB state.
    const backupFile = await runBackupDump();
    expect(backupFile).toMatch(/\.sql\.gz$/);

    // Verify pre-restore: all 3 articles present via the API.
    const ctx = await browser.newContext();
    const preRes = await ctx.request.get(
      `${API_URL}/api/articles?author=${jake}&limit=10`,
    );
    const pre = (await preRes.json()) as { articles: { slug: string }[] };
    expect(pre.articles.length).toBe(3);

    // Wipe — delete the third article via the API so the DB
    // state diverges from the backup.
    await api.api.delete(`/api/articles/${pre.articles[2]!.slug}`);
    const midRes = await ctx.request.get(
      `${API_URL}/api/articles?author=${jake}&limit=10`,
    );
    expect(
      ((await midRes.json()) as { articles: unknown[] }).articles.length,
    ).toBe(2);

    // Restore — should bring the third article back.
    await runBackupRestore(backupFile);

    // Post-restore: all 3 articles back.
    const postRes = await ctx.request.get(
      `${API_URL}/api/articles?author=${jake}&limit=10`,
    );
    const post = (await postRes.json()) as { articles: { slug: string }[] };
    expect(post.articles.length).toBe(3);
    // Slugs match what was originally seeded.
    const preSlugs = new Set(pre.articles.map((a) => a.slug));
    const postSlugs = new Set(post.articles.map((a) => a.slug));
    expect(postSlugs).toEqual(preSlugs);

    await ctx.close();
    cleanupBackupsBefore(createdAfter);
  });

  test("Scenario 2: backup file is a valid gzipped archive", async () => {
    test.setTimeout(60_000);
    const createdAfter = Date.now();
    const file = await runBackupDump();

    // `file` command would be ideal but may not be available;
    // use gunzip --test which returns 0 for a valid gzip.
    await pExecFile("gunzip", ["--test", file], { timeout: 10_000 });

    cleanupBackupsBefore(createdAfter);
  });

  test("Scenario 3: committed fixture restores cleanly", async () => {
    test.setTimeout(90_000);
    const fixture = path.join(BACKUPS_DIR, "fixtures", "sample.sql.gz");
    // Fixture must exist; if it doesn't, the CI round-trip workflow
    // wouldn't have anything to restore either.
    expect(statSync(fixture).size).toBeGreaterThan(0);

    // Restore the fixture. We don't know what exact content is in
    // it (it's a previous run's dump), so we just verify the
    // restore exits 0 and the DB is queryable after.
    await runBackupRestore(fixture);

    const ctx = await request.newContext();
    const res = await ctx.get(`${API_URL}/api/articles?limit=1`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { articlesCount: number };
    // Fixture was seeded with 5 articles; after drop-and-restore
    // the count should be exactly 5 (the restore replaces rather
    // than merges).
    expect(body.articlesCount).toBe(5);
  });
});

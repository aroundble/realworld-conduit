import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, request, test } from "@playwright/test";

// Deferred-from-#25 scenario 3b: assert /healthz returns 503 when the
// database is unreachable. We can't pause postgres in the main
// `conduit` compose project without starving every other spec, so
// this spec spins up its *own* side-stack with a distinct project
// name + distinct host ports, pauses / unpauses postgres there, and
// tears the stack down when done.

const PROJECT =
  process.env.CONDUIT_HEALTHZ_TEST_PROJECT ?? "conduit-healthz-test";
const API_HOST_PORT =
  process.env.CONDUIT_HEALTHZ_TEST_API_PORT ?? "3121";
const WEB_HOST_PORT =
  process.env.CONDUIT_HEALTHZ_TEST_WEB_PORT ?? "3120";
const POSTGRES_HOST_PORT =
  process.env.CONDUIT_HEALTHZ_TEST_POSTGRES_PORT ?? "5454";

const COMPOSE_FILE = "infra/docker-compose.yml";

let envFilePath = "";
let apiContainerName = "";
let pgContainerName = "";

// All shell-outs go through execFileSync with explicit arg arrays —
// no string interpolation into a shell, so there's no injection
// surface even though every value here is hard-coded or env-derived.
const run = (
  bin: string,
  args: string[],
  opts: { stdio?: "pipe" | "inherit" } = {},
): string => {
  const out = execFileSync(bin, args, {
    stdio: opts.stdio === "inherit" ? "inherit" : "pipe",
    timeout: 5 * 60 * 1000,
  });
  return opts.stdio === "inherit" ? "" : out.toString();
};

const compose = (args: string[], opts: { stdio?: "pipe" | "inherit" } = {}) =>
  run(
    "docker",
    [
      "compose",
      "-p",
      PROJECT,
      "-f",
      COMPOSE_FILE,
      "--env-file",
      envFilePath,
      ...args,
    ],
    opts,
  );

// Compose-derived container name, for pause / unpause / logs. We
// query `compose ps -q` + `docker inspect` so the spec keeps working
// if the compose naming convention ever changes.
const resolveContainer = (service: string): string => {
  const ids = compose(["ps", "-q", service]).trim();
  if (!ids) throw new Error(`compose ps returned no container for ${service}`);
  const id = ids.split("\n")[0];
  return run("docker", ["inspect", "--format", "{{.Name}}", id])
    .trim()
    .replace(/^\//, "");
};

const waitHealthy = async (container: string, tries = 60): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    try {
      const state = run("docker", [
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        container,
      ]).trim();
      if (state === "healthy") return true;
    } catch {
      // container may not exist yet on the first few tries.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

test.describe.serial("issue #49 — /healthz 503 side-stack spec", () => {
  test.beforeAll(async () => {
    // Throwaway .env with non-colliding ports + a random password so
    // the side-stack can't be reused across runs.
    const dir = mkdtempSync(join(tmpdir(), "conduit-healthz-test-"));
    envFilePath = join(dir, ".env");
    const pw = `p${Date.now()}`;
    writeFileSync(
      envFilePath,
      [
        "NODE_ENV=development",
        "LOG_LEVEL=warn",
        "POSTGRES_USER=conduit",
        `POSTGRES_PASSWORD=${pw}`,
        "POSTGRES_DB=conduit",
        `POSTGRES_HOST_PORT=${POSTGRES_HOST_PORT}`,
        "API_PORT=3001",
        `API_HOST_PORT=${API_HOST_PORT}`,
        "API_URL_INTERNAL=http://api:3001",
        "WEB_PORT=3000",
        `WEB_HOST_PORT=${WEB_HOST_PORT}`,
        `WEB_URL=http://localhost:${WEB_HOST_PORT}`,
        `NEXT_PUBLIC_API_URL=http://localhost:${API_HOST_PORT}`,
        `JWT_SECRET=${pw}${pw}`,
        "JWT_TTL_SECONDS=604800",
        "COOKIE_DOMAIN=localhost",
        "COOKIE_SECURE=false",
      ].join("\n") + "\n",
    );

    // `compose up -d --build` occasionally fails with a transient
    // non-zero exit on a cold docker image cache (#106). Retry up to
    // 3 times with 1s backoff before letting the test fail — the
    // command is idempotent, so retrying after a partial start is
    // safe.
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        compose(["up", "-d", "--build"], { stdio: "inherit" });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    if (lastErr) throw lastErr;

    apiContainerName = resolveContainer("api");
    pgContainerName = resolveContainer("postgres");
    const apiUp = await waitHealthy(apiContainerName);
    if (!apiUp) {
      throw new Error(
        `side-stack api never became healthy (container=${apiContainerName})`,
      );
    }
  });

  test.afterAll(async () => {
    // Always run a clean teardown — `down -v` drops the project's
    // containers + networks + volumes so the next run starts clean
    // and `docker ps -a --filter name=...` returns empty (AC 2).
    if (pgContainerName) {
      try {
        run("docker", ["unpause", pgContainerName]);
      } catch {
        // container may already be unpaused / gone — ignore.
      }
    }
    const res = spawnSync(
      "docker",
      [
        "compose",
        "-p",
        PROJECT,
        "-f",
        COMPOSE_FILE,
        "--env-file",
        envFilePath,
        "down",
        "-v",
      ],
      { stdio: "inherit", timeout: 60_000 },
    );
    if (res.status !== 0) {
      throw new Error(`side-stack down returned ${res.status}`);
    }
    if (envFilePath) {
      rmSync(envFilePath, { force: true });
    }

    const remaining = run("docker", [
      "ps",
      "-a",
      "--filter",
      `name=${PROJECT}`,
      "--format",
      "{{.Names}}",
    ]).trim();
    expect(remaining, "side-stack teardown should leave no containers").toBe(
      "",
    );
  });

  test("Scenario 1: /healthz returns 503 when postgres is paused", async () => {
    const api = await request.newContext({
      baseURL: `http://localhost:${API_HOST_PORT}`,
    });

    // Baseline: before pausing, /healthz should return 200 (confirms
    // the side-stack is up and the probe path works).
    const before = await api.get("/healthz");
    expect(before.status()).toBe(200);

    run("docker", ["pause", pgContainerName]);

    try {
      // Probe may take up to `HEALTHCHECK_DB_TIMEOUT_MS` (2s default)
      // to time out; single request is enough since the code path is
      // deterministic once paused.
      const res = await api.get("/healthz", { timeout: 5000 });
      expect(res.status()).toBe(503);
      const body = (await res.json()) as {
        ok: boolean;
        checks: { db: string };
      };
      expect(body.ok).toBe(false);
      expect(body.checks.db).toBe("fail");
    } finally {
      run("docker", ["unpause", pgContainerName]);
      const ok = await waitHealthy(pgContainerName, 20);
      expect(ok, "postgres should unpause cleanly").toBe(true);
    }
  });
});

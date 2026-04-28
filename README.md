# realworld-conduit

RealWorld spec implementation — githarness pilot #3.

Benchmark-oriented project: gap-analysis against top OSS RealWorld implementations measurable via Lighthouse, E2E pass rate, a11y, and code quality.

Spec: https://realworld-docs.netlify.app/

## Quick start

```bash
pnpm install
bash scripts/dev-bootstrap.sh                                  # writes .env at repo root
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
bash scripts/smoke.sh                                          # verifies web + api + postgres
```

Web: <http://localhost:3000> · API healthz: <http://localhost:3001/healthz>.

The `--env-file .env` flag is required. Compose auto-loads `.env` relative to the compose file's directory (`infra/`), not the repo root where `scripts/dev-bootstrap.sh` writes it. The compose file declares required secrets as `${VAR:?…}` so an invocation without `--env-file .env` fails loudly instead of booting with empty passwords.

Tear down: `docker compose -f infra/docker-compose.yml --env-file .env down -v`.

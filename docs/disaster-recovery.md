# Disaster recovery (#157)

## Promise

- **RPO** (recovery point objective): 24 hours. Daily `pg_dump` retained 7 days.
- **RTO** (recovery time objective): under 10 minutes for a 100K-article DB on the compose stack. Restore is a single `pnpm backup:restore <file>`.

Production deploys should tighten both via WAL archival (point-in-time recovery) and an encrypted remote store — see §"Production" below.

## Taking a backup

```sh
pnpm backup:dump
# → backups/conduit-<YYYYMMDDTHHMMSSZ>.sql.gz
```

- Format: Postgres custom (`-Fc`), gzipped. ~3x smaller than plain SQL; only `pg_restore` can read it.
- Owner-less + ACL-less — the restored DB adopts the target user, so a backup taken as `conduit@local` restores fine into `conduit@prod`.
- The script pipes dump → gzip → disk in a single chain; the uncompressed dump is never materialized.

### Before a risky migration

If you're about to run a schema migration that might be destructive (DROP COLUMN, DROP TABLE, a rename that could lose data), take an ad-hoc backup first:

```sh
pnpm backup:dump
# then run the migration
```

If it goes sideways, restore:

```sh
pnpm backup:restore backups/conduit-<timestamp>.sql.gz
# api pool reconnects on the next request; may 503 once while Prisma retries
```

## Restoring

```sh
pnpm backup:restore backups/conduit-<timestamp>.sql.gz
```

**This is destructive.** The target DB is DROPPED + RECREATED; existing data is replaced, not merged. Sequence:

1. Terminate active connections against the target DB (Prisma pool drops; api container reconnects on next request).
2. Drop the target DB via `psql` against the `postgres` maintenance DB.
3. Create a fresh empty DB.
4. Stream `gunzip -c <file>` into `pg_restore` with `--exit-on-error` so a corrupt dump fails loudly.

On a local compose stack the whole sequence takes ~5-10 seconds for a small fixture, ~30-60 seconds for a 100K-article DB.

## Restoring into a fresh stack (forensic / staging)

Sometimes you don't want to restore over the live stack — you want to investigate yesterday's data without disturbing today's. Spin up a second compose project:

```sh
# bring up a named, isolated compose project
COMPOSE_PROJECT=conduit-forensic \
  docker compose -f infra/docker-compose.yml -p conduit-forensic \
  --env-file .env up -d --build

# restore yesterday's dump into it
COMPOSE_PROJECT=conduit-forensic \
  pnpm backup:restore backups/conduit-<timestamp>.sql.gz

# query the forensic stack on its own ports (mapped differently in .env.forensic if needed)
```

The project-name flag keeps the two stacks completely isolated — separate networks, volumes, containers.

## Migration rollback procedure

If a deployed migration breaks production:

1. **Stop writes.** Disable the ingress / put the api in maintenance mode (future: a feature flag; for now, scale the api service to 0).
2. **Dump the current broken state** (useful for forensics):
   ```sh
   pnpm backup:dump
   mv backups/conduit-<fresh>.sql.gz backups/broken-pre-rollback.sql.gz
   ```
3. **Restore the last good backup**:
   ```sh
   pnpm backup:restore backups/conduit-<before-migration>.sql.gz
   ```
4. **Revert the code** that shipped the bad migration (git revert the commit, redeploy).
5. **Bring the api back up** and smoke-test (`pnpm smoke`).
6. **Post-mortem** — what made the migration destructive, how to catch it in CI next time (property-based migration tests? shadow-environment replay?).

## CI round-trip check

`.github/workflows/backup-restore-check.yml` runs on every push to `latest`:

1. Spin up a fresh compose stack.
2. Seed fixtures via API (5 articles by 5 users).
3. `pnpm backup:dump` — produce a fresh backup.
4. Tear down the stack + volume.
5. Spin up a second fresh stack.
6. `pnpm backup:restore` the backup from step 3.
7. Assert the article count + content matches the seed.

The round-trip guarantees that a backup taken on the current `latest` tip can actually be restored — catches schema drift, missing table references, extension dependencies.

## Backup retention

Local dev: manual. Clean old backups via `find backups -name "conduit-*.sql.gz" -mtime +7 -delete` — no automation yet.

Production: set up a cron that calls `pnpm backup:dump` nightly and a second cron that prunes anything older than `BACKUP_RETENTION_DAYS` (default 7). A Level-3 follow-up wires this to encrypted remote storage.

## Production

**Backup encryption at rest is NOT handled here.** The `backups/` directory is unencrypted by default — fine for a dev compose stack, UNSAFE for production data. Production deploys MUST pipe backups into an encrypted store:

- AWS: S3 with SSE-KMS.
- GCP: GCS with CMEK.
- Self-hosted: `gpg --symmetric` before upload.

A Level-3 follow-up (`feat/infra-remote-encrypted-backup`) wraps `backup-dump.sh` with an upload step. Until that lands, treat the local backup as transient — take it, restore from it immediately, delete the file.

**Point-in-time recovery (PITR)** is not handled. PITR requires WAL archival (continuous log streaming to an off-host store) and pg_restore with a recovery target. Out of scope for this issue; file a dedicated Level-3 issue if your RPO requirement drops below 24 hours.

## Verification

```sh
# Round-trip smoke on a running stack:
pnpm backup:dump
pnpm backup:restore backups/conduit-<newest>.sql.gz
# assert the article count matches what you had before
```

The Playwright spec `tests/e2e/specs/157-infra-backup-restore.spec.ts` automates this.

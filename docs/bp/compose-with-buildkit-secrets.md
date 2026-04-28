# BP — docker compose with BuildKit secrets

**Catalog ref**: docs/14-bp-catalog.md §9.
**Level**: mandatory.

## Why

`ARG TOKEN=...` in a Dockerfile ends up in the image layer metadata
(`docker history`). Even if the build succeeds, the token is
forever readable by anyone who pulls that image. This has been a
real CVE pattern in production projects.

BuildKit secret mounts make the token available only during a
single `RUN`, never written to the layer.

## Rule

For any build-time secret (package registry tokens, validator tokens,
CI-fetched credentials):

1. Dockerfile declares the mount, not an `ARG`.
2. docker-compose passes the secret at build time.
3. `.env` holds the value for local builds. CI/deploy uses the
   vault (Secrets Manager et al.).

## Pattern

```dockerfile
# syntax=docker/dockerfile:1.4
# note the syntax directive — required for BuildKit secrets.

FROM base:...

RUN --mount=type=secret,id=registry_token \
    TOKEN=$(cat /run/secrets/registry_token) && \
    some-install-tool configure --token "$TOKEN" && \
    unset TOKEN
```

```yaml
# docker-compose.yml
services:
  api:
    build:
      context: ./services/api
      secrets:
        - registry_token
    # no `args:` block with REGISTRY_TOKEN
secrets:
  registry_token:
    environment: REGISTRY_TOKEN
```

`REGISTRY_TOKEN` resolves from `.env` locally, from the runtime
environment in CI.

## Verification

After build:

```
docker history <image> | grep -i token
# should return nothing
```

If anything appears, the build is using `ARG` somewhere and needs
conversion.

## When `ARG` is acceptable

Only for non-secret build-time parameters (node version, feature
toggles, architecture). Treat any string entering the build context
that you wouldn't want printed in a public log as a secret.

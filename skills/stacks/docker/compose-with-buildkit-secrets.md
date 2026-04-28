---
name: compose-with-buildkit-secrets
origin: githarness (distilled from Heimdal)
---

Never `ARG TOKEN=...` in a Dockerfile. Use BuildKit
`--mount=type=secret` so the token does not land in the image's
layer history. Rule: `docs/bp/compose-with-buildkit-secrets.md`.

## Dockerfile template

```dockerfile
# syntax=docker/dockerfile:1.4

FROM <base>

RUN --mount=type=secret,id=<secret-id> \
    TOKEN=$(cat /run/secrets/<secret-id>) && \
    your-install-tool --token "$TOKEN" && \
    unset TOKEN
```

## docker-compose.yml template

```yaml
services:
  some-service:
    build:
      context: ./some-service
      secrets:
        - <secret-id>

secrets:
  <secret-id>:
    environment: SOME_TOKEN
```

`.env` carries `SOME_TOKEN=...` locally; CI resolves it from the
vault.

## Verification

```bash
DOCKER_BUILDKIT=1 docker compose build some-service
docker history <image> | grep -i <secret-id>
# must be empty (or only the literal 'secret-id' string, not the value)
```

## Anti-pattern

```dockerfile
# never do this — token goes into docker history
ARG TOKEN
RUN install --token $TOKEN
```

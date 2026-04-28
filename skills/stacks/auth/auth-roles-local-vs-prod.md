---
name: auth-roles-local-vs-prod
origin: githarness (distilled from Heimdal)
---

Local dev uses a hardcoded role switch (`admin` / `developer` /
`user`), dev/staging/prod use the real IdP. See
`docs/bp/auth-roles-local-vs-prod.md` for the full rule.

## When to apply

- Any project with a user-facing UI that has roles.
- Any project with permission-scoped APIs.
- Any E2E suite that has to hit each role's path.

## How it looks

`.env.example` snippet:

```
AUTH_MODE=dev            # dev | sdk | managed
DEV_USERS=admin,developer,user
```

Bootstrap (Node / TypeScript):

```ts
const mode = process.env.AUTH_MODE ?? 'dev';
if (mode === 'dev' && process.env.NODE_ENV === 'production') {
  throw new Error('AUTH_MODE=dev not permitted in production');
}
```

Bootstrap (Python):

```python
mode = os.environ.get("AUTH_MODE", "dev")
if mode == "dev" and os.environ.get("ENVIRONMENT") != "local":
  raise RuntimeError("AUTH_MODE=dev not permitted outside local")
```

CI gate:

```yaml
- name: fail if DEV_USERS leaks into dev/prod config
  run: |
    if grep -R "DEV_USERS" infra/config/ | grep -v local.yaml; then
      echo "DEV_USERS must only appear in local config"
      exit 1
    fi
```

## Agent responsibility

- Generator: if an issue touches auth, open one PR per side (local
  switch, real IdP) — never mix.
- Evaluator: reject any PR that removes the "no DEV_USERS outside
  local" guard.

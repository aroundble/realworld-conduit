# Stack — Auth

Enable this stack for projects that need role-switchable auth
between local development and managed identity providers
(Cognito, Auth0, Keycloak, Okta).

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [auth-roles-local-vs-prod.md](auth-roles-local-vs-prod.md) | generator, evaluator | Mode switch between local dev (hardcoded test users, role switcher UI) and managed IdP (real Cognito / Auth0 / Okta). Never deploy dev mode to shared environments. |

## MCP server wired by this stack

None currently. Auth flows are implementation-level; an MCP
wrapper is not necessary for routine use.

## When to enable

Enable this stack if the project:

- Has any distinction between "dev auth" and "real auth" modes.
- Uses a managed IdP in production.
- Has role-based UI (admin / developer / user) that needs to
  be switchable locally.

## Related

- [`skills/for-generator/sdk-first-implementation.md`](../../for-generator/sdk-first-implementation.md)
  — use the IdP's official SDK rather than hand-rolling JWT
  verification.
- [`skills/for-generator/portable-environment-values.md`](../../for-generator/portable-environment-values.md)
  — auth configuration lives in env / config, not in code.

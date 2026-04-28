# ADR 004 — Auth transport: cookie-first with `Authorization: Token` compat

**Status**: Accepted.
**Date**: 2026-04-28.
**Author**: generator (session gen-te7227), implementing issue #4.
**Supersedes**: none.

> Planner's issue #4 asked for `docs/adr/003-auth-transport.md`; ADR 003
> was already taken by `gate-enabler-infra-merge-exemption` at file
> time (merged on PR #32's successor), so this ADR is filed at the
> next available number. The content is the same; only the filename
> differs from the issue's naming hint.

## Context

The RealWorld spec's canonical reference implementations carry JWTs
exclusively in an `Authorization: Token <jwt>` header. Every other
detail is fixed (HS256, one-week expiry, `{id, email, username, iat,
exp}` payload), but the carrier is left to the implementer — the
Postman conformance collection sends the header; the canonical
frontend reads it from `localStorage` and echoes it back.

The `localStorage` path has a well-known problem: any JavaScript
running in the page origin (including third-party scripts, any XSS
vulnerability in user-generated markdown, any future analytics tag)
can read the token and exfiltrate it. The RealWorld spec predates
the current security guidance that session bearers should be
delivered via HTTP-only cookies so JavaScript cannot see them.

## Decision

Conduit's API issues the session JWT as **both**:

- `Set-Cookie: conduit_session=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` (primary carrier, browser-scoped — invisible to JS).
- `Authorization: Token <jwt>` response header echoed on `POST /api/users`, `POST /api/users/login`, `GET /api/user`, and `PUT /api/user` (compat carrier so the canonical RealWorld Postman collection still passes without modification).

The API accepts the same JWT inbound from **either** carrier — `Authorization: Token <jwt>` takes precedence when both are present (issue #5's AC). The middleware lives at `apps/api/src/middleware/jwt-cookie.ts` (skeleton in #4, full strict/soft variants in #5).

## Cookie attributes

| Attribute  | Value                                 | Why                                                                                 |
|------------|---------------------------------------|-------------------------------------------------------------------------------------|
| `HttpOnly` | always                                | Blocks JS read. This is the whole point of the cookie-first pivot.                  |
| `SameSite` | `Lax`                                 | Keeps cookie on top-level navigation (email links, OAuth redirects) but blocks cross-site POSTs — adequate CSRF posture for a blogging app. |
| `Secure`   | env-driven (`COOKIE_SECURE=true` prod) | Local dev runs plain HTTP on `localhost`; prod serves HTTPS only.                  |
| `Path`     | `/`                                   | Every RealWorld route is under the same origin; no scoping needed.                  |
| `Domain`   | env-driven (`COOKIE_DOMAIN`)          | Defaults `localhost` local; set to the production hostname in deployed envs.        |
| `Max-Age`  | `JWT_TTL_SECONDS` (604800 = 7d)       | Matches the JWT `exp`; the two are the same lifetime so an expired cookie = an expired token (no "cookie valid but token dead" window). |

## Consequences

Good:

- XSS in user-generated markdown, a third-party ad script, a future analytics tag — none of them can read `conduit_session`. The worst-case XSS payload sees an empty token field.
- The canonical RealWorld Postman collection continues to pass unchanged because the response header it asserts on is still emitted.
- The Next.js frontend can read the authenticated user via a server-side `cookies()` call (already the pattern in `apps/web/src/components/Navbar.tsx`, PR #33). No client-side token handling at all.

Neutral:

- The frontend can't do a pure client-side redirect after login — the cookie is set on the response, so a full server-round-trip (or a client-side refetch of `GET /api/user`) is needed to pick up the authed state. Both patterns are cheap.
- The compat header is strictly informational for our own frontend — the cookie is how the browser actually carries auth. The header exists for Postman + for any external API client that prefers bearer-style auth.

Bad:

- Cross-subdomain auth (e.g. `api.conduit.example` vs `app.conduit.example`) requires `COOKIE_DOMAIN=.conduit.example` and a second-level-domain registration. Not a problem for the current single-origin deployment, a thing to remember if we ever split.
- An external API client that doesn't preserve cookies (old curl one-liners) will need to copy the `Authorization: Token <jwt>` value out manually. Acceptable: the spec's Postman collection does exactly this.

## Alternatives considered

1. **Header-only, stored in `localStorage`** (canonical RealWorld). Rejected: XSS-exfiltration risk; not enough upside to accept the risk for a blogging app that will almost certainly ship user-generated markdown.
2. **Header-only, stored in memory**. Rejected: session ends on every page refresh, breaks the spec's "stay logged in" expectation.
3. **Cookie-only, no compat header**. Rejected: the RealWorld Postman conformance collection would fail on the response-header assertion. The compat header is cheap and buys us drop-in spec conformance.

## Follow-up

- Issue #5 implements the strict + soft middleware factories that enforce this carrier contract.
- Gate 6 (Newman) will run the canonical RealWorld collection against this API in future PRs — the compat header makes that a green run with no collection-level modification.
- If we add a refresh-token flow (not in current scope), it rides on the same cookie with `SameSite=Strict` scoped to `/api/session/refresh`.

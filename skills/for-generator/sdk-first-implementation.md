---
name: sdk-first-implementation
description: Use when integrating with an external service (AWS, Stripe, Anthropic, Postgres, etc.). Forbids hand-rolled HTTP clients, signing, retry, pagination when an official SDK exists; requires an ADR for documented exceptions.
---

# Skill — SDK-first implementation

**For**: generator (primary), planner (names in issue body).
**Applies when**: the project integrates with an external service
or platform.

## The principle

**When integrating with an external service, use that service's
official SDK by default. Do not hand-roll HTTP clients, signing
logic, retry policies, or auth flows when an SDK already
provides them.**

SDKs encode non-obvious correctness: signing headers, timeout
defaults, retry backoff, idempotency keys, pagination, regional
endpoint selection, credential refresh, observability hooks,
backward compatibility. Hand-rolled equivalents get 80% of it
right and fail in production on the other 20%.

## What "SDK-first" means in practice

- **Use the official SDK** from the service provider or a
  well-maintained language-native wrapper. For AWS, the AWS SDK
  (boto3 / aws-sdk-v3 / aws-sdk-go-v2). For Stripe,
  stripe-python / stripe-node. For Anthropic, the anthropic
  package. For Postgres, the language's standard adapter
  (asyncpg / pg / sqlx) — not a hand-rolled wire-protocol client.
- **Do not wrap the SDK in a thin home-grown layer unless
  required.** Wrappers hide SDK features (idempotency keys,
  waiters, paginators) that become load-bearing later.
- **If the SDK doesn't cover a case**, document which case and
  why in the file's header or an ADR — and contribute the fix
  upstream if the project's license allows it.

## What this rules out

- `requests.post("https://s3.amazonaws.com/...", headers={
  "Authorization": sign_v4(...)})` — re-implementing SigV4 signing
  when boto3 does it.
- `fetch('https://api.stripe.com/...')` with a hand-rolled
  idempotency key scheme when stripe-node provides one.
- Writing a JWT verifier from scratch when the platform provides
  a JWKS-aware client (e.g. `jose`, `PyJWT`, AWS Cognito ID SDK).
- Implementing retry / backoff / circuit-breaker logic in
  application code when the SDK exposes knobs for it.

## Exceptions (document in an ADR)

- The SDK is abandoned, unmaintained, or has a critical bug.
- The SDK is too heavy for the runtime environment (e.g. a Lambda
  function where SDK init time matters).
- The SDK conflicts with the project's license constraints.
- The project has a specific observability or policy layer that
  requires a seam the SDK does not offer.

In all cases: name the SDK, name the gap, write the ADR, then
do the hand-roll with the scope narrowed to the gap.

## Planner's role

When shaping an issue that involves an external service, the
planner names the SDK in the issue body. If the OSS scout
(Branch 2) identifies both an SDK and a third-party wrapper, the
planner's ADR picks between them with a reason — typically "SDK
unless the wrapper solves a concrete gap".

## Evaluator's role

PR review: flag any hand-rolled HTTP client to a service with a
known SDK as a `🟡 non-blocking note` on a first offense and a
`🔴 BLOCK` on repeat. Ask for the ADR.

## Related skills

- `skills/for-evaluator/immutable-infrastructure.md` — related in spirit;
  "use the platform's primitives, don't reinvent them".
- `skills/stacks/auth/auth-roles-local-vs-prod.md` — a specific case of
  "use the platform's auth flow, don't hand-roll tokens".

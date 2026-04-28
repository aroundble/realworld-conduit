# vibe-studio vision — 2026-04-27 reset

> Canonical vision handed to the planner at init Phase 1. Superseded
> every earlier vibe-studio note. Daisy wrote it on 2026-04-27 right
> before the v0.2.10 wipe + re-init.

## Product

A user portal + chatbot that, for each non-technical end user, builds
and deploys a **personal web app on demand** — the way `githarness`
builds a three-agent harness for a developer. The end user never sees
git, never writes code, never touches infra. They talk to the chatbot,
describe what they want, and the portal:

1. Runs a githarness-style pipeline against our own repo (planner +
   generator + evaluator) for that user's app.
2. Deploys the resulting app to our dev environment.
3. Hands the user a working URL + login; the app is live and usable
   immediately.
4. Keeps the loop open — the user's subsequent feedback (via the same
   chatbot) is turned into new issues / PRs for *their* app, and the
   planner/generator/evaluator cycle re-runs. Continuous integration
   happens for each user-owned app, on that user's personal branch /
   subdomain / tenant.

The vibe-studio itself is the meta-app: one portal, many tenants, each
tenant is a user whose app is under continuous githarness-driven
development.

## Who this is for

- Non-developers who want a working tool, not a template or a
  codegen toy.
- Small operators who need a bespoke internal tool (quote tracker,
  lead sheet, event RSVP, household roster) and don't want to hire
  a dev.
- Power users who have a repeat workflow and want it automated.

They do not know what a branch is. They expect a URL, a login, and a
working feature they can keep iterating on.

## North-star flow (the "first 5 minutes" demo)

1. User visits the portal, signs in (email + passwordless OTP).
2. Chatbot asks: "What do you want to build?"
3. User: "A guest list for my wedding — names, +1s, meal choice, who
   confirmed."
4. Portal responds within ~3 min with a live URL. The user clicks it,
   logs in with the same portal credential (SSO), sees a working guest
   list CRUD screen on their own subdomain / path.
5. Chatbot: "Try it. What's off?"
6. User: "Add a column for dietary notes and email the list to me as
   CSV."
7. Portal hands back the updated URL ~1 min later. The user reloads —
   new column is there, an "Email me CSV" button works.
8. The loop repeats until the user says "done" (or abandons; either is
   fine).

Under the hood:

- Each user gets a **tenant branch** (`tenant/<user-id>/main`) in the
  vibe-studio repo.
- Each chatbot request becomes a **GitHub issue** on that tenant's
  branch, claim-labelled to generator after contract negotiation.
- Generator implements → evaluator reviews + deploys to the tenant's
  subdomain → user sees the change.
- The feedback the user types is just another issue.

## Hard constraints

- **Deploy target**: AWS (same as every other githarness project). No
  Cloudflare / Vercel / GCP / Azure. Lowest-cost pay-per-use for a
  default tenant (S3 + Lambda + CloudFront for the marketing portal;
  APIGW + Lambda + DynamoDB for per-tenant apps).
- **Security default-deny**: tenant apps are NEVER publicly
  browseable without auth. CloudFront + WAF IPSet scoping during
  dev; Cognito-gated in stg. No S3 public read, no Lambda
  function-URL `NONE`.
- **Per-tenant isolation**: one bad tenant's app cannot see another
  tenant's data. DynamoDB partition key = `tenant_id`; IAM roles
  per tenant; separate subdomain per tenant
  (`<slug>.dev.vibestudio.example`).
- **No credential prompts to the user**: the user authenticates once
  to the portal. The portal holds their app's credentials (scoped
  tokens) and injects them into the deployed app as runtime config.
- **Deterministic from prompt**: given the chat transcript + repo SHA
  + tenant id, the same app comes out. No hidden state. This is
  critical for replay + rollback.

## What the first sprint should produce

(Planner: this is the walking-skeleton contract with generator.)

- A two-page portal (landing + chat) at `dev.vibestudio.example`.
- Sign-in via email OTP (Cognito Hosted UI is fine).
- Chat screen that posts the user's request to a Lambda.
- The Lambda files a GitHub issue on the vibe-studio repo, tagged
  `tenant:<user-id>` + `claim:generator-proposal`.
- The issue body is a copy of the user's natural-language request.
- A reply webhook (same Lambda, different route) posts chatbot
  replies back into the chat UI when the generator/evaluator cycle
  emits a status update (PR opened, PR merged, deploy done).

That skeleton is a full harness-in-a-harness loop, scoped to one
tenant, one prompt, one URL. Everything else (CRUD scaffolding,
per-user subdomains, SSO to tenant apps, CSV export, etc.) is later
sprints.

## What this is NOT

- Not a public template marketplace. The user does not browse prebuilt
  apps and clone one; they describe what they need and the harness
  builds it.
- Not a code-generation toy that outputs a zip. The output is a
  deployed URL on our infra.
- Not self-hosted. We operate the infra; the tenant doesn't see AWS.
- Not a replacement for bespoke development at scale. It is for
  single-user / small-team apps that would otherwise be a Google
  Sheet + a weekend.

## Success signal for the operator (Daisy)

- A stranger (not Daisy, not anyone who knows git) can sign in, type
  a sentence, wait 3 min, and use their own app — **without any
  tmux attach, without any GitHub glance, without any AWS console
  touch on Daisy's part**. The harness does it end-to-end.
- When the stranger says "add a column", the same is true for the
  follow-up.
- Daisy's only intervention is reading the planner pane in the
  morning and nudging priorities.

This is the single metric the planner must keep in mind. Every
sprint's walking skeleton is judged by "does it move the stranger
closer to the 3-minute first-run?"

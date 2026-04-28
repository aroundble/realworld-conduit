---
name: aws-cdk-security-defaults
description: Mandatory default-deny security posture for every AWS CDK stack in a githarness-managed project. Load when authoring CDK (generator) or reviewing CDK PRs (evaluator). Covers S3 BlockPublicAccess ALL, Lambda function URL auth, API Gateway WAF/SG gating, VPC endpoint preference, IAM least-privilege, KMS CMK defaults. No resource ships public without an explicit operator-approved justification; justifications live in config, not in code.
---

# Skill — AWS CDK security defaults

**For**: generator (authoring CDK) and evaluator (reviewing /
deploying CDK).
**Applies to**: every CDK construct and L2 in a `githarness init
--stacks aws-cdk` project.

Load this skill **before** touching any `lib/*-stack.ts`,
`bin/*.ts`, or `infra/` file. These defaults are non-negotiable
and take precedence over cost, convenience, or velocity
arguments.

---

## The principle

**Default-deny. Every resource ships with the most-restrictive
setting that still satisfies the issue's acceptance criteria.
Public access is an opt-in, never an opt-out.**

If the minimum safe setting makes the feature harder to build,
**the feature scope gets smaller** — not the security posture.

---

## S3 — never public

- `Bucket` construct: **always** set
  ```ts
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
  ```
  This is stricter than `BLOCK_ACLS` or the AWS default. Use
  `BLOCK_ALL` unconditionally — no exceptions in dev / stg / prd.
- `publicReadAccess: true` is **forbidden**. A public-read
  bucket does not survive PR review.
- "CloudFront serves the site" ≠ "bucket can be public".
  Instead: `CloudFrontOriginAccessControl` (OAC, L2 available in
  CDK ≥ 2.137) with a restrictive bucket policy that **only**
  the specific CloudFront distribution can `s3:GetObject` the
  intended prefix. OAC replaces legacy OAI; do not use OAI on
  new stacks.
- S3 Object Ownership must be `BUCKET_OWNER_ENFORCED` (disables
  ACLs entirely). ACL-based permissioning is deprecated.
- Server-side encryption: `BucketEncryption.S3_MANAGED` at
  minimum; prefer `KMS` with a project-owned CMK for anything
  holding user data.

---

## Lambda — no public invocation surface

- `FunctionUrl` is allowed **only** with
  `authType: FunctionUrlAuthType.AWS_IAM`. `NONE` is forbidden
  in every environment.
- Lambda is ALWAYS fronted by one of:
  - API Gateway (HTTP API or REST) + WAF, **or**
  - ALB / NLB with SG restricted per §SG below, **or**
  - EventBridge / SQS / S3 / DynamoDB Streams (event-source).
- Lambda's own **resource policy** is set by the fronting
  construct (API GW / ALB / event source). Never add
  `addPermission(..., { principal: new AnyPrincipal() })`.
- Environment variables holding secrets: use Secrets Manager +
  runtime fetch. Do **not** put secret values into
  `Function.environment` directly (they show in CloudFormation
  templates and console output).

---

## API Gateway — WAF + allowlist

- Every REST / HTTP API that is reachable from the internet
  has a **WAF WebACL** attached:
  - Dev/staging: WAF default action = `block`, IPSet allow
    rule for the operator's public IP (resolve at deploy time:
    `curl -fsS https://ifconfig.me`). The IPSet IP is **not
    hardcoded in source** — it is passed as a CDK context /
    env var / stack parameter and can be refreshed by redeploy.
  - Prod: WAF default action = `allow`, AWS Managed Rules
    groups attached (Core, SQLi, Known-Bad-Inputs at minimum;
    Bot Control when budget permits). Additional IP-based
    deny rules for known bad IPs as needed.
- Custom authorizer / Cognito authorizer is the application-
  layer auth. WAF is the network-layer filter; both are
  required in dev.

---

## CloudFront — OAC only; dev locked by WAF IPSet

- Origin: S3 via OAC (see §S3) or ALB via signed Origin Access
  Identity header check. Never a raw S3 bucket URL.
- WAF WebACL scope = `CLOUDFRONT`, attached at the
  distribution level. Dev/staging WebACL uses the same IPSet
  allowlist pattern as API Gateway.
- Viewer protocol policy: `REDIRECT_TO_HTTPS` (never
  `ALLOW_ALL`).

---

## Security Groups — explicit, CIDR-driven

- Internet-facing ALB / NLB SGs: ingress list is built from a
  CIDR allowlist **sourced from CDK context or config**, never
  inlined in the stack.
- Dev/staging SG ingress = operator's public IP `/32` (resolved
  the same way as WAF IPSet).
- No SG ships with `ec2.Peer.anyIpv4()` ingress on a dev/staging
  stack. Prod SGs that must allow `anyIpv4` (user-facing
  service) still restrict to the specific port(s) + protocol
  and carry a comment linking to the ADR that approved it.
- Outbound: leave the CDK default (`allowAllOutbound: true`)
  unless the project has an egress-filtering requirement.
  Noisy egress rules without a reason add review burden.

---

## VPC endpoints — prefer over NAT

When Lambda / ECS in a private subnet needs to reach AWS
services (S3, DynamoDB, Secrets Manager, SSM, CloudWatch Logs,
KMS), use **VPC endpoints** rather than routing through NAT:

- Cheaper (NAT per-GB is expensive).
- Private (traffic stays on AWS backbone).
- Easier to audit (endpoint policies are introspectable).

Gateway endpoints for S3 / DynamoDB; Interface endpoints for
everything else. Shared across all stacks in a project's VPC
stack.

---

## IAM — least-privilege by construct

- `addToRolePolicy` / `grant*` methods at the resource level
  are preferred over stack-scoped `*` policies.
- `grantReadWrite` over `grantFullAccess` unless the resource
  genuinely needs both list-all and modify-all.
- Never a `*` on both `Action` and `Resource`. Violation of
  either is a review block.
- Roles inherit an **execution boundary** (permissions
  boundary policy) that caps blast radius if the role is
  compromised.

---

## KMS — project CMK, rotation on

- Any resource that holds user data (DynamoDB tables, S3
  buckets, RDS, Secrets Manager) encrypts with a
  **project-owned CMK**, not AWS-managed.
- `enableKeyRotation: true`.
- CMK policy grants use only to the specific service principals
  that need it.

---

## DynamoDB — PITR, server-side encryption

- `pointInTimeRecovery: true` for any table holding user data.
- `encryption: TableEncryption.CUSTOMER_MANAGED` (or
  `AWS_MANAGED` at minimum).
- `billingMode: BillingMode.PAY_PER_REQUEST` for dev and new
  prod tables (cheaper until predictable traffic emerges).

---

## What the evaluator checks before merging CDK

1. `cdk synth` produces no `AwsSolutions-*` warnings from
   `cdk-nag` (if wired), or the equivalent manual check:
   - S3 buckets have `BlockPublicAccess.BLOCK_ALL`.
   - No `authType: NONE` on Function URLs.
   - Every internet-facing API GW / CloudFront has a WAF
     associated.
   - No `anyIpv4` on dev/stg SG ingress.
2. The PR body's evidence block includes the `cdk diff`
   output; the reviewer scans for any of the above as a blocker.
3. For dev deploys: the evaluator verifies
   `aws wafv2 get-ip-set` or
   `aws ec2 describe-security-groups` output matches exactly
   the operator's current IP `/32` (no drift, no extras).

---

## Exceptions

A resource that **must** be public (marketing site ALB, public
API, CDN for static assets) still goes through this checklist:

- S3 BlockPublicAccess ALL stays ON; public access is via
  CloudFront + OAC, not bucket ACL.
- API GW / ALB is public but sits behind WAF with managed rule
  groups + rate limiting.
- The operator's intent is documented in
  `docs/adr/NNN-public-exposure-<resource>.md` with the
  justification, the data classification of what is exposed,
  and the monitoring in place (CloudWatch alarms, WAF count-mode
  rules, access logging).
- PR body cites the ADR.

No exception is accepted without the ADR.

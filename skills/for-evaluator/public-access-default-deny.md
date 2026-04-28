---
name: public-access-default-deny
description: Use when provisioning internet-facing resources (ALB, CloudFront, S3, API Gateway, Kubernetes Ingress) or security groups / firewall rules. Requires explicit CIDR / origin allowlist; 0.0.0.0/0 requires an inline justification comment.
---

# Skill — Public access default-deny

**For**: generator (if touching network / security IaC),
evaluator (enforces at review).
**Applies when**: the project provisions any internet-facing
resource (ALB, CloudFront, S3, API Gateway, Kubernetes
Ingress, etc.) or security groups / firewall rules.

## The principle

**Any resource that is exposed to the internet must explicitly
allowlist the CIDRs / paths / origins that reach it. `0.0.0.0/0`
is never the default — not even for "convenience during
development".**

Public-by-default rules are the single most common source of
post-deploy "we didn't mean to expose that" incidents. The
discipline is to make the ALLOW list explicit, visible in
config, and reviewable.

## What this rules out — always, in every environment

- **S3 bucket public access — never allowed.** Every bucket
  ships with `BlockPublicAccess.BLOCK_ALL` (the strictest
  setting). `publicReadAccess: true`, `public-read` ACL, and
  any `AllowPublicReadAccess` statement in a bucket policy are
  unconditionally rejected. "But CloudFront serves the site"
  does not relax this — use OAC (Origin Access Control) with a
  bucket policy scoped to the specific distribution.
- **Lambda public invocation — never allowed.** No
  `FunctionUrl` with `AuthType: NONE`. No `AddPermission` that
  grants `lambda:InvokeFunction` to `*` / `AnyPrincipal`. Every
  Lambda is invoked via API Gateway (+ WAF), ALB (+ SG), or an
  event source. A Function URL with `AuthType: AWS_IAM` is the
  only public-surface form permitted, and only for service-to-
  service invocation where the caller holds IAM credentials.
- **Security groups with `0.0.0.0/0` ingress on any port** of
  an internet-facing load balancer or host. Use explicit
  CIDRs from config or the operator's resolved IP.
- **CloudFront / API Gateway / Function URL without WAF** on
  endpoints that touch any non-public data. Even for genuinely
  public endpoints (marketing, docs), WAF with managed rule
  groups is required in prod.
- **Ingress controllers with wildcard host rules** that catch
  traffic the project did not intend to serve.
- **Kubernetes services of type `LoadBalancer` on clusters
  with a public node pool** when the service should be
  internal-only.

## Config shape

Every internet-facing resource's CIDR / origin allowlist lives
in the project's config:

```yaml
# config/<app>-<env>.yaml
network:
  alb:
    allowedCidrs:
      - 10.0.0.0/8            # corporate VPN
      - 203.0.113.0/24        # office
      # never 0.0.0.0/0 without an explicit justification comment
```

The IaC reads the list and applies exactly those rules. If the
list is empty or missing, the deploy **fails** — there is no
silent default to "0.0.0.0/0".

## Exceptions

Genuinely public endpoints (marketing site, public API that
does its own auth at the application layer, public docs) can
allow `0.0.0.0/0`, but the config entry must say so
**explicitly**:

```yaml
network:
  alb:
    allowedCidrs:
      - 0.0.0.0/0
    allowedCidrsJustification: "public marketing site; no
      protected data served behind this ALB"
```

A reviewer seeing `0.0.0.0/0` without an accompanying
justification comment blocks the PR.

## Description-field gotchas

In several IaC tools (CloudFormation, some Kubernetes
admission controllers), resource **description fields** reject
non-ASCII characters or certain special characters
(`→`, `←`, non-Latin scripts, some punctuation). A deploy
fails with a vague error. Convention:

- Security Group descriptions: ASCII only.
- Resource descriptions: ASCII only when the tool is known to
  be strict.

## Related skills

- `skills/for-evaluator/iac-config-driven-portability.md` — where the
  allowlist lives (config) vs. where the rule lives (code).
- `skills/for-evaluator/resource-naming-convention.md` — resource
  descriptions still follow naming/tagging rules.

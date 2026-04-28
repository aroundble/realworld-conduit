---
name: infrastructure-lookup-fallback
description: Use when writing IaC that references a resource in another stack, another tool's state, or the operator's console. Requires the three-step fallback: direct ID / name tag / convention. No hardcoded IDs in code.
---

# Skill — Infrastructure lookup fallback

**For**: generator (if touching IaC), evaluator (enforces at
review).
**Applies when**: the IaC needs to reference a resource that
lives in another stack, another tool's state, or an operator's
console.

## The principle

**Every lookup supports a three-step fallback: direct ID, name
tag, convention. A new project can use the convention; an
existing project can point the lookup at a resource it already
has. No lookup is tied to any single mechanism.**

## The three steps

When the IaC needs to reference, for example, a VPC, a
database, a hosted zone, an ECR repository, etc., the lookup
function tries in order:

1. **Direct ID / ARN / resource address** if the config
   specifies one. Example: `vpcId: vpc-abc123`. Most specific,
   used when the target resource is older than the convention.
2. **Name tag** if the config specifies a name. Example:
   `vpcName: legacy-network-a`. Used for resources that exist
   but do not follow the project's naming convention.
3. **Naming convention** if neither is specified. Example:
   derive `<project>-<env>-<regionCode>-vpc` from the
   project's naming convention and look up by that name.

The lookup function signature looks roughly like:

```typescript
interface VpcLookupOptions {
  vpcId?: string;    // step 1
  vpcName?: string;  // step 2
  // step 3 is implicit: fall through to convention
}
```

(Adapted for the project's IaC tool — Terraform data sources,
Pulumi stack references, Helm template lookups all follow the
same shape.)

## Why three steps, not one

- **Only convention** works in greenfield projects but breaks
  immediately when adopting into an existing cloud account
  with resources that predate the convention.
- **Only direct ID** forces every deployment to hand-configure
  every reference in YAML, which makes environments divergent
  and hard to reproduce.
- **Only name tag** works until a resource is not tagged per
  convention, which happens as soon as someone uses the
  console.

The fallback collapses the three cases into one uniform
interface: the IaC does one thing; the config chooses which
step applies.

## What this rules out

- **Hardcoded resource IDs in IaC code**. IDs live in config
  or are derived by convention.
- **A lookup that only supports one of the three steps**.
  Every lookup function covers all three.
- **A separate `-existing` variant** of a stack that uses
  direct IDs and a `-new` variant that uses convention. The
  same stack supports both through the fallback.

## Console-change tolerance

A side-effect of lookup-based references: the operator (or a
cloud admin) can change a resource in the console without
breaking the next IaC deploy, because the next deploy looks it
up fresh rather than carrying a stale output-to-input
reference. This is a property worth preserving.

## Related skills

- `skills/for-evaluator/iac-config-driven-portability.md` — the
  broader pattern this lookup discipline lives inside.
- `skills/for-evaluator/resource-naming-convention.md` — what the
  convention in step 3 looks like.

---
name: resource-naming-convention
description: Use when provisioning named cloud or stack resources. Enforces a single project-wide naming convention so auto-discovery via infrastructure-lookup-fallback works and grep / tag-based audit is reliable.
---

# Skill — Resource naming convention

**For**: generator (creates resources), evaluator (enforces at
review).
**Applies when**: the project provisions cloud or stack
resources.

## The principle

**Every named resource follows a single project-wide naming
convention, documented in one place. Resource names are
predictable from the project + environment + resource type,
which makes auto-discovery (see
`skills/for-evaluator/infrastructure-lookup-fallback.md` step 3)
possible.**

## The convention

Standard shape (projects adopt or adapt):

```
{project}-{env}[-{regionCode}][-{category}]-{resourceType}[-{name}]
```

| Segment | Required | Position | Example |
|---|---|---|---|
| `project` | yes | first | `myprj` |
| `env` | yes | after project | `dev`, `staging`, `prd`, `beta` |
| `regionCode` | conditional | after env, for region-specific resources | `an2`, `ue1` |
| `category` | optional | middle, for grouping | `ecs`, `alb`, `data` |
| `resourceType` | yes | near end | `vpc`, `svc`, `role`, `sg`, `tg`, `td` |
| `name` | optional | last, to disambiguate multiples | `api`, `worker`, `migrate` |

Segments join with `-` (hyphen, not underscore or camelCase).

### Region code

Convention: take the AWS region (or equivalent), split on `-`,
take the first letter of each word + the trailing digit:

- `ap-northeast-2` → `an2`
- `us-east-1` → `ue1`
- `eu-west-1` → `ew1`

Other clouds follow the same shape.

### When to include region code

- **Region-specific resources**: VPCs, subnets, security
  groups, load balancers, Cloud Map namespaces — include.
- **Global or region-agnostic resources**: IAM roles, IAM
  policies, OIDC providers, Route 53 hosted zones — omit.

Projects state the rule once; all resources follow it.

## Why this convention

- **Auto-discovery by lookup**. Step 3 of the lookup fallback
  (`skills/for-evaluator/infrastructure-lookup-fallback.md`) uses this
  convention to compute the expected name without any config.
  If the convention is consistent, lookups "just work".
- **Grep-friendly**. `grep myprj-dev-` narrows to one
  environment; `grep -svc$` narrows to services.
- **Evidence-friendly**. A resource name in a log line or
  error message immediately tells the reader which project,
  environment, and resource type is involved.
- **Multi-account friendly**. Two accounts that hold separate
  environments of the same project do not collide because the
  environment segment disambiguates.

## What this rules out

- **Random or operator-chosen names** ("jenny-test-1"). Use
  the convention.
- **Different conventions across categories** in the same
  project.
- **Mixed separators**: `myprj_dev-vpc` or `MyPrjDevVpc`.
- **Non-ASCII names**. Security Group / CloudFormation
  description fields in particular reject non-ASCII silently
  and cause deploys to fail with unclear messages.

## Tagging companion

Every named resource also carries tags:

- `Project` = `{project}`
- `Environment` = `{env}`
- `ManagedBy` = the IaC tool and project that owns it.

Tags are orthogonal to naming — the name is the human-visible
ID; the tags are the machine-queryable metadata. Both exist.

## Escape hatches

- **Legacy resources** that predate the convention — reference
  them via the lookup fallback's step 1 (direct ID) or step 2
  (name tag) rather than forcing a rename. Renames in most
  cloud IaC tools are destructive.
- **Vendor-imposed naming** (e.g. S3 bucket names must be
  globally unique) — append a random suffix or an account ID
  hash at the end.

## Related skills

- `skills/for-evaluator/infrastructure-lookup-fallback.md` — why the
  convention matters for auto-discovery.
- `skills/for-evaluator/iac-config-driven-portability.md` — how
  conventions live in code, values in config.

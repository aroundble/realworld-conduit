---
name: iac-config-driven-portability
description: Use when touching Infrastructure-as-Code (CDK, Terraform, Pulumi, Helm, CloudFormation). Requires code-freeze + config-driven operation; new environments = new config file, not code edits.
---

# Skill — Config-driven IaC portability

**For**: generator (if touching IaC), evaluator (enforces at
review).
**Applies when**: the project has any Infrastructure-as-Code.

## The principle

**IaC code is frozen; environment-specific behavior is driven
by per-environment config. A new environment is added by
writing a new config file, not by editing IaC code.**

This is the operational form of portability for infrastructure.
`skills/for-generator/portable-environment-values.md` forbids
env-dependent values in code; this skill says where those
values live and how they flow through the IaC deploy.

## Three rules

### 1. Code freeze + config-driven

IaC code is written once and then frozen for the environment.
When `dev` / `staging` / `prod` need different capacity,
scaling, retention, image versions, replicas, or backups, the
**config** changes, not the IaC code.

Concretely: the IaC reads a config file named by environment
(`config/<app>-<env>.yaml`, or the chosen layout) and passes
the values through to the stack / module / chart.

### 2. Stack-level selective deploy

Stacks (or modules, or charts) are composed so each deploys
independently. `cdk deploy NetworkStack` deploys only the
network; `terraform apply -target=module.data` deploys only
the data module; `helm upgrade <chart>` updates only one
chart. A full-project deploy is the composition of selective
deploys, not a single monolith.

This matters because selective deploys are **composable** —
two engineers (or two agent sessions) can work in parallel on
different stacks if they do not cross-couple.

### 3. Lookup-based cross-stack references

Cross-stack dependencies resolve via **lookup** (by name / ID /
tag / SSM parameter) rather than via the IaC tool's native
output→input coupling (`CfnOutput` / `ImportValue` in
CloudFormation, `terraform_remote_state`, `helm template
--output` piping).

See `skills/for-evaluator/infrastructure-lookup-fallback.md` for the
fallback pattern lookups should implement.

## What this rules out

- **Environment `if` blocks in IaC code**: `if env ==
  "prod": capacity = 10 else: capacity = 2`. Move to config.
- **Hard-coded account IDs / region / ARN** in IaC code.
- **CfnOutput + ImportValue** chains between stacks. Use SSM
  or tag lookups.
- **Deploy-command-line overrides for resource properties**
  (`cdk deploy --parameters Capacity=10`). Parameters flow from
  config, not from the deploy invocation.
- **"Stack name change"** in an existing project. Most IaC
  tools cannot rename a stack without destroy+recreate — treat
  a rename as a nuke + rebuild, not a cosmetic refactor.

## Override boundary (what *can* change between environments)

A subset of values is expected to differ:

- **Capacity and scaling** (min/max instances, autoscaling
  thresholds).
- **Retention** (log / backup / snapshot retention windows).
- **Image references** (content-addressed — see
  `skills/for-evaluator/immutable-infrastructure.md`).
- **Replica / redundancy** counts.
- **Feature flags** that are environment-appropriate.

A superset is **never** expected to differ:

- **Security posture** (IAM permissions, SG rules, encryption
  settings).
- **Network layout** (subnet CIDRs, routing, peering).
- **Logging / monitoring drivers and wiring** (what emits
  metrics / logs / traces and how they route).

Values in the "never" superset live in code, not config.
Values in the "expected" subset live in config.

The judgment: **"Is it reasonable that dev and prod differ on
this value?"** If yes, it goes in config. If no, it goes in
code.

## Related skills

- `skills/stacks/aws-cdk/cdk-portable-immutable.md` — the CDK form of this
  principle.
- `skills/ops/env-config-matrix.md` — how to lay out the config
  file itself.
- `skills/for-evaluator/infrastructure-lookup-fallback.md` — how
  cross-stack lookups work.
- `skills/for-evaluator/immutable-infrastructure.md` — content-addressed
  artifacts as part of portable deploys.

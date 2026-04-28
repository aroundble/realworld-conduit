---
name: immutable-infrastructure
description: Use when reviewing IaC changes or deploy configuration. Forbids mutable image tags (latest, stable), IMAGE_TAG overrides, CfnOutput / ImportValue cross-stack couplings, silent stack renames. Deploy artifacts must be content-addressed.
---

# Skill — Immutable infrastructure

**For**: generator (if touching IaC), evaluator (enforces at
review).
**Applies when**: the project has any Infrastructure-as-Code.
Pure-library or pure-frontend projects without infra code skip
this skill.

## The principle

**The same commit deployed twice produces the same runtime
state.** No mutable tags, no manual overrides, no stack-level
couplings that can drift between deploys.

This is what "immutable" means in `githarness`: deploy
determinism as a property of the code, not of the operator's
discipline at deploy time. An operator deploying at 2 a.m.
half-asleep must produce the same state as the first-run
production deploy.

## What this rules out

- **Mutable tags on container images** (`latest`, `stable`,
  `prod`, `v1`). The deploy artifact reference must be
  content-addressed: an image digest, an asset hash, a bundle
  SHA. CDK's `EcrImage` asset hash, Terraform's image digest
  data source, Helm's chart digest are all fine shapes.
- **Image tag overrides at deploy time**
  (`IMAGE_TAG=<something>` on the deploy command). If the
  artifact reference is content-addressed, there is nothing to
  override.
- **Cross-stack couplings** that can skew. `CfnOutput` /
  `ImportValue` chains in CloudFormation, Terraform's
  `terraform_remote_state`, or raw output-to-input plumbing
  between stacks all couple stacks such that updating one can
  change the other unpredictably. Use SSM parameters, tags, or
  resource lookups by name — the lookup is explicit and
  diffable.
- **Stack renames**. CloudFormation, CDK, and most IaC tools
  cannot rename a stack without destroying and recreating. A PR
  that appears to "just rename" is actually a nuke + rebuild and
  must be treated as such.
- **Resource-level `DeletionPolicy: Retain` + manual mutation**.
  If the stack retains a resource but the operator mutates it
  manually, the next `cdk deploy` either fails or reverts the
  mutation surprisingly. The immutability contract says: every
  runtime property visible from the cloud must also be visible
  in the IaC.

## The test

Before approving an infra PR, the evaluator asks: "If I deploy
this PR's merge commit twice to two separate empty accounts,
will I end up with identical runtime state?" If the answer is
"yes", immutability is preserved. If "maybe, depending on
timing / operator choices / external state", the PR violates
this skill.

## Content-addressed artifacts — common forms

| Stack | Mechanism |
|---|---|
| AWS CDK + ECR | `EcrImage.fromAsset(...)` — content-addressed by source hash. |
| AWS CDK + Lambda bundles | `lambda.Code.fromAsset(...)` — content-addressed bundle. |
| Terraform + Docker | Image digest as an `aws_ecr_image` data source; never the tag. |
| Kubernetes + Helm | Chart pinned by digest; image pinned by digest. |
| Raw docker compose (dev only) | N/A — compose is not a deploy tool; see `skills/for-evaluator/deployment-pipeline.md`. |

## Related skills

- `skills/stacks/aws-cdk/cdk-portable-immutable.md` — the concrete CDK form of
  this principle.
- `skills/stacks/aws-cdk/ecr-image-asset-hash.md` — the ECR-specific mechanism.
- `skills/stacks/terraform/terraform-patterns.md` — the Terraform form.
- `skills/for-evaluator/deployment-pipeline.md` — how deploys are
  sequenced safely.

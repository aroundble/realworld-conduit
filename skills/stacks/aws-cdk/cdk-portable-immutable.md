---
name: cdk-portable-immutable
description: Use when writing or reviewing AWS CDK stacks. Concrete mechanism for the universal immutable-infrastructure and iac-config-driven-portability principles: EcrImage asset hashes, lambda.Code.fromAsset bundles, SSM lookups instead of CfnOutput, stack-name preservation.
---

# Skill — Portable, Immutable CDK Deployments

A skill the **evaluator** session should internalize. Generator generally
does not deploy; if generator does touch CDK code, the evaluator still
enforces these rules at PR review.

## The two principles

### 1. Portability

**Rule**: a fresh AWS account should reach the same deployed state by
running `cdk deploy` on a clean clone, with no manual intervention
beyond bootstrap credentials.

If anything prevents this — a manual console click, a Secrets Manager
value inserted by hand, a Security Group rule added via CLI, an ACM
certificate validated out-of-band — the deployment is not portable.

**Test for portability**: can you point a new AWS account's
credentials at this CDK codebase, `cdk deploy --all`, and wake up the
next morning with a working stack? If the answer is "well, you'd also
need to..." — fix that first.

### 2. Immutability

**Rule**: a successful `cdk deploy` produces state that subsequent
deploys can reproduce exactly. No "it worked once, we'll retry" or
"this resource drifted, leave it alone."

If the deployed state diverges from what CDK code describes (drift),
CDK code is what should change, not the deployed state. If the
deployed state is what you want, encode it in CDK and re-deploy.

**Test for immutability**: run `cdk diff` against production. Drift
from expected? Fix the code (or the state) until `cdk diff` is empty
on a no-op run.

## Anti-patterns to reject at review

| Anti-pattern | Why rejected | Proper fix |
|---|---|---|
| `aws ecs update-service --desired-count 5` in a script | Mutates deployed state outside CDK | `desiredCount: 5` in the service props |
| Secret populated by `aws secretsmanager put-secret-value` post-deploy | New account lacks the secret | `SecretValue.cfnParameter(...)` or `generateSecretString(...)` at stack level |
| ACM certificate validated via DNS but DNS not in CDK | Cross-account dependency hidden | `Route53.HostedZone` + `CertificateValidation.fromDns(...)` in same stack |
| Security Group ingress rule added manually for "temporary debugging" | Persists, not reproducible | `securityGroup.addIngressRule(...)` with an `if (props.debugMode)` guard |
| ECR image tag `latest` used in TaskDefinition | Non-deterministic deploy | `ecs.ContainerImage.fromAsset(...)` (CDK builds + hashes) |
| Lambda code in `inline: ...` hardcoded string | Hard to review, no tests | `Code.fromAsset(path)` + separate package with tests |
| Environment-specific values in `cdk.context.json` committed | Conflates code and config | YAML per environment + loader at synth time |
| `aws logs create-log-group` in a post-deploy script | State outside CDK | `LogGroup` construct, `retention: logs.RetentionDays.ONE_MONTH` |

## The structure that holds up

```
infra/
  bin/app.ts            # synthesize all stacks for CONFIG_ENV
  config/
    prod.yaml           # per-environment config (never secrets)
    dev.yaml
    staging.yaml
  lib/
    props/              # typed props objects loaded from yaml
    lookups/            # cross-stack discovery via SSM (not CfnOutput)
    stacks/
      network-stack.ts  # VPC, subnets, security groups
      data-stack.ts     # databases, caches, storage
      app-stack.ts      # the application containers / lambdas
      observability-stack.ts  # logs, metrics, alarms
  lambda/               # Lambda source trees — one per function
  package.json
  tsconfig.json
```

Stacks are dependency-ordered: Network → Data → App → Observability.
Cross-stack references go through SSM Parameter Store (portable) not
`CfnOutput`/`ImportValue` (CloudFormation-only, makes stack
splitting/renaming painful).

## Feature flag discipline in CDK

Every behavior-changing flag is an SSM parameter or environment
variable, defaulted conservatively (usually `false` for new features).
The evaluator enforces:

- Flag has a default that matches current production behavior.
- Flag is readable by the running service (env block, or SSM read in
  startup).
- Flag is documented in the PR description AND in a `docs/config.md`
  or equivalent.
- "Canary" flags (enabled only in dev) have a separate
  `HEIMDAL_*_CANARY` convention or a dedicated SSM path to avoid
  accidentally flipping in prod.

## Deploy sequence the evaluator follows

After merging a PR that touches infra:

```bash
# 1. Pull latest into evaluator worktree
git fetch origin && git pull --rebase origin latest

# 2. Check what CDK thinks has changed
cd infra
CONFIG_ENV=dev npx cdk diff <stack-name>

# 3. Expected-changes-only: the diff must match the PR's stated scope.
#    If extra resources appear, STOP — something drifted or the PR
#    didn't declare full scope.

# 4. Deploy
CONFIG_ENV=dev npx cdk deploy <stack-name> --require-approval never

# 5. Monitor rollout
#    ECS: watch tasks drain and replace (describe-services)
#    Lambda: verify new version is aliased to the published alias
#    CloudFront: verify invalidation if content shape changed

# 6. Run remote E2E (see runtime-e2e-discipline.md)
```

If step 3's diff shows resources outside the PR's scope, either:

- (a) the PR description was incomplete — add a comment listing the
  actual scope and re-review, OR
- (b) drift from a prior manual change — investigate before
  proceeding, document in an issue.

## Common CDK errors the evaluator decodes

| Error message | Likely cause | Action |
|---|---|---|
| `Resource already exists` | Stack renamed or resource physical name collides | Check `stackName` / `physicalName` in props; resource probably needs `cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE` or a rename via logical ID |
| `Cannot delete because there are other logical resources currently updating` | Parallel deploy attempted | Wait for in-flight deploy, retry |
| `Export ... is used by stack ...` | Cross-stack reference prevents deletion | Find the consumer stack, remove reference first |
| `Circular dependency between resources` | Two resources reference each other in Props | Refactor — one side uses SSM lookup instead of direct reference |
| `Rate exceeded` during synth | CDK context lookups exceed limits | Pre-populate `cdk.context.json` with critical lookups (VPC IDs, AZs) |

## When to push back on a PR touching CDK

- Mutates shared infrastructure that other stacks depend on and
  doesn't coordinate the migration (stack-split, resource rename).
- Adds a new stack without updating the deploy order doc.
- Introduces a CloudFormation custom resource for something expressible
  natively.
- Uses `physicalName` explicitly when a CDK-generated name would be
  fine.
- Fails `cdk synth` in CI.

## When to fast-track a PR touching CDK

- Single resource property tweak (e.g., `desiredCount` from 3 to 5) in
  a dev environment.
- Removing an unused resource (deprecation PR).
- Label-only changes (tags, descriptions).
- Documentation-adjacent (adding `description: '...'` to constructs).

These can approve with a quick scan. Don't let the elaborate review
protocol become a ceremony that slows trivial work.

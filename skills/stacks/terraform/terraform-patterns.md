---
name: terraform-patterns
description: Use when writing or reviewing Terraform. Concrete Terraform form of the universal immutable-infrastructure and iac-config-driven-portability skills: state backend, remote state for cross-module refs, module version pinning, image digest pinning.
---

# Skill — Terraform Patterns for githarness

Same principles as the CDK skill (portable, immutable, stack ordering)
applied to Terraform. The evaluator enforces them at PR review time.

## Workspace or environment layout

```
infra/
  modules/               # reusable modules; unit-testable; no env-specific values
    network/
    data/
    app/
  envs/
    dev/
      main.tf            # instantiates modules with dev values
      backend.tf         # s3 backend config (bucket, region, key)
      terraform.tfvars   # non-secret env values
      .tfvars.secret.gpg # encrypted secrets, decrypted at deploy time
    staging/
    prod/
  scripts/
    plan.sh              # wraps `terraform plan` with the right env
    apply.sh             # wraps `terraform apply` with the right env
```

Rule: **no env-specific values in `modules/`**. A module accepts
variables; the env's `main.tf` supplies the values. This keeps
modules reusable and keeps env config diff-able.

## Backend configuration: S3 + DynamoDB locks

```hcl
terraform {
  backend "s3" {
    bucket         = "myorg-terraform-state"
    key            = "envs/dev/infra.tfstate"
    region         = "us-east-1"
    dynamodb_table = "myorg-terraform-locks"
    encrypt        = true
  }
}
```

- One bucket per organization is sufficient.
- DynamoDB table prevents concurrent applies (critical when both
  evaluator and a human might touch infra in sequence).
- `encrypt = true` is mandatory. Terraform state contains secrets by
  default.

## Immutability invariants

| Pattern | Status |
|---|---|
| `terraform apply` twice in a row with no code change produces empty plan | Required |
| `terraform plan` against fresh state (after `rm -rf .terraform/`) produces same result | Required |
| Importing an existing resource: only acceptable if it's documented in `imports.md` with reason | Conditional |
| `terraform state rm` / `terraform state mv` manually in production | Prohibited except during deliberate refactor, and then via a migration script committed to the repo |

If `terraform plan` shows unexpected changes after a pull, someone
applied something manually. Find them. Fix the state or the code.
Never leave drift.

## Portability invariants

| Pattern | Status |
|---|---|
| `terraform apply` on a fresh checkout with fresh creds produces working env | Required |
| Secrets are fetched from a secret manager (AWS SSM, Vault) at apply time, not hardcoded | Required |
| Module-provided resources work in any AWS region supported by the module | Required |
| Prerequisite resources (DNS zones, ACM certs) either created by the same terraform or documented with `pre-requisites.md` | Required |

## Anti-patterns

- **`local-exec` provisioners running AWS CLI** to mutate state.
  Symptom of Terraform not modeling a resource; model it or use a
  different tool.
- **Inline scripts `user_data` with embedded secrets**. Use SSM and
  `aws ssm get-parameter` from the script.
- **`count = var.enabled ? 1 : 0` widely applied**. Usually indicates
  a boolean should be a conditional module include.
- **Pinning a resource's `id` in another resource's source**. Use the
  resource reference (`aws_vpc.main.id`); do not hardcode.
- **Running `apply` without `plan` in CI**. Always plan first, human-
  review (or evaluator-agent-review) the plan, then apply.

## Plan output interpretation

The evaluator agent reading `terraform plan` looks for:

- **Number of resources being created, modified, destroyed**. A PR
  that claimed to "bump instance size" should not destroy 20
  resources — something is wrong.
- **`-/+` destroy-then-create symbols**. These are dangerous for
  stateful resources (databases, EBS volumes). Investigate before
  applying.
- **`~` modify symbols for immutable attributes**. Terraform will
  sometimes quietly destroy-and-recreate even with `~`; check the
  resource type docs.
- **`# forces replacement`** notes. These are the most important
  lines in the plan.

## The apply sequence

```bash
# 1. In the evaluator worktree
cd infra/envs/dev
terraform init -upgrade  # only needed if provider versions changed

# 2. Plan
terraform plan -out=tfplan -var-file=terraform.tfvars

# 3. Review the plan OUTPUT before applying. Expected changes only?
#    Unexpected changes → STOP, investigate, do not apply.

# 4. Apply
terraform apply tfplan

# 5. Verify in AWS: resources created as expected, working as expected.
#    If not, refine code and plan again. Do not mutate via console.
```

## Secrets handling

- Never commit unencrypted secrets. Period.
- Use `sops` + `age` or `sops` + KMS for secret files committed to
  the repo. Decrypt at plan/apply time only.
- Prefer fetching from SSM Parameter Store / Secrets Manager at apply
  time via `data "aws_ssm_parameter"` data sources.
- Rotate secrets via separate procedures (scripts, runbooks); do not
  rotate via terraform apply.

## When terraform and CDK coexist in one codebase

This happens (e.g., shared DNS in terraform, per-service in CDK).
Rules:

- One tool owns each resource. Never both.
- Ownership boundary is documented in `infra/OWNERSHIP.md`.
- Cross-tool references go via SSM parameters or tagged resources,
  not direct imports.

## The evaluator's review questions for a terraform PR

1. Did the PR author commit the `plan` output as evidence?
2. Does the plan destroy any stateful resource unintentionally?
3. Are all new resources tagged with the project/env conventions?
4. Are secrets referenced from SSM, not inlined?
5. Does the PR touch `modules/` in a way that would break other
   environments?
6. If backend config changed, was the state migration documented?

A "yes" to any of 2, 4, 5, 6 without explicit justification in the PR
description is a request-changes signal.

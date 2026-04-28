# Stack — AWS CDK

Enable this stack for projects using AWS Cloud Development Kit
(TypeScript / Python / Go / Java / C# / .NET) as the
Infrastructure-as-Code tool.

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [cdk-portable-immutable.md](cdk-portable-immutable.md) | evaluator | Portability + immutability as concrete CDK mechanisms: content-addressed asset hashes (`EcrImage`, `lambda.Code.fromAsset`), SSM / tag lookups instead of `CfnOutput` / `ImportValue`, no `IMAGE_TAG` overrides, stack-name preservation. |
| [ecr-image-asset-hash.md](ecr-image-asset-hash.md) | evaluator, generator if touching infra | The ECR-specific side: how `EcrImage.assetHash` derives the image digest from source, the edge case where env-only changes fail to bump the TaskDefinition revision, and the `timestamp` override pattern for that edge case. |

## MCP server wired by this stack

`awslabs.aws-iac-mcp-server@latest` — provides the session with
live access to current CDK and CloudFormation documentation,
samples, and best-practices. Auto-approved tools:

- `read_iac_documentation_page`
- `search_cdk_documentation`
- `search_cdk_samples_and_constructs`
- `cdk_best_practices`
- `search_cloudformation_documentation`

At `githarness init` time, the MCP server definition in
`mcp-servers.json` is merged into the project's top-level
`.mcp.json`. The session picks it up automatically on startup.

## When to enable

Enable this stack if the project:

- Deploys AWS resources through CDK.
- Is about to start deploying AWS resources and has chosen CDK.
- Is migrating from raw CloudFormation / SAM / Terraform to CDK
  (during the migration window, enable both this stack and the
  source stack).

Do **not** enable if the project:

- Uses Terraform exclusively → enable `skills/stacks/terraform/`
  instead.
- Uses plain CloudFormation / SAM without CDK → no stack-level
  skill currently ships; use the generic `for-evaluator/`
  skills.
- Uses a non-AWS cloud → enable the appropriate stack when it
  ships.

## Related

- [`skills/for-evaluator/immutable-infrastructure.md`](../../for-evaluator/immutable-infrastructure.md)
  — the universal principle this stack implements.
- [`skills/for-evaluator/iac-config-driven-portability.md`](../../for-evaluator/iac-config-driven-portability.md)
  — the universal principle for config-driven portability.
- [`skills/for-evaluator/infrastructure-lookup-fallback.md`](../../for-evaluator/infrastructure-lookup-fallback.md)
  — the three-step lookup pattern.

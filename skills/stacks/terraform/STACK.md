# Stack — Terraform

Enable this stack for projects using Terraform as the
Infrastructure-as-Code tool.

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [terraform-patterns.md](terraform-patterns.md) | evaluator | Portable + immutable Terraform: state backend, remote state for cross-module refs (not pipelined outputs), module versioning, image / artifact pinning by digest. |

## MCP server wired by this stack

None currently configured. If HashiCorp ships a Terraform
Registry / Terraform Cloud MCP, add its definition to
`mcp-servers.json` here and it will be wired at init time.

## When to enable

Enable this stack if the project:

- Uses Terraform as its primary IaC tool.
- Uses both Terraform and CDK (enable both stacks during the
  coexistence window).

## Related

- [`skills/for-evaluator/immutable-infrastructure.md`](../../for-evaluator/immutable-infrastructure.md)
- [`skills/for-evaluator/iac-config-driven-portability.md`](../../for-evaluator/iac-config-driven-portability.md)
- [`skills/for-evaluator/infrastructure-lookup-fallback.md`](../../for-evaluator/infrastructure-lookup-fallback.md)

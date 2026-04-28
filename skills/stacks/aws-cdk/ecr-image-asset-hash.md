---
name: ecr-image-asset-hash
origin: githarness (distilled from Heimdal)
---

Never set `IMAGE_TAG` manually. The IaC framework (CDK, Pulumi,
Terraform with `docker_image`) computes a content hash; unchanged
builds produce the same tag; only actual changes roll.

Rule: `docs/bp/ecr-image-asset-hash.md`.

## CDK (TypeScript) pattern

```ts
import * as ecs_assets from 'aws-cdk-lib/aws-ecr-assets';

const gwImage = new ecs_assets.DockerImageAsset(this, 'GwImage', {
  directory: path.join(__dirname, '..', '..', 'heimdal-gw'),
});

taskDef.addContainer('gw', {
  image: ecs.ContainerImage.fromDockerImageAsset(gwImage),
});
```

## Sanity check (during review)

```bash
grep -rn 'IMAGE_TAG' infra/ .github/ scripts/ 2>/dev/null
# expect 0 hits outside of comments warning against manual tags
```

## Why not semver tags

Release versions go into git tags, CloudWatch metric dimensions,
and observability labels — not into ECR. The deployer sees one
thing (content), the operator sees another (release), they never
contradict each other because they're sourced separately.

## Force redeploy when necessary

If you truly need to force a rolling update without changing the
image (e.g. clearing a bad env var):

```bash
cdk deploy --force <stack>
# or change a non-image env var (timestamped or flag) so the task
# definition rev changes; image tag remains content-hashed.
```

Never fabricate an image change to get a rolling update.

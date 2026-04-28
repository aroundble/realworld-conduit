# BP — ECR image asset hash, not manual tags

**Catalog ref**: docs/14-bp-catalog.md §10.
**Level**: mandatory.

## Why

Setting `IMAGE_TAG=20260425` (or any timestamp/semver-ish string
manually) forces the CDK deployer to think the image changed, even
when the contents are identical. Result: every service rolls,
latency spikes, budget burns, cache warmth is lost — on every deploy.

CDK's `EcrImage` construct computes a content hash from the build
context and uses that as the tag. When nothing changes, nothing
rolls. When one service's Dockerfile changes, only that service
rolls.

## Rule

- Use `EcrImage.fromAsset(path)` or equivalent. Never pass a
  user-specified `tag:` argument for runtime images.
- Build-time overrides (`IMAGE_TAG=...` env) are forbidden in every
  environment including CI. Remove from `.env*`, GitHub Actions
  workflow env, and any deploy scripts.

## Pattern (CDK, TypeScript)

```ts
// good
const apiImage = new ecs_assets.DockerImageAsset(this, 'ApiImage', {
  directory: path.join(__dirname, '..', '..', 'services', 'api'),
});

const taskDef = new ecs.FargateTaskDefinition(this, 'Task');
taskDef.addContainer('api', {
  image: ecs.ContainerImage.fromDockerImageAsset(apiImage),
  // ...
});
```

```ts
// bad — never do this
const apiImage = ecs.ContainerImage.fromRegistry(
  `${accountId}.dkr.ecr.${region}.amazonaws.com/api:${process.env.IMAGE_TAG}`,
);
```

## Checks

- `grep -r 'IMAGE_TAG' infra/ .github/` — expect zero hits outside
  of comments warning against it.
- CDK diff after a no-op change should show nothing, not an ECS
  service update.
- A single-file change should roll only that service, not all.

## Common mistakes

- "I want to force redeploy" → use `cdk deploy --force` or change a
  non-image env var. Don't fake an image change.
- "I need a release tag for tracking" → use git tags or CloudWatch
  dimensions, not ECR tags.

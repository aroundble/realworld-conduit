---
name: env-config-matrix
origin: githarness (distilled from Heimdal)
---

One config file per environment (`infra/config/<env>.yaml`), one
loader, no direct `process.env.X` outside the loader. Rule:
`docs/bp/env-config-matrix.md`.

## Directory layout

```
infra/
  config/
    local.yaml
    dev.yaml
    staging.yaml
    prod.yaml
  lib/
    config-loader.ts            # single resolver
```

## Sample YAML

```yaml
environmentCode: dev
domain: dev.example.com
auth:
  mode: sdk
  cognitoPoolId: us-west-2_abc
  cognitoClientId: xxx
database:
  url: "{from-secrets-manager: <project>/dev/db-url}"
featureFlags:
  negcacheEnabled: true
```

## Loader skeleton (TypeScript)

```ts
import * as fs from 'fs';
import * as yaml from 'yaml';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export async function loadConfig(envName: string) {
  const raw = yaml.parse(fs.readFileSync(`infra/config/${envName}.yaml`, 'utf8'));
  return await resolveSecrets(raw);
}

async function resolveSecrets(node: any): Promise<any> {
  if (node === null || node === undefined) return node;
  if (typeof node === 'string') {
    const m = node.match(/^\{from-secrets-manager:\s*(.+)\}$/);
    if (!m) return node;
    return fetchSecret(m[1]);
  }
  if (Array.isArray(node)) return Promise.all(node.map(resolveSecrets));
  if (typeof node === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = await resolveSecrets(v);
    return out;
  }
  return node;
}
```

## Pre-PR grep (generator DoD)

```bash
grep -rnE 'localhost:[0-9]|(http|https)://[^{]|/home/[a-z]+/' <changed-files>
# must be empty; any hit goes into either config or env var
```

## Anti-patterns

- `if (env === 'prod') useDifferentCode();` — branch behavior via
  config values, not env comparisons.
- `const apiUrl = 'http://localhost:3000';` — config lookup.
- `process.env.API_URL` scattered in 50 files — one resolver, type
  exported.

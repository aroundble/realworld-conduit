// Emits the OpenAPI 3.1 spec for the Conduit API to stdout.
//
// Used by `pnpm openapi:emit` → writes the snapshot to
// `docs/openapi-snapshot.json`. The CI drift job runs the emit and
// `git diff --exit-code` against the committed snapshot; a schema
// change without a snapshot refresh fails the PR.
//
// Boots the app via createApp() in-process so no compose stack is
// needed. Env-independent output: the `servers:` URL is pinned to
// localhost so CI environments don't leak into the snapshot.

import { createApp } from "../app.js";

// Pin the server URL for snapshot stability so the emit is
// deterministic regardless of local OPENAPI_HOST.
process.env.OPENAPI_HOST = "http://localhost:3001";

const app = createApp();
const doc = app.getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "RealWorld Conduit API",
    version: process.env.npm_package_version ?? "0.0.0",
    description:
      "RealWorld spec-conformant API. Routes are added per feature.",
  },
  servers: [
    { url: "http://localhost:3001", description: "API host" },
  ],
});

process.stdout.write(JSON.stringify(doc, null, 2) + "\n");

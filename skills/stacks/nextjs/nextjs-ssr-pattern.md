---
name: nextjs-ssr-pattern
description: Use when building or reviewing a Next.js App Router feature. Covers SSR + BFF proxy patterns, server vs client component boundaries, auth on server components, route-level caching, static vs dynamic rendering.
---

# Skill — Next.js SSR Frontend Pattern for githarness

A pattern for the **generator** session when the target stack has
Next.js (App Router, SSR) as the frontend. Enforces the "E2E exercises
the real user path" rule from CLAUDE.md.

## The shape we recommend

```
ui/
  src/
    app/
      layout.tsx           # root layout — SSR
      page.tsx             # landing — SSR
      (marketing)/         # route group for public pages
      (authenticated)/     # route group for signed-in app
        layout.tsx         # checks session in server component,
                           # redirects if absent
        dashboard/page.tsx
      (portal)/            # route group for second-tier app
      api/                 # server-side API routes (auth-aware)
        auth/
          login/route.ts
          logout/route.ts
          session/route.ts
        proxy/             # BFF — proxies to backend services
          backend/[...path]/route.ts
    lib/
      session.ts           # iron-session or next-auth wrappers
      rpc.ts               # typed client for BFF calls
      auth-guards.ts       # checkAuth(), requireRole()
    components/
  next.config.js           # output: 'standalone' for Docker, not 'export'
  Dockerfile
  package.json
```

## Why SSR, not static export

- **Session state is server-side**. Redirecting an unauthenticated
  request to `/login` should happen before the client gets any HTML
  back — `redirect()` from a server component does this cleanly.
- **Secrets stay on the server**. A BFF route (`/api/proxy/backend/...`)
  can hold a backend service credential that the browser never sees.
- **Feature flags respect auth**. Server-rendered content can
  conditionally include features based on role, without shipping the
  feature code to users who don't have access.
- **E2E tests exercise what users hit**. Tests go through the real
  SSR routes, the real auth middleware, the real proxy — not internal
  backend endpoints.

## The BFF proxy pattern

The client never talks to the backend service directly. All traffic
goes through a Next.js API route that:

1. Validates the session.
2. Injects the backend auth header (API key from env, or short-lived
   JWT minted server-side).
3. Forwards to the backend.
4. Returns the response.

Minimal example:

```typescript
// src/app/api/proxy/backend/[...path]/route.ts
import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const path = params.path.join("/");
  const url = `${process.env.BACKEND_INTERNAL_URL}/${path}${req.nextUrl.search}`;
  const upstream = await fetch(url, {
    headers: {
      "x-api-key": process.env.BACKEND_API_KEY!,
      "x-user-id": session.userId,
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}
// repeat for POST, PUT, DELETE as your backend needs.
```

E2E tests hit `GET /api/proxy/backend/something`, not the backend
directly. This is the "E2E exercises real user path" rule in practice.

## Authentication

Recommended stack:

- **iron-session** for simple cookie-based sessions (stateless, AES-
  GCM encrypted). Server-side only.
- **NextAuth.js** if OAuth providers are needed (Google, GitHub,
  Cognito).
- **Custom OAuth** if the project has its own IdP (Cognito with
  custom flows, AWS IAM Identity Center).

Rules for any choice:

- Session cookie is `httpOnly`, `secure` in production, `sameSite:
  'lax'`.
- Session secret is a 32+ byte random string, fetched from env or
  Secrets Manager.
- Session expires in hours-to-days, not weeks. Re-auth on expiry.
- Role information (admin, user, developer) travels in the session,
  server-side.

## Layouts and redirects

Prefer route-group-scoped layouts over conditional rendering in the
root layout:

```typescript
// src/app/(authenticated)/layout.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function AuthenticatedLayout({
  children,
}: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}
```

Every route inside `(authenticated)/` is now guarded. Unauthenticated
users are redirected at the server before any client JS runs. This is
cleaner than a `useEffect` auth check.

## Feature flags

Server-side feature flag evaluation is cheap and invisible to the
user. A typical implementation:

```typescript
// src/lib/features.ts
export async function featureEnabled(
  session: Session | null,
  flag: string
): Promise<boolean> {
  if (flag === "new-dashboard") {
    return session?.role === "admin" || process.env.NEW_DASHBOARD === "on";
  }
  // ...
  return false;
}

// src/app/(authenticated)/dashboard/page.tsx
import { featureEnabled } from "@/lib/features";

export default async function Dashboard() {
  const session = await getSession();
  const useNew = await featureEnabled(session, "new-dashboard");
  return useNew ? <NewDashboard /> : <LegacyDashboard />;
}
```

Flags can be env-driven for environment-wide on/off, or session-
driven for user-specific rollouts. Either way, the decision happens
server-side.

## Docker packaging

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build   # next.config.js must have output: 'standalone'

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV NODE_ENV=production
CMD ["node", "server.js"]
```

The `output: 'standalone'` build produces a minimal tree that runs
with just `node server.js`. No need to ship `node_modules`.

## E2E discipline

Tests must:

1. Run against the full stack (SSR + BFF + backend), not individual
   layers.
2. Use the real auth flow (login request, session cookie, session-
   aware requests).
3. Exercise the same URLs a real user hits (`/dashboard`, not
   `/api/proxy/backend/dashboard-data`).

Example suite layout:

```
tests/
  e2e/
    run.sh                 # entry point, picks up env from .env
    helpers.py             # login(), authenticated_get(), etc
    test_landing.py
    test_login.py
    test_dashboard.py
    test_api_flow.py
  unit/                    # pytest / vitest / etc
  integration/             # backend-only, fewer, deeper
```

The generator's pre-PR checklist:

- [ ] `docker compose up -d --build` local stack green
- [ ] `./tests/e2e/run.sh --skip-compose` passes
- [ ] No new test bypasses the SSR proxy

## Performance hygiene

- Use `Server Components` by default. Move to `"use client"` only
  when you need state or event handlers.
- Stream large responses with `Suspense` boundaries. Don't block the
  whole page on a slow upstream.
- Cache SSR responses with `revalidate` or `unstable_cache` when
  contents don't depend on session. Measure cache hit rate.
- Image optimization via `next/image`. Don't serve raw images from
  `/public/` for hot paths.

## The evaluator's review questions for an SSR PR

1. Does the PR route traffic through a BFF proxy, or does it open a
   direct path from browser to backend?
2. Are new pages under the correct route group (authenticated vs.
   public)?
3. Are session checks in layouts, not scattered in components?
4. Are feature flags evaluated server-side, or leaked in client code?
5. Did the PR author add E2E through the real user path?
6. Are secrets accessed only in server components / API routes,
   never referenced in `"use client"` files?

Any "no" on 1, 2, 3, 4, 6 is a request-changes signal. "No" on 5 is
a block.

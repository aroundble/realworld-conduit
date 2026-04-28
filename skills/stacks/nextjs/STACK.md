# Stack — Next.js

Enable this stack for projects using Next.js (App Router) as
the frontend framework.

## Skills in this stack

| Skill | Who reads | What it covers |
|---|---|---|
| [nextjs-ssr-pattern.md](nextjs-ssr-pattern.md) | generator | SSR + BFF proxy pattern, auth handling on server components, route-level caching, static vs. dynamic rendering. |

## MCP server wired by this stack

`next-devtools-mcp@latest` — provides live access to Next.js
runtime diagnostics (route tree, component boundaries,
hydration issues). Auto-approved tools are empty by default;
the operator can add specific tools after the first run.

## When to enable

Enable this stack if the project:

- Has a Next.js frontend (any version, App Router).
- Is about to start one.

Do **not** enable if the project:

- Is backend-only.
- Uses a different React framework (Remix, Astro, pure Vite +
  React) — no stack ships for those yet.

## Related

- [`skills/for-generator/reproducible-local-environment.md`](../../for-generator/reproducible-local-environment.md)
  — how the Next.js dev server runs inside the project's
  reproducible environment.
- [`skills/for-generator/portable-environment-values.md`](../../for-generator/portable-environment-values.md)
  — Next.js-specific gotchas like `NEXT_PUBLIC_*` leaks.

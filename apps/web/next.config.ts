import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin wire (#167a). Reads src/i18n/request.ts on
// every server render to resolve locale + message bundle. The
// explicit request path keeps tsconfig path aliases working
// against the plugin's static analysis step.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Baseline security headers (#124). Emitted on every page + route
// response. Rationale + tuning guidance in docs/security-headers.md.
//
// HSTS is only attached when ENFORCE_HSTS=true — local dev runs on
// plain HTTP, and a max-age HSTS pin on localhost would lock the
// browser into treating http://localhost as HTTPS-only for 2 years.
//
// CSP stance: moderate. Next.js's runtime requires `'unsafe-inline'`
// for its bootstrap scripts + inline styles until a nonce-based
// pipeline lands (follow-up, see docs). The `connect-src` pulls
// `NEXT_PUBLIC_API_URL` so the browser can reach the API regardless
// of host/port per env (compose maps 3101 → 3001 inside the
// container, for instance).
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const hstsEnabled = process.env.ENFORCE_HSTS === "true";

const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${apiUrl}`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const baseHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
];

const hstsHeader = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
};

const securityHeaders = hstsEnabled
  ? [...baseHeaders, hstsHeader]
  : baseHeaders;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";

// Baseline security headers (#124). Wraps `hono/secure-headers` with
// tuned defaults that match what a Level-2 production API is
// expected to surface on every response (mozilla/observatory B+):
//
//   X-Content-Type-Options: nosniff
//   X-Frame-Options: DENY
//   Referrer-Policy: strict-origin-when-cross-origin
//   Permissions-Policy: camera=(), geolocation=(), microphone=()
//
// HSTS is OFF by default because local dev + the CI compose stack
// run on plain HTTP. Set `ENFORCE_HSTS=true` in any env that
// terminates TLS (staging/prod) to emit the 2-year preload header.
//
// Hono's secure-headers module sets several additional headers
// (Cross-Origin-*-Policy, Origin-Agent-Cluster, etc.) that are safe
// for a JSON API; we let those through with defaults. `x-xss-protection`
// default value of `0` is kept — modern browsers ignore it and `1;
// mode=block` is actively harmful with a strict CSP.

const hstsEnabled = process.env.ENFORCE_HSTS === "true";

export const securityHeaders = (): MiddlewareHandler =>
  secureHeaders({
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: {
      camera: [],
      geolocation: [],
      microphone: [],
    },
    strictTransportSecurity: hstsEnabled
      ? "max-age=63072000; includeSubDomains; preload"
      : false,
  });

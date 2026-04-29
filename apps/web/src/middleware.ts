import { NextResponse, type NextRequest } from "next/server";

// Runs before every matched route. Mints (or reuses) an X-Request-ID
// per incoming browser request and makes it visible both to the
// server (via request headers that `next/headers` exposes) and to the
// browser (via the response header). Downstream server-side fetches
// read the same id via `next/headers` and forward it to the api, so
// one browser request = one id shared across every api log line it
// produces.
//
// `crypto.randomUUID()` is part of the Next.js Edge runtime; no polyfill.
export const middleware = (req: NextRequest): NextResponse => {
  const existing = req.headers.get("x-request-id");
  const requestId = existing && existing.length > 0 ? existing : crypto.randomUUID();

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-request-id", requestId);

  const res = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  res.headers.set("x-request-id", requestId);
  return res;
};

// Skip the usual static asset paths. Healthz is included so the id
// lands on web's own log too (future-proofing for when web logs land).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

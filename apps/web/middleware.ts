import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

// Composite middleware (#167a + #25). Two responsibilities:
//   1. Mint / forward X-Request-ID so one browser request maps to
//      one id across every downstream server + api log line
//      (pre-existing #25 floor).
//   2. Locale routing via next-intl (#167a): Accept-Language +
//      conduit-locale cookie drive URL-prefix detection.
//
// Implementation note: we can't re-construct the incoming request
// to inject the request-id (NextRequest has private fields that
// next-intl uses internally). Instead we set the header on the
// forwarded request via NextResponse.next({request:{headers}})
// semantics, and layer the id on next-intl's returned response.
// That order matters — next-intl inspects the inbound headers
// to resolve the locale, so the id has to be on the ORIGINAL
// request headers (which we can mutate in-place; headers is a
// live Headers instance on NextRequest).

const intlMiddleware = createMiddleware(routing);

const middleware = (req: NextRequest) => {
  const existing = req.headers.get("x-request-id");
  const requestId =
    existing && existing.length > 0 ? existing : crypto.randomUUID();
  req.headers.set("x-request-id", requestId);

  const res = intlMiddleware(req);
  if (res instanceof Response) {
    res.headers.set("x-request-id", requestId);
    return res;
  }
  return NextResponse.next({
    request: { headers: req.headers },
    headers: { "x-request-id": requestId },
  });
};

export default middleware;

export const config = {
  // Match every path except Next internal routes, API proxies, and
  // static assets. next-intl's docs recommend this matcher shape —
  // catch-all with explicit exclusions for paths that should NOT
  // carry a locale prefix (RSS feeds, manifest, sitemap, robots,
  // static asset icons).
  matcher: [
    "/((?!_next|_vercel|api|icons|manifest\\.webmanifest|sw\\.js|robots\\.txt|sitemap\\.xml|rss\\.xml|rss/|healthz|uploads|.*\\..*).*)",
  ],
};

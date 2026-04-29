import "server-only";
import { cookies } from "next/headers";

// Server-only session helpers.
//
// Two cookies are in play:
//   - `conduit_session` (HttpOnly) — JWT carried inbound on every API
//     request, set by the API. The web server receives it in the
//     `Set-Cookie` response header and re-emits it to the browser on
//     the web origin so future requests carry it.
//   - `conduit-user` (readable server-side via `cookies()`) — small
//     JSON blob `{ username, image }` the Navbar reads to render the
//     authed chrome. It is not a credential, purely presentation.
//
// Keeping `conduit_session` HttpOnly means the web server is the only
// place that touches the raw JWT. That matches ADR 004's cookie-first
// transport posture end-to-end.

export const SESSION_COOKIE = "conduit_session";
export const USER_COOKIE = "conduit-user";

// The API response carries one or more `Set-Cookie` headers. We only
// need the conduit_session value + its Max-Age; attributes (HttpOnly,
// SameSite, Path, Secure, Domain) are set deterministically by the web
// layer based on its own env (WEB_COOKIE_SECURE / COOKIE_DOMAIN). That
// way the web origin doesn't accidentally inherit the API's domain
// attribute when they live on different hostnames.
const parseSessionCookie = (
  setCookie: string[],
): { value: string; maxAge: number } | null => {
  for (const raw of setCookie) {
    const [kv, ...attrs] = raw.split(";").map((s) => s.trim());
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const name = kv.slice(0, eq);
    const value = kv.slice(eq + 1);
    if (name !== SESSION_COOKIE) continue;
    let maxAge = 604800;
    for (const attr of attrs) {
      const [k, v] = attr.split("=");
      if (k?.toLowerCase() === "max-age" && v) {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) maxAge = n;
      }
    }
    return { value, maxAge };
  }
  return null;
};

type UserForNav = { username: string; image: string | null };

const cookieSecure = process.env.COOKIE_SECURE === "true";
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

export const writeSession = async (
  setCookie: string[],
  user: UserForNav,
): Promise<void> => {
  const session = parseSessionCookie(setCookie);
  if (!session) {
    throw new Error("API did not set conduit_session cookie");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
    domain: cookieDomain,
  });
  jar.set(
    USER_COOKIE,
    encodeURIComponent(
      JSON.stringify({ username: user.username, image: user.image }),
    ),
    {
      httpOnly: false,
      secure: cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: session.maxAge,
      domain: cookieDomain,
    },
  );
};

export const readSessionCookie = async (): Promise<string | null> => {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
};

export const isAuthenticated = async (): Promise<boolean> => {
  const jar = await cookies();
  // Either cookie is enough to treat the viewer as authed for redirect
  // purposes; the API will reject forged tokens on its own.
  return Boolean(jar.get(SESSION_COOKIE)?.value || jar.get(USER_COOKIE)?.value);
};

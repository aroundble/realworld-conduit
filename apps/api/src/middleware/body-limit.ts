import { bodyLimit } from "hono/body-limit";
import type { Context, MiddlewareHandler } from "hono";

// Request body-size caps (#126). DoS shield for the API — a client
// cannot make us allocate multi-megabyte buffers just by POSTing a
// large body. Two tiers: a global cap applies to every mutating
// endpoint, a smaller per-endpoint cap layers on top for article
// create/update (the largest legitimate payloads, but still bounded).
//
// The 413 envelope matches the rest of the spec's error shape so
// clients (Bruno conformance, Playwright, RealWorld reference UIs)
// all parse errors the same way.

const DEFAULT_GLOBAL_KB = 1024;
const DEFAULT_ARTICLE_KB = 100;

const parseKb = (env: string | undefined, fallback: number): number => {
  const n = env ? Number.parseInt(env, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const globalBodyLimitKb = parseKb(
  process.env.API_BODY_LIMIT_GLOBAL_KB,
  DEFAULT_GLOBAL_KB,
);

export const articleBodyLimitKb = parseKb(
  process.env.API_BODY_LIMIT_ARTICLE_KB,
  DEFAULT_ARTICLE_KB,
);

const tooLargeEnvelope = (limitKb: number) => ({
  errors: { body: [`payload too large, max ${limitKb}KB`] },
});

// Rejecting an oversized request before the body is consumed leaves
// the rest of the upload bytes buffered on a keep-alive socket. The
// next request on the same connection then gets mis-framed (Node's
// HTTP parser treats the leftover bytes as the start of a new
// request). Playwright/undici surfaces this as `socket hang up`;
// curl without keep-alive dodges it because the connection closes
// anyway. Set `Connection: close` on the 413 so the client (and the
// server's own HTTP parser) tears down the socket cleanly after the
// response flushes.
const tooLargeResponse = (c: Context, limitKb: number) => {
  c.header("Connection", "close");
  return c.json(tooLargeEnvelope(limitKb), 413);
};

// Global cap — wired at app.use("*", …). Applies to every request
// with a body; GETs have no body so the hono/body-limit middleware
// short-circuits before doing any work.
export const globalBodyLimit = (): MiddlewareHandler =>
  bodyLimit({
    maxSize: globalBodyLimitKb * 1024,
    onError: (c) => tooLargeResponse(c, globalBodyLimitKb),
  });

// Per-endpoint cap for article create/update. Article `body` is
// Markdown prose — 100 KB is roughly 50 pages of text, which is an
// order of magnitude above realistic long-form writing. Anything
// bigger is either a mistake or abuse.
export const articleBodyLimit = (): MiddlewareHandler =>
  bodyLimit({
    maxSize: articleBodyLimitKb * 1024,
    onError: (c) => tooLargeResponse(c, articleBodyLimitKb),
  });

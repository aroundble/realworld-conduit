// Minimal fetch wrapper for server-side API calls.
//
// Pattern adapted from yukicountry/realworld-nextjs-rsc @ f455599f
// (`src/utils/api/client.ts`, MIT) — we keep the "fetch JSON, return
// envelope" shape but strip the runtime-validated zod parsing for now.
// The wrapper is server-only: `API_URL` points at the internal
// container hostname (`http://api:3001` inside compose), which must
// not leak into the browser bundle.
//
// Response shape is intentionally raw — the API's envelope
// (`{ user }` / `{ errors }`) is what the caller asserts against,
// so the wrapper stays schema-agnostic.

import "server-only";

export type ApiResult<T> =
  | { ok: true; status: number; data: T; setCookie: string[] }
  | { ok: false; status: number; data: { errors?: Record<string, string[]> }; setCookie: string[] };

const API_URL = process.env.API_URL ?? "http://localhost:3001";

// Node's fetch collapses multiple Set-Cookie headers into a single
// comma-joined string on `headers.get("set-cookie")`. `getSetCookie`
// is the Node 20+ / undici way to get them as a proper list.
const readSetCookie = (headers: Headers): string[] => {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") {
    return h.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
};

export const apiFetch = async <T>(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<ApiResult<T>> => {
  const { cookie, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (cookie) headers.set("cookie", cookie);

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    cache: "no-store",
  });

  const text = await res.text();
  const data = text.length > 0 ? JSON.parse(text) : {};
  const setCookie = readSetCookie(res.headers);

  if (!res.ok) {
    return { ok: false, status: res.status, data, setCookie };
  }
  return { ok: true, status: res.status, data: data as T, setCookie };
};

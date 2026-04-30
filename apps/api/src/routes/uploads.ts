import type { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { requireAuth, type UserVars } from "../middleware/jwt-cookie.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type { UploadResponse } from "../schemas/upload.js";
import {
  UploadError,
  contentTypeForFilename,
  extForMime,
  getUploadAdapter,
  isAllowedFilename,
} from "../services/uploads.service.js";

type UploadVars = AppEnv["Variables"] & UserVars;
type UploadEnv = { Variables: UploadVars };

const jsonError = (field: string, detail: string) => ({
  errors: { [field]: [detail] },
});

// Same empty-string guard as ALLOWED_MIME — compose's
// `${VAR:-}` substitution materialises unset vars as "" not
// undefined, so `?? 2097152` alone would become parseInt("", 10)
// → NaN → the bodyLimit gate always rejects.
const parseMaxBytes = (raw: string | undefined): number => {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return 2097152;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : 2097152;
};
const MAX_AVATAR_BYTES = parseMaxBytes(process.env.MAX_AVATAR_BYTES);

const DEFAULT_ALLOWED_MIME = "image/jpeg,image/png,image/webp";
// Compose passes `AVATAR_ALLOWED_MIME: ${AVATAR_ALLOWED_MIME:-}` which
// materialises as an empty string when the operator leaves the env
// unset. `??` only catches undefined, so an empty-string override
// would collapse the allowlist to `[""]` and reject every upload.
// Treat empty-string as "use default" to match compose semantics.
const ALLOWED_MIME_ENV = (
  process.env.AVATAR_ALLOWED_MIME && process.env.AVATAR_ALLOWED_MIME.trim()
    ? process.env.AVATAR_ALLOWED_MIME
    : DEFAULT_ALLOWED_MIME
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const tooLargeEnvelope = (limitBytes: number) => ({
  errors: { file: [`payload too large, max ${limitBytes} bytes`] },
});

const tooLargeResponse = (c: Context, limitBytes: number) => {
  // Same Connection: close pattern as the global body-limit (#126).
  // A 413 mid-multipart leaves undecoded bytes buffered on a
  // keep-alive socket which mis-frames the next request.
  c.header("Connection", "close");
  return c.json(tooLargeEnvelope(limitBytes), 413);
};

// Per-endpoint body-limit — overrides the global 1MB cap because
// avatars are legitimately up to 2MB. Mounted BEFORE requireAuth
// so a bot sending a 10GB body gets a 413 before we ever decode
// the multipart header or touch the DB.
const avatarBodyLimit = (): MiddlewareHandler =>
  bodyLimit({
    maxSize: MAX_AVATAR_BYTES,
    onError: (c) => tooLargeResponse(c, MAX_AVATAR_BYTES),
  });

const UPLOAD_PATH = "/api/uploads/avatar";

export const registerUploadRoutes = (app: OpenAPIHono<AppEnv>): void => {
  const authed = app as unknown as OpenAPIHono<UploadEnv>;

  // Middleware order: body-limit → requireAuth → rate-limit →
  // handler. body-limit first so oversized payloads don't even
  // trigger a DB/session-lookup auth round-trip; requireAuth next
  // so anonymous abuse doesn't exhaust the per-user rate-limit
  // buckets.
  //
  // This route uses `app.post()` instead of the OpenAPI
  // `createRoute` + `openapi()` flow because @hono/zod-openapi's
  // multipart body validation on the Node adapter rejects any
  // schema that uses `z.any()` for the file field — it runs the
  // zod parse on the undecoded Request and 422s. We declare the
  // endpoint in the OpenAPI doc manually (below in the registrar)
  // so the Scalar reference still shows the shape.
  authed.use(UPLOAD_PATH, avatarBodyLimit());
  authed.use(UPLOAD_PATH, requireAuth());
  authed.use(
    UPLOAD_PATH,
    rateLimit({
      bucket: "uploads:avatar",
      limit: 10,
      windowSec: 300,
      keyBy: "user",
      methods: ["POST"],
    }),
  );

  authed.post(UPLOAD_PATH, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("token", "is missing"), 401);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(jsonError("file", "multipart parse failed"), 422);
    }
    const maybeFile = form.get("file");
    if (!(maybeFile instanceof File)) {
      return c.json(jsonError("file", "is required"), 422);
    }
    const file = maybeFile;

    if (file.size === 0) {
      return c.json(jsonError("file", "is empty"), 422);
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return tooLargeResponse(c, MAX_AVATAR_BYTES);
    }
    const mime = file.type?.toLowerCase() ?? "";
    if (!ALLOWED_MIME_ENV.includes(mime)) {
      return c.json(
        jsonError(
          "file",
          `unsupported type (allowed: ${ALLOWED_MIME_ENV.join(", ")})`,
        ),
        422,
      );
    }
    const ext = extForMime(mime);
    if (!ext) {
      return c.json(jsonError("file", "unsupported type"), 422);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const stored = await getUploadAdapter().save(buffer, ext);
      const payload: UploadResponse = {
        url: `/uploads/${stored.filename}`,
        width: stored.width,
        height: stored.height,
      };
      return c.json(payload, 201);
    } catch (err) {
      if (err instanceof UploadError) {
        if (err.status === 413) return tooLargeResponse(c, MAX_AVATAR_BYTES);
        return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });

  // Static file serving for /uploads/<filename>. Mounted outside
  // the OpenAPI router because this is asset delivery, not product
  // API. `Cache-Control: public, max-age=31536000, immutable` is
  // safe because filenames are content-hashed — identical bytes
  // always map to the same URL, so the client can cache forever.
  app.get("/uploads/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (!isAllowedFilename(filename)) {
      return c.json({ errors: { file: ["not found"] } }, 404);
    }
    try {
      const bytes = await getUploadAdapter().read(filename);
      // Return a plain Response — Hono's c.body() generics are
      // strict about ArrayBuffer vs ArrayBufferLike and refuse a
      // raw Node Buffer. Response itself accepts BodyInit which
      // covers both without the narrowing.
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": contentTypeForFilename(filename),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return c.json({ errors: { file: ["not found"] } }, 404);
    }
  });
};

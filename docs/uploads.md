# Avatar uploads (#169)

Users upload profile avatars from their device at `/settings`. The text URL field stays editable so users with externally-hosted avatars still paste a link; the local upload widget lands a POST at the API's `/api/uploads/avatar` endpoint and populates the same `image` field with the served URL.

## API

`POST /api/uploads/avatar` (multipart/form-data)

Request: a single form field named `file` containing an image (JPEG / PNG / WebP, 64×64–2048×2048, ≤ 2 MB).

Response (201):
```json
{
  "url": "/uploads/<sha256[0:16]>.<ext>",
  "width": 300,
  "height": 300
}
```

Errors (canonical `{ "errors": { field: [message] } }` envelope):
- **401** — no session cookie.
- **413** — body exceeds `MAX_AVATAR_BYTES` (default 2 MB). Sent with `Connection: close` so the mid-upload abort doesn't mis-frame the next request on the keep-alive socket (same pattern as #126).
- **422** — unsupported MIME, image dimension outside 64×64–2048×2048, decode failure, empty file.
- **429** — rate limit (10 per user per 5 minutes, `uploads:avatar` bucket).

## Content-hashed filenames

Filenames are `<sha256[0:16]>.<ext>` derived from the **re-encoded** (post-sharp) bytes, not the upload. Two invariants follow:

1. **Dedupe**: two identical uploads hash to the same filename. The second upload skips the disk write and returns the same URL.
2. **Immutable URL**: content is bound to filename. The static handler can safely set `Cache-Control: public, max-age=31536000, immutable` with zero risk of stale content.

## EXIF strip

Every uploaded image passes through `sharp(...).rotate()` → re-encode. `rotate()` bakes any EXIF orientation tag into the pixels before the tag is dropped. `.withMetadata()` is deliberately NOT called — that would preserve EXIF including GPS coordinates. A user uploading a phone selfie must not accidentally publish their home address.

## Static serving

`GET /uploads/<filename>` streams bytes from disk (or cloud in the future adapter) with:
- `Content-Type` inferred from extension
- `Cache-Control: public, max-age=31536000, immutable`
- Filename strictly validated as `^[a-f0-9]+\.(jpg|jpeg|png|webp)$` — anything with `..`, `/`, or `\` is rejected 404 so path-traversal URLs can't escape the uploads directory.

## OpenAPI documentation — known gap

The upload endpoint uses `authed.post()` rather than the `@hono/zod-openapi` `createRoute()` flow because the library's multipart body validation on the Node adapter rejects any schema that uses `z.any()` for the file field. The Scalar reference at `/api/docs` does NOT show this endpoint. The PR body documents the shape; future follow-up could add a manual OpenAPI `pathItem` entry to `app.doc()` so Scalar picks it up.

## Adapter interface

```ts
type UploadAdapter = {
  save: (buffer: Buffer, ext: string) => Promise<StoredFile>;
  read: (filename: string) => Promise<Buffer>;
};
```

Only `LocalFileAdapter` (disk-based, writes to `UPLOAD_LOCAL_DIR`) is implemented. An `S3Adapter` lands in a follow-up Level-3 issue; the route layer never changes — it calls `getUploadAdapter()` which branches on `UPLOAD_BACKEND`.

## Compose volume

The API service mounts a named `uploads` volume at `/app/uploads`. The Dockerfile pre-creates that directory + chowns it to the `hono` user so the volume bind doesn't land on a root-owned target (which would EACCES the first POST).

## Environment variables

- `UPLOAD_BACKEND` — `local` (default) / `s3` (future).
- `UPLOAD_LOCAL_DIR` — default `uploads` (relative) / `/app/uploads` (in compose).
- `MAX_AVATAR_BYTES` — default `2097152` (2 MB).
- `AVATAR_ALLOWED_MIME` — comma-separated, default `image/jpeg,image/png,image/webp`.

All four treat **empty string** as "use default" — compose's `${VAR:-}` substitution materialises unset variables as `""` not `undefined`, and a naive `?? default` wouldn't catch that.

## Web UI

`apps/web/src/features/auth/AvatarUpload.tsx` renders next to the image-URL field in `SettingsForm`. Flow:

1. User picks a file via `<input type="file" accept="image/*">`.
2. Client-side check: MIME in allowlist, size ≤ 2 MB. Failures surface in an inline `role="alert"` without contacting the server.
3. `fetch()` POSTs multipart to `${NEXT_PUBLIC_API_URL}/api/uploads/avatar` with `credentials: "include"` so the session cookie rides along.
4. On success, the widget:
   - Sets `preview` state → `<img>` renders with the served URL.
   - Writes the URL into the sibling text input via the native HTML setter + `input` event (React otherwise swallows programmatic `.value` writes on controlled inputs).
5. The user clicks "Update Settings" to persist the URL to their profile via the existing `updateUserAction`.

## Out of scope (follow-up issues)

- **S3 / R2 adapter** — the interface is ready; the impl is a Level-3 issue because it adds cloud config + IAM.
- **Image resizing / variants** — store the original; consumers can add thumbnail-generation later.
- **Virus scanning (ClamAV)** — Level-3 security issue.
- **Content moderation / NSFW detection** — Level-3 trust-and-safety issue.

## Verification

```sh
pnpm test:e2e tests/e2e/specs/169-web-avatar-upload.spec.ts
```

10 scenarios:

1. Anonymous upload → 401.
2. Authed JPG → 201 with URL + dimensions.
3. Re-upload of identical bytes → same URL (content-hash dedupe).
4. Wrong MIME (text/plain) → 422.
5. Too-small image (32×32) → 422.
6. Served file carries `Cache-Control: immutable` + `max-age=31536000`.
7. Path-traversal URL → 404 / 422.
8. Settings UI: upload → preview appears, image field populates with same URL.
9. Settings UI: non-image file → inline error, no preview, no server call.
10. axe a11y passes on settings with the preview visible.

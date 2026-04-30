import { createHash } from "node:crypto";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import sharp from "sharp";

// Avatar upload service (#169). Single-backend today (local disk);
// future S3 / R2 adapter implements the same `UploadAdapter`
// interface so the route layer never changes.
//
// Content-hashing rationale: a filename of `<sha256[0:16]>.<ext>`
// gives us two wins — (1) identical re-uploads dedupe to the same
// file (no duplicate bytes on disk for the same avatar), and
// (2) the URL is immutable, which lets us set `Cache-Control:
// immutable` on the static response with zero risk of stale
// content. A sequential id would force Cache-Control: max-age +
// ETag dance for the same privacy-of-content guarantee.

export type StoredFile = {
  // Canonical filename relative to the upload root, e.g.
  // "abc123…def.jpg". Callers prepend `/uploads/` to build the URL.
  filename: string;
  // Image dimensions (sharp-decoded). Useful for clients to render
  // preview without a round-trip.
  width: number;
  height: number;
  // Bytes on disk after re-encode + EXIF strip (may differ from
  // the upload size because sharp drops metadata).
  bytes: number;
};

export type UploadAdapter = {
  save: (buffer: Buffer, ext: string) => Promise<StoredFile>;
  // read is only used by the static-file handler when
  // UPLOAD_BACKEND=local; cloud adapters serve bytes via CDN and
  // never hit this.
  read: (filename: string) => Promise<Buffer>;
};

export class UploadError extends Error {
  constructor(
    public readonly field: string,
    public readonly detail: string,
    public readonly status: 413 | 422,
  ) {
    super(`${field}: ${detail}`);
    this.name = "UploadError";
  }
}

const DEFAULT_LOCAL_DIR = "uploads";

const uploadLocalDir = (): string =>
  resolve(process.env.UPLOAD_LOCAL_DIR ?? DEFAULT_LOCAL_DIR);

// Re-encodes the image via sharp, stripping EXIF + ICC profiles.
// Also enforces the "min 64x64, max 2048x2048" dimension gate from
// the AC — sharp's own metadata read is the source of truth (do
// not trust the client-declared content-type / size).
//
// Returns the cleaned buffer + its dimensions. Throws UploadError
// on validation failure.
const decodeAndStrip = async (
  buffer: Buffer,
  ext: string,
): Promise<{ clean: Buffer; width: number; height: number }> => {
  let image: sharp.Sharp;
  try {
    image = sharp(buffer, { failOn: "error" });
  } catch {
    throw new UploadError("file", "not a decodable image", 422);
  }
  const metadata = await image.metadata().catch(() => null);
  if (
    !metadata ||
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number"
  ) {
    throw new UploadError("file", "image metadata unavailable", 422);
  }
  const { width, height } = metadata;
  if (width < 64 || height < 64) {
    throw new UploadError("file", "image smaller than 64x64", 422);
  }
  if (width > 2048 || height > 2048) {
    throw new UploadError("file", "image larger than 2048x2048", 422);
  }
  // Re-encode through sharp with EXIF stripped. Pass rotate() so
  // if the original had an EXIF orientation tag, the pixels are
  // physically rotated before the tag is dropped (otherwise the
  // saved image would render sideways in clients that don't read
  // EXIF). `.withMetadata()` is NOT called — that preserves EXIF.
  let pipeline = image.rotate();
  if (ext === ".png") {
    pipeline = pipeline.png();
  } else if (ext === ".webp") {
    pipeline = pipeline.webp();
  } else {
    pipeline = pipeline.jpeg({ quality: 92 });
  }
  const clean = await pipeline.toBuffer();
  // Dimensions after rotate() may differ from pre-rotate metadata
  // (the orientation tag might have said "90deg" and we just baked
  // that rotation into the pixels). Re-read so we return truth.
  const finalMeta = await sharp(clean).metadata();
  return {
    clean,
    width: finalMeta.width ?? width,
    height: finalMeta.height ?? height,
  };
};

export const createLocalAdapter = (): UploadAdapter => {
  const root = uploadLocalDir();

  return {
    save: async (buffer: Buffer, ext: string): Promise<StoredFile> => {
      const { clean, width, height } = await decodeAndStrip(buffer, ext);
      const hash = createHash("sha256").update(clean).digest("hex").slice(0, 16);
      const filename = `${hash}${ext}`;
      await mkdir(root, { recursive: true });
      const absPath = join(root, filename);
      // Skip the write if an identical file already exists — the
      // content hash means the bytes are byte-for-byte equal, so
      // re-writing is wasted IO + can momentarily serve partial
      // content if a concurrent read observes the truncate + re-
      // write mid-flight. stat-then-skip is the safer path.
      const exists = await stat(absPath)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        await writeFile(absPath, clean);
      }
      return { filename, width, height, bytes: clean.length };
    },

    read: async (filename: string): Promise<Buffer> => {
      // Filename guard: only accept `<hash>.<ext>`. Reject anything
      // containing path traversal (`..`, `/`, `\`). This defends
      // against a malformed URL trying to escape the uploads dir.
      if (!/^[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
        throw new UploadError("filename", "invalid", 422);
      }
      const absPath = join(root, filename);
      return readFile(absPath);
    },
  };
};

// Extension inferred from the declared MIME type. Kept narrow so a
// client that lies about content-type can't name a .exe.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export const extForMime = (mime: string): string | null =>
  MIME_TO_EXT[mime.toLowerCase()] ?? null;

// Filename sanity on disk reads: filename extension MUST match one
// of the allowed image extensions. Used by the static handler to
// gate what it will try to serve.
export const isAllowedFilename = (filename: string): boolean =>
  /^[a-f0-9]{8,}\.(jpg|jpeg|png|webp)$/i.test(filename);

export const contentTypeForFilename = (filename: string): string => {
  const ext = extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
};

// Single shared adapter. Swapping to s3 in a follow-up is as simple
// as branching on UPLOAD_BACKEND here.
let adapter: UploadAdapter | null = null;
export const getUploadAdapter = (): UploadAdapter => {
  if (!adapter) adapter = createLocalAdapter();
  return adapter;
};

"use client";

import { useRef, useState, useTransition } from "react";

// Avatar upload widget (#169). Renders next to the `image` text
// field in SettingsForm. File-picker → POST to the API's
// /api/uploads/avatar multipart endpoint → writes the returned URL
// into the `image` text input and shows a preview thumbnail. The
// text field stays editable so users with externally-hosted avatars
// still paste a URL.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type Props = {
  // Id of the sibling text input the upload result should populate.
  imageInputId: string;
  // Initial url to preview on first mount (current user's saved
  // avatar). Re-reads from the input as the user types.
  initialUrl: string | null;
};

type UploadResponse = { url: string; width: number; height: number };

export const AvatarUpload = ({ imageInputId, initialUrl }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const writeToSiblingInput = (url: string) => {
    const input = document.getElementById(
      imageInputId,
    ) as HTMLInputElement | null;
    if (!input) return;
    // Use the native setter so React's synthetic listener picks up
    // the change — direct `.value = ...` on a controlled input
    // often gets swallowed by React's VDOM reconciliation.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const upload = (file: File) => {
    setError(null);
    if (!ALLOWED_MIME.has(file.type)) {
      setError("Only JPEG / PNG / WebP images are allowed");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image too large (max 2 MB)");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);

    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/api/uploads/avatar`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
      } catch {
        setError("Upload failed — check your connection");
        return;
      }
      if (!res.ok) {
        const payload = (await res
          .json()
          .catch(() => null)) as { errors?: Record<string, string[]> } | null;
        const flat = payload?.errors
          ? Object.entries(payload.errors)
              .flatMap(([, msgs]) => msgs)
              .join(", ")
          : `Upload failed (${res.status})`;
        setError(flat);
        return;
      }
      const data = (await res.json()) as UploadResponse;
      // The API returns a relative URL like `/uploads/abc.jpg`.
      // Resolve against the API host so <img src> works from the
      // web origin.
      const absoluteUrl = data.url.startsWith("http")
        ? data.url
        : `${API_URL}${data.url}`;
      setPreview(absoluteUrl);
      writeToSiblingInput(absoluteUrl);
    });
  };

  return (
    <div className="avatar-upload">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
        aria-label="Upload avatar image"
        data-testid="avatar-upload-input"
        className="avatar-upload-input"
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Avatar preview"
          className="avatar-upload-preview"
          data-testid="avatar-upload-preview"
          width={64}
          height={64}
        />
      ) : null}
      {isPending ? (
        <span
          className="avatar-upload-status"
          role="status"
          data-testid="avatar-upload-pending"
        >
          Uploading…
        </span>
      ) : null}
      {error ? (
        <span
          className="avatar-upload-error"
          role="alert"
          data-testid="avatar-upload-error"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
};

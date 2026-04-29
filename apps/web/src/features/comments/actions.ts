"use server";

import { apiFetch } from "@/lib/api/client";
import { readSessionCookie, SESSION_COOKIE } from "@/features/auth/session";

// Comment server actions for the article detail page (#18).
//
// postComment returns a discriminated result so CommentForm can
// render inline validation errors (API 422) without bubbling a
// generic exception. deleteComment throws on failure — the client
// component treats any error as "stay put, show the row", which is
// the right UX for a trash-icon click that fails.
//
// Refetch-after-action is driven by the calling client component via
// `router.refresh()` so the ordering is strict (DB write → refresh);
// see #76 for the race this mirrors.

const cookieHeader = async (): Promise<string | undefined> => {
  const token = await readSessionCookie();
  return token ? `${SESSION_COOKIE}=${token}` : undefined;
};

const requireSession = async (): Promise<string> => {
  const cookie = await cookieHeader();
  if (!cookie) {
    throw new Error("unauthenticated");
  }
  return cookie;
};

export type PostCommentResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export const postCommentAction = async (
  slug: string,
  _prev: PostCommentResult | null,
  formData: FormData,
): Promise<PostCommentResult> => {
  const raw = formData.get("body");
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body.length === 0) {
    return { ok: false, errors: ["Comment body can't be empty"] };
  }

  const cookie = await requireSession();
  const res = await apiFetch<unknown>(
    `/api/articles/${encodeURIComponent(slug)}/comments`,
    {
      method: "POST",
      cookie,
      body: JSON.stringify({ comment: { body } }),
    },
  );
  if (!res.ok) {
    const errs = (res.data as { errors?: Record<string, string[]> })?.errors;
    const flat = errs
      ? Object.entries(errs).flatMap(([k, msgs]) => msgs.map((m) => `${k} ${m}`))
      : ["Failed to post comment"];
    return { ok: false, errors: flat };
  }
  return { ok: true };
};

export const deleteComment = async (
  slug: string,
  id: number,
): Promise<void> => {
  const cookie = await requireSession();
  const res = await apiFetch(
    `/api/articles/${encodeURIComponent(slug)}/comments/${id}`,
    { method: "DELETE", cookie },
  );
  if (!res.ok) {
    throw new Error(`deleteComment failed: ${res.status}`);
  }
};

// Edit own comment (#159). Returns a discriminated result so
// the client can surface API validation errors (422, empty / too
// long body) inline rather than throwing. 403 / 404 fall into the
// same "errors" bucket — the client-side Edit button is only
// shown to the owner, so these are edge cases (stale UI where the
// comment was deleted in another tab, or authz tampering).
export type UpdateCommentResult =
  | { ok: true; comment: { body: string; updatedAt: string } }
  | { ok: false; errors: string[] };

export const updateCommentAction = async (
  slug: string,
  id: number,
  body: string,
): Promise<UpdateCommentResult> => {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ["Comment body can't be empty"] };
  }

  const cookie = await requireSession();
  const res = await apiFetch<{ comment: { body: string; updatedAt: string } }>(
    `/api/articles/${encodeURIComponent(slug)}/comments/${id}`,
    {
      method: "PUT",
      cookie,
      body: JSON.stringify({ comment: { body: trimmed } }),
    },
  );
  if (!res.ok) {
    const errs = (res.data as { errors?: Record<string, string[]> })?.errors;
    const flat = errs
      ? Object.entries(errs).flatMap(([k, msgs]) => msgs.map((m) => `${k} ${m}`))
      : ["Failed to update comment"];
    return { ok: false, errors: flat };
  }
  return {
    ok: true,
    comment: {
      body: res.data.comment.body,
      updatedAt: res.data.comment.updatedAt,
    },
  };
};

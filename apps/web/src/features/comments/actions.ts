"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { readSessionCookie, SESSION_COOKIE } from "@/features/auth/session";

// Comment server actions for the article detail page (#18).
//
// postComment returns a discriminated result so CommentForm can
// render inline validation errors (API 422) without bubbling a
// generic exception. deleteComment throws on failure — the client
// component treats any error as "stay put, show the row", which is
// the right UX for a trash-icon click that fails.

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

  revalidatePath(`/article/[slug]`, "page");
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
  revalidatePath(`/article/[slug]`, "page");
};

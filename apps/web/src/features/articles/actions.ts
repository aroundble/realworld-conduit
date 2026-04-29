"use server";

import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api/client";
import { readSessionCookie, SESSION_COOKIE } from "@/features/auth/session";

// Server actions for the article detail page (#18).
//
// Follow / unfollow, favorite / unfavorite, delete. Each swaps one
// state and returns; the client component that called it owns the
// refetch via `router.refresh()` once the returned promise resolves.
//
// Why not `revalidatePath` here: we used to, but it raced against
// useOptimistic when two actions fired back-to-back (banner Follow
// then banner Favorite) — the revalidation on Follow would kick off
// a refetch whose props could arrive while Favorite's optimistic
// state was still pending, causing a flash of stale state (#76).
// Letting the client drive the refresh after `await action()` makes
// the ordering explicit: DB write → client refresh → new props.
//
// `deleteArticle` keeps its server-side `redirect` because that
// navigates away from the page entirely, so there's no optimistic
// state to race against.
//
// All five require an authenticated viewer; the client components
// only render the actions for authed users, but we still guard here
// because a server action is a public surface.

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

export const followAuthor = async (username: string): Promise<void> => {
  const cookie = await requireSession();
  const res = await apiFetch(
    `/api/profiles/${encodeURIComponent(username)}/follow`,
    { method: "POST", cookie },
  );
  if (!res.ok) {
    throw new Error(`followAuthor failed: ${res.status}`);
  }
};

export const unfollowAuthor = async (username: string): Promise<void> => {
  const cookie = await requireSession();
  const res = await apiFetch(
    `/api/profiles/${encodeURIComponent(username)}/follow`,
    { method: "DELETE", cookie },
  );
  if (!res.ok) {
    throw new Error(`unfollowAuthor failed: ${res.status}`);
  }
};

export const favoriteArticle = async (slug: string): Promise<void> => {
  const cookie = await requireSession();
  const res = await apiFetch(
    `/api/articles/${encodeURIComponent(slug)}/favorite`,
    { method: "POST", cookie },
  );
  if (!res.ok) {
    throw new Error(`favoriteArticle failed: ${res.status}`);
  }
};

export const unfavoriteArticle = async (slug: string): Promise<void> => {
  const cookie = await requireSession();
  const res = await apiFetch(
    `/api/articles/${encodeURIComponent(slug)}/favorite`,
    { method: "DELETE", cookie },
  );
  if (!res.ok) {
    throw new Error(`unfavoriteArticle failed: ${res.status}`);
  }
};

export const deleteArticle = async (slug: string): Promise<void> => {
  const cookie = await requireSession();
  const res = await apiFetch(
    `/api/articles/${encodeURIComponent(slug)}`,
    { method: "DELETE", cookie },
  );
  if (!res.ok) {
    throw new Error(`deleteArticle failed: ${res.status}`);
  }
  // Article is gone; navigate away from the now-404 detail page. The
  // homepage re-fetches on navigation so no revalidation needed.
  redirect("/");
};

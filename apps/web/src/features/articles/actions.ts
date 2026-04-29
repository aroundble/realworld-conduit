"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { readSessionCookie, SESSION_COOKIE } from "@/features/auth/session";

// Server actions for the article detail page (#18).
//
// Follow / unfollow, favorite / unfavorite, delete. Each swaps one
// state, then calls `revalidatePath` so the article page's RSC
// refreshes its cached fetch — the button components render their
// own optimistic intermediate state via useOptimistic so the switch
// looks instant while the revalidation round-trip completes.
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
  // The article page reads viewer-relative `following`, so bust its
  // per-request cache. Profile page (#20) will share this path.
  revalidatePath(`/article/[slug]`, "page");
  revalidatePath(`/profile/${encodeURIComponent(username)}`, "page");
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
  revalidatePath(`/article/[slug]`, "page");
  revalidatePath(`/profile/${encodeURIComponent(username)}`, "page");
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
  // Bust both the detail page (favoritesCount + favorited flip) and
  // the homepage (favoritesCount in the preview list).
  revalidatePath(`/article/[slug]`, "page");
  revalidatePath("/");
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
  revalidatePath(`/article/[slug]`, "page");
  revalidatePath("/");
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
  // Article is gone; homepage list must refresh, and then redirect
  // out of the now-404 detail page to root (AC scenario 4).
  revalidatePath("/");
  redirect("/");
};

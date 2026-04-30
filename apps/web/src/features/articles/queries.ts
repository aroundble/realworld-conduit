import "server-only";
import { apiFetch } from "@/lib/api/client";
import { readSessionCookie, SESSION_COOKIE } from "@/features/auth/session";

// Envelope types duplicated from apps/api/src/schemas/article.ts in a
// narrow shape (only what the homepage reads). A shared types package
// would cut this duplication but lives outside this issue's scope;
// when #22's shared types module lands the web consumer can import
// from there.

export type ArticleAuthor = {
  username: string;
  bio: string | null;
  image: string | null;
  following: boolean;
};

// Full article envelope returned by the single-article GET. `body`
// is only present here; the list endpoints strip it per #63 / spec.
export type Article = {
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  createdAt: string;
  updatedAt: string;
  favorited: boolean;
  favoritesCount: number;
  // Server-computed read-time estimate (#125). Always ≥ 1.
  readingTimeMinutes: number;
  author: ArticleAuthor;
};

// List-envelope entry — same fields as `Article` minus `body`. The
// homepage / profile / feed preview cards never read body; keeping
// the types distinct means a consumer that tries to access body in
// a list context surfaces a compile error rather than a runtime
// undefined.
export type ArticleListItem = Omit<Article, "body">;

export type ArticleListPayload = {
  articles: ArticleListItem[];
  articlesCount: number;
};

// The API's list endpoint accepts tag / author / favorited / limit /
// offset. Homepage only drives tag + limit + offset; the other filters
// land on the profile page (#20). Explicit named filters here give us
// a narrow, typed surface — future callers set their own subset.
export type ListArticleFilters = {
  tag?: string;
  // Filter by article author (e.g. /profile/jake tab "My Articles").
  author?: string;
  // Filter by users who've favorited the article (e.g. /profile/jake
  // tab "Favorited Articles"). Per the RealWorld spec both filters
  // ride the same GET /api/articles endpoint.
  favorited?: string;
  // Free-text search across title + description (#117). Bounded to
  // 2-100 chars by the API; the homepage SearchBar enforces the
  // minimum at input level so no 1-char request ever fires.
  q?: string;
  limit?: number;
  offset?: number;
};

const toQueryString = (params: Record<string, string | number | undefined>): string => {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs.length > 0 ? `?${qs}` : "";
};

// The session JWT rides the conduit_session cookie. apiFetch wraps it
// into the outbound fetch via the `cookie` key so the API can identify
// the viewer — that's how viewer-relative favorited / following land
// on the returned envelopes for authenticated calls.
const cookieHeader = async (): Promise<string | undefined> => {
  const token = await readSessionCookie();
  return token ? `${SESSION_COOKIE}=${token}` : undefined;
};

export const listArticles = async (
  filters: ListArticleFilters = {},
): Promise<ArticleListPayload> => {
  const qs = toQueryString({
    tag: filters.tag,
    author: filters.author,
    favorited: filters.favorited,
    q: filters.q,
    limit: filters.limit,
    offset: filters.offset,
  });
  const cookie = await cookieHeader();
  const res = await apiFetch<ArticleListPayload>(`/api/articles${qs}`, { cookie });
  if (!res.ok) {
    throw new Error(`listArticles failed: ${res.status}`);
  }
  return res.data;
};

export const feedArticles = async (
  filters: { limit?: number; offset?: number } = {},
): Promise<ArticleListPayload> => {
  const qs = toQueryString({ limit: filters.limit, offset: filters.offset });
  const cookie = await cookieHeader();
  const res = await apiFetch<ArticleListPayload>(`/api/articles/feed${qs}`, { cookie });
  if (!res.ok) {
    throw new Error(`feedArticles failed: ${res.status}`);
  }
  return res.data;
};

export type TagList = { tags: string[] };

export const listTopTags = async (): Promise<TagList> => {
  const res = await apiFetch<TagList>("/api/tags");
  if (!res.ok) {
    throw new Error(`listTopTags failed: ${res.status}`);
  }
  return res.data;
};

export type Comment = {
  id: number;
  createdAt: string;
  updatedAt: string;
  body: string;
  // Soft-delete marker (#171). Non-null when the comment was
  // soft-deleted; `body` carries the placeholder string the API
  // chose. Older server responses predating #171 may omit this
  // field — treat absent as null.
  deletedAt?: string | null;
  author: ArticleAuthor;
};

export type ArticlePayload = { article: Article };
export type CommentsPayload = { comments: Comment[] };
export type CommentPayload = { comment: Comment };

// 404 is a documented AC scenario; surface it as a null rather than a
// thrown error so the page handler can call notFound() for the
// correct Next.js 404 flow (AC scenario 8). Any other non-2xx remains
// an exception — unexpected API errors should surface as a 500
// boundary rather than a silent empty page.
export const getArticle = async (slug: string): Promise<Article | null> => {
  const cookie = await cookieHeader();
  const res = await apiFetch<ArticlePayload>(
    `/api/articles/${encodeURIComponent(slug)}`,
    { cookie },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`getArticle failed: ${res.status}`);
  }
  return res.data.article;
};

export const listComments = async (slug: string): Promise<Comment[]> => {
  const cookie = await cookieHeader();
  const res = await apiFetch<CommentsPayload>(
    `/api/articles/${encodeURIComponent(slug)}/comments`,
    { cookie },
  );
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`listComments failed: ${res.status}`);
  }
  return res.data.comments;
};

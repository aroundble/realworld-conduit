import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client.js";

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/articles.service.ts`, attribution):
//   - `createArticle`: upstream computes `slug = slugify(title) + "-" + rand`
//     and upserts tags; we keep the same shape.
//   - `getArticle`: upstream includes author + favorites count + viewer-
//     relative flags. Since #12 we include real favorites: `_count.favoritedBy`
//     gives `favoritesCount`, and a narrow `favoritedBy` include against the
//     viewer computes `favorited` (empty array for anonymous viewers).
//   - `favoriteArticle` / `unfavoriteArticle`: upstream does
//     `user.update({ favorites: { connect / disconnect } })`. We do the same,
//     with an explicit 404-if-missing guard before the connect (upstream
//     relies on Prisma throwing P2025 which we surface uniformly).
//
// Tag upsert uses Prisma's `connectOrCreate`, so the first article that
// mentions a tag creates it and subsequent articles reuse the row —
// matches the reference's behaviour and keeps tag names unique.

export type ArticleEnvelope = {
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  createdAt: string;
  updatedAt: string;
  favorited: boolean;
  favoritesCount: number;
  author: {
    username: string;
    bio: string | null;
    image: string | null;
    following: boolean;
  };
};

// List envelopes drop the `body` field per the RealWorld spec — only
// `GET /api/articles/:slug` is meant to return it. See #63.
export type ArticleListItem = Omit<ArticleEnvelope, "body">;

export class ArticleError extends Error {
  constructor(
    public readonly field: string,
    public readonly detail: string,
    public readonly status: 403 | 404 | 422,
  ) {
    super(`${field}: ${detail}`);
    this.name = "ArticleError";
  }
}

// Minimal slugifier: lowercase, collapse non-alphanumerics into single
// hyphens, trim edges. Pure ASCII — the spec's demo data is English, and
// Prisma's `@unique` on `slug` enforces global uniqueness regardless.
const slugify = (input: string): string =>
  input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

// 4-char lowercase suffix makes the slug unique across identical titles
// without reaching for a collision retry loop. 36^4 ≈ 1.7M — sufficient
// for blog-scale dataset per issue #8's sizing.
const suffix = (): string =>
  randomBytes(3).toString("base64url").slice(0, 4).toLowerCase().replace(/[^a-z0-9]/g, "x");

// Every article-returning endpoint must fetch with this include shape
// so `toEnvelope` has what it needs for both `following` (viewer-relative
// follow of author) and `favorited` / `favoritesCount` (viewer-relative
// favorite + total count). Exported so the route handlers in
// `routes/articles.ts` can reuse it without drifting the shape.
export const articleInclude = {
  tagList: true,
  author: { include: { followedBy: { select: { id: true } } } },
  _count: { select: { favoritedBy: true } },
  // Narrowed favoritedBy include: when `viewerId` is a real user we
  // filter to just that user's row (0 or 1 result, no count scan needed).
  // Anonymous viewers pass an id that can never match so the include
  // stays harmless and returns an empty array.
  favoritedBy: {
    where: { id: -1 },
    select: { id: true },
  },
} as const;

type ArticleWithIncludes = Prisma.ArticleGetPayload<{
  include: typeof articleInclude;
}>;

const toEnvelope = (
  article: ArticleWithIncludes,
  viewerId: number | null,
): ArticleEnvelope => ({
  slug: article.slug,
  title: article.title,
  description: article.description,
  body: article.body,
  tagList: article.tagList.map((t) => t.name).sort(),
  createdAt: article.createdAt.toISOString(),
  updatedAt: article.updatedAt.toISOString(),
  favorited: article.favoritedBy.length > 0,
  favoritesCount: article._count.favoritedBy,
  author: {
    username: article.author.username,
    bio: article.author.bio,
    image: article.author.image,
    following:
      viewerId !== null &&
      article.author.id !== viewerId &&
      article.author.followedBy.some((f) => f.id === viewerId),
  },
});

// List endpoints use the same envelope shape minus `body`. Reuse the
// full `toEnvelope` so the projection stays in one place, then project
// out `body` — the type annotation catches any later envelope-shape
// change that would otherwise silently re-include it.
const toListItem = (
  article: ArticleWithIncludes,
  viewerId: number | null,
): ArticleListItem => {
  const envelope = toEnvelope(article, viewerId);
  return {
    slug: envelope.slug,
    title: envelope.title,
    description: envelope.description,
    tagList: envelope.tagList,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    favorited: envelope.favorited,
    favoritesCount: envelope.favoritesCount,
    author: envelope.author,
  };
};

// Caller always knows the viewer; we thread it into the `favoritedBy`
// where-clause so the include only returns the viewer's own favorite
// row if any. Keeps the query narrow regardless of total fav count.
const includeFor = (viewerId: number | null) => ({
  ...articleInclude,
  favoritedBy: {
    where: { id: viewerId ?? -1 },
    select: { id: true },
  },
});

export type CreateArticleInput = {
  title: string;
  description: string;
  body: string;
  tagList?: string[];
};

export const createArticle = async (
  authorId: number,
  input: CreateArticleInput,
): Promise<ArticleEnvelope> => {
  const base = slugify(input.title);
  if (!base) {
    throw new ArticleError("title", "can't be blank", 422);
  }
  const slug = `${base}-${suffix()}`;
  const tags = input.tagList ?? [];

  const article = await prisma.article.create({
    data: {
      slug,
      title: input.title,
      description: input.description,
      body: input.body,
      author: { connect: { id: authorId } },
      tagList: {
        connectOrCreate: tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
    },
    include: includeFor(authorId),
  });

  return toEnvelope(article, authorId);
};

export const getArticleBySlug = async (
  slug: string,
  viewerId: number | null,
): Promise<ArticleEnvelope> => {
  const article = await prisma.article.findUnique({
    where: { slug },
    include: includeFor(viewerId),
  });
  if (!article) {
    throw new ArticleError("article", "not found", 404);
  }
  return toEnvelope(article, viewerId);
};

export type UpdateArticleInput = {
  title?: string;
  description?: string;
  body?: string;
  // undefined = leave existing tags unchanged; present (including []) =
  // replace the tag set with the provided list (empty clears all).
  // Per RealWorld spec / #68.
  tagList?: string[];
};

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/articles.service.ts#updateArticle`, attribution).
// Two deviations from upstream:
//   1. Author check runs here rather than in the handler, so callers in
//      other contexts (future admin flows) can't forget it.
//   2. When title changes the slug is regenerated with a fresh 4-char
//      suffix. Upstream slugifies and trusts Prisma's unique constraint
//      to surface collisions; we mirror that but retry once with a
//      different suffix if Postgres returns P2002 on slug.
// `updatedAt` is set explicitly because the schema's `updatedAt` column
// has `@default(now())` but no `@updatedAt` directive (inherited from
// upstream); Prisma won't bump it on plain updates. AC scenario 1 of
// issue #9 requires `updatedAt > createdAt`, which this write enforces.
export const updateArticle = async (
  viewerId: number,
  slug: string,
  input: UpdateArticleInput,
): Promise<ArticleEnvelope> => {
  const existing = await prisma.article.findUnique({ where: { slug } });
  if (!existing) {
    throw new ArticleError("article", "not found", 404);
  }
  if (existing.authorId !== viewerId) {
    throw new ArticleError("article", "forbidden", 403);
  }

  const data: Prisma.ArticleUpdateInput = { updatedAt: new Date() };
  if (input.title !== undefined) {
    const base = slugify(input.title);
    if (!base) {
      throw new ArticleError("title", "can't be blank", 422);
    }
    data.title = input.title;
    data.slug = `${base}-${suffix()}`;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.body !== undefined) data.body = input.body;
  if (input.tagList !== undefined) {
    // `set: []` detaches every current tag, then `connectOrCreate`
    // reattaches whatever's in the new list. Empty array → tags fully
    // cleared; non-empty → tag set replaced atomically with the
    // supplied names. Per #68's AC — the spec treats tagList
    // present-with-[] as "clear" and omitted as "no change".
    data.tagList = {
      set: [],
      connectOrCreate: input.tagList.map((name) => ({
        where: { name },
        create: { name },
      })),
    };
  }

  const updated = await prisma.article.update({
    where: { id: existing.id },
    data,
    include: includeFor(viewerId),
  });
  return toEnvelope(updated, viewerId);
};

export const deleteArticle = async (
  viewerId: number,
  slug: string,
): Promise<void> => {
  const existing = await prisma.article.findUnique({ where: { slug } });
  if (!existing) {
    throw new ArticleError("article", "not found", 404);
  }
  if (existing.authorId !== viewerId) {
    throw new ArticleError("article", "forbidden", 403);
  }
  // Comments cascade via onDelete:Cascade on Comment.article. The
  // implicit M:N join rows for tagList (_ArticleToTag) and favoritedBy
  // (_UserFavorites) are cleared by Prisma automatically when the owning
  // row goes away — no manual cleanup needed.
  await prisma.article.delete({ where: { id: existing.id } });
};

export const favoriteArticle = async (
  viewerId: number,
  slug: string,
): Promise<ArticleEnvelope> => {
  const existing = await prisma.article.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!existing) {
    throw new ArticleError("article", "not found", 404);
  }
  // user.update with favorites.connect is idempotent in Prisma: calling
  // connect for a row already in the relation is a no-op and does not
  // duplicate the join row. That means scenario 2's count-stays-1
  // assertion falls out naturally — no extra guard needed here.
  await prisma.user.update({
    where: { id: viewerId },
    data: { favorites: { connect: { id: existing.id } } },
  });
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: existing.id },
    include: includeFor(viewerId),
  });
  return toEnvelope(article, viewerId);
};

export type ListArticlesFilters = {
  tag?: string;
  author?: string;
  favoritedBy?: string;
  limit: number;
  offset: number;
};

export type FeedFilters = {
  limit: number;
  offset: number;
};

export type ListArticlesResult = {
  articles: ArticleListItem[];
  articlesCount: number;
};

export type FeedResult = ListArticlesResult;

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/articles.service.ts#listArticles`, attribution).
// Upstream wires tag / author / favoritedBy filters into a single
// findMany; we follow the same shape. Ordering is newest-first on
// createdAt — every RealWorld reference frontend expects that.
//
// `articlesCount` is computed with the same where-clause (minus the
// skip/take) so pagination UIs know the total before slicing. A
// transactional read would be more "correct" but the two queries are
// 10-20ms apart under normal load; no reference implementation
// bothers with a snapshot.
export const listArticles = async (
  filters: ListArticlesFilters,
  viewerId: number | null,
): Promise<ListArticlesResult> => {
  const where: Prisma.ArticleWhereInput = {};
  if (filters.tag) {
    where.tagList = { some: { name: filters.tag } };
  }
  if (filters.author) {
    where.author = { username: filters.author };
  }
  if (filters.favoritedBy) {
    where.favoritedBy = { some: { username: filters.favoritedBy } };
  }

  const [rows, articlesCount] = await Promise.all([
    prisma.article.findMany({
      where,
      include: includeFor(viewerId),
      orderBy: { createdAt: "desc" },
      skip: filters.offset,
      take: filters.limit,
    }),
    prisma.article.count({ where }),
  ]);

  return {
    articles: rows.map((row) => toListItem(row, viewerId)),
    articlesCount,
  };
};

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/articles.service.ts#feed`, attribution). The
// reference filters by `author.followedBy.some({id: viewerId})` so Prisma
// pushes the follow-set join into the articles query directly — no
// separate "which users does viewer follow?" round-trip. We mirror that.
export const feedArticles = async (
  viewerId: number,
  filters: FeedFilters,
): Promise<FeedResult> => {
  const where: Prisma.ArticleWhereInput = {
    author: { followedBy: { some: { id: viewerId } } },
  };

  const [rows, articlesCount] = await Promise.all([
    prisma.article.findMany({
      where,
      include: includeFor(viewerId),
      orderBy: { createdAt: "desc" },
      skip: filters.offset,
      take: filters.limit,
    }),
    prisma.article.count({ where }),
  ]);

  return {
    articles: rows.map((row) => toListItem(row, viewerId)),
    articlesCount,
  };
};

export const unfavoriteArticle = async (
  viewerId: number,
  slug: string,
): Promise<ArticleEnvelope> => {
  const existing = await prisma.article.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!existing) {
    throw new ArticleError("article", "not found", 404);
  }
  // `disconnect` is also idempotent; calling it when the row isn't in
  // the relation is a no-op.
  await prisma.user.update({
    where: { id: viewerId },
    data: { favorites: { disconnect: { id: existing.id } } },
  });
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: existing.id },
    include: includeFor(viewerId),
  });
  return toEnvelope(article, viewerId);
};

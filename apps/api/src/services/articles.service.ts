import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client.js";

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/articles.service.ts`, attribution):
//   - `createArticle`: upstream computes `slug = slugify(title) + "-" + rand`
//     and upserts tags; we keep the same shape.
//   - `getArticle`: upstream includes author + favorites count + viewer-
//     relative flags; we ship placeholders (favoritesCount:0, favorited:false)
//     until Feature 12 adds real favorite tracking.
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

export class ArticleError extends Error {
  constructor(
    public readonly field: string,
    public readonly detail: string,
    public readonly status: 404 | 422,
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

const toEnvelope = (
  article: Prisma.ArticleGetPayload<{
    include: {
      tagList: true;
      author: { include: { followedBy: { select: { id: true } } } };
    };
  }>,
  viewerId: number | null,
): ArticleEnvelope => ({
  slug: article.slug,
  title: article.title,
  description: article.description,
  body: article.body,
  tagList: article.tagList.map((t) => t.name).sort(),
  createdAt: article.createdAt.toISOString(),
  updatedAt: article.updatedAt.toISOString(),
  // Favorite tracking lands in #12 — until then the envelope shape is
  // still complete but always reports "not favorited" with zero count.
  favorited: false,
  favoritesCount: 0,
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
    include: {
      tagList: true,
      author: { include: { followedBy: { select: { id: true } } } },
    },
  });

  return toEnvelope(article, authorId);
};

export const getArticleBySlug = async (
  slug: string,
  viewerId: number | null,
): Promise<ArticleEnvelope> => {
  const article = await prisma.article.findUnique({
    where: { slug },
    include: {
      tagList: true,
      author: { include: { followedBy: { select: { id: true } } } },
    },
  });
  if (!article) {
    throw new ArticleError("article", "not found", 404);
  }
  return toEnvelope(article, viewerId);
};

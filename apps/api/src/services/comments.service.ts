import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client.js";

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/comments.service.ts`, attribution). The
// reference emits the same `{id, createdAt, updatedAt, body, author}`
// envelope with viewer-relative `following`. We reuse the narrow
// `followedBy` include pattern used by profile / article services so
// the follow check is a tiny join rather than a row scan.

export type CommentEnvelope = {
  id: number;
  createdAt: string;
  updatedAt: string;
  body: string;
  author: {
    username: string;
    bio: string | null;
    image: string | null;
    following: boolean;
  };
};

export class CommentError extends Error {
  constructor(
    public readonly field: string,
    public readonly detail: string,
    public readonly status: 403 | 404 | 422,
  ) {
    super(`${field}: ${detail}`);
    this.name = "CommentError";
  }
}

const commentInclude = {
  author: { include: { followedBy: { select: { id: true } } } },
} as const;

type CommentWithIncludes = Prisma.CommentGetPayload<{
  include: typeof commentInclude;
}>;

const toEnvelope = (
  comment: CommentWithIncludes,
  viewerId: number | null,
): CommentEnvelope => ({
  id: comment.id,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
  body: comment.body,
  author: {
    username: comment.author.username,
    bio: comment.author.bio,
    image: comment.author.image,
    following:
      viewerId !== null &&
      comment.author.id !== viewerId &&
      comment.author.followedBy.some((f) => f.id === viewerId),
  },
});

// Narrow helper — every entry point needs to resolve "does this slug
// exist" before touching comments. Returns the article row (id only)
// or throws 404. Kept private so route handlers can't skip it.
const requireArticleId = async (slug: string): Promise<number> => {
  const article = await prisma.article.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!article) {
    throw new CommentError("article", "not found", 404);
  }
  return article.id;
};

export const listComments = async (
  slug: string,
  viewerId: number | null,
): Promise<CommentEnvelope[]> => {
  const articleId = await requireArticleId(slug);
  const comments = await prisma.comment.findMany({
    where: { articleId },
    include: commentInclude,
    orderBy: { createdAt: "desc" },
  });
  return comments.map((c) => toEnvelope(c, viewerId));
};

export const addComment = async (
  viewerId: number,
  slug: string,
  body: string,
): Promise<CommentEnvelope> => {
  const articleId = await requireArticleId(slug);
  const comment = await prisma.comment.create({
    data: {
      body,
      article: { connect: { id: articleId } },
      author: { connect: { id: viewerId } },
    },
    include: commentInclude,
  });
  return toEnvelope(comment, viewerId);
};

export const deleteComment = async (
  viewerId: number,
  slug: string,
  commentId: number,
): Promise<void> => {
  const articleId = await requireArticleId(slug);
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, articleId: true, authorId: true },
  });
  // 404 if comment is missing OR belongs to a different article (so a
  // client can't discover comment ids by probing other slugs).
  if (!comment || comment.articleId !== articleId) {
    throw new CommentError("comment", "not found", 404);
  }
  if (comment.authorId !== viewerId) {
    throw new CommentError("comment", "forbidden", 403);
  }
  await prisma.comment.delete({ where: { id: commentId } });
};

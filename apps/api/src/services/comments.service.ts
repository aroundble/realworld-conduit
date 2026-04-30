import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client.js";

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/comments.service.ts`, attribution). The
// reference emits the same `{id, createdAt, updatedAt, body, author}`
// envelope with viewer-relative `following`. We reuse the narrow
// `followedBy` include pattern used by profile / article services so
// the follow check is a tiny join rather than a row scan.
//
// Soft-delete (#171): when a row carries a non-null `deletedAt`, the
// envelope replaces `body` with "[deleted]" (user-initiated) or
// "[removed by moderation]" (admin-initiated via moderationReason),
// zeroes out the author profile to a placeholder, and surfaces
// `deletedAt`. The original body stays on the row for audit; no
// user-agent code path reveals it.

export const DELETED_PLACEHOLDER = "[deleted]";
export const MODERATED_PLACEHOLDER = "[removed by moderation]";

const DELETED_AUTHOR = {
  username: "[deleted]",
  bio: null,
  image: null,
  following: false,
} as const;

export type CommentEnvelope = {
  id: number;
  createdAt: string;
  updatedAt: string;
  body: string;
  deletedAt: string | null;
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
): CommentEnvelope => {
  if (comment.deletedAt !== null) {
    // Placeholder body depends on whether a moderationReason was
    // attached; the reason itself is NOT surfaced (callers don't
    // need to know why; the admin UI from a future issue will
    // query it directly).
    const placeholderBody =
      comment.moderationReason !== null && comment.moderationReason !== ""
        ? MODERATED_PLACEHOLDER
        : DELETED_PLACEHOLDER;
    return {
      id: comment.id,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      body: placeholderBody,
      deletedAt: comment.deletedAt.toISOString(),
      author: { ...DELETED_AUTHOR },
    };
  }
  return {
    id: comment.id,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    body: comment.body,
    deletedAt: null,
    author: {
      username: comment.author.username,
      bio: comment.author.bio,
      image: comment.author.image,
      following:
        viewerId !== null &&
        comment.author.id !== viewerId &&
        comment.author.followedBy.some((f) => f.id === viewerId),
    },
  };
};

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

export type DeleteCommentOptions = {
  // When present, treats the call as admin moderation: the
  // caller must have user.role === "admin"; the row records
  // deletedBy + moderationReason; placeholder renders as
  // "[removed by moderation]". Absent → regular self-delete by
  // the comment owner.
  moderation?: { reason: string };
};

export const deleteComment = async (
  viewer: { id: number; role: string | null },
  slug: string,
  commentId: number,
  opts: DeleteCommentOptions = {},
): Promise<void> => {
  const articleId = await requireArticleId(slug);
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, articleId: true, authorId: true, deletedAt: true },
  });
  // 404 hides:
  //   - missing comment
  //   - comment that lives on a different article (cross-slug probe)
  //   - already soft-deleted (can't re-delete, but don't leak existence
  //     to non-owners / non-moderators via a distinct status)
  if (
    !comment ||
    comment.articleId !== articleId ||
    comment.deletedAt !== null
  ) {
    throw new CommentError("comment", "not found", 404);
  }
  if (opts.moderation) {
    // Moderation path: viewer must be an admin.
    if (viewer.role !== "admin") {
      throw new CommentError("comment", "forbidden", 403);
    }
    await prisma.comment.update({
      where: { id: commentId },
      data: {
        deletedAt: new Date(),
        deletedBy: viewer.id,
        moderationReason: opts.moderation.reason,
      },
    });
    return;
  }
  // Self-delete path: viewer must be the author.
  if (comment.authorId !== viewer.id) {
    throw new CommentError("comment", "forbidden", 403);
  }
  await prisma.comment.update({
    where: { id: commentId },
    data: {
      deletedAt: new Date(),
      deletedBy: viewer.id,
    },
  });
};

// Owner-only body update. Mirrors deleteComment's 404/403 ladder
// verbatim so a probing client can't distinguish "not your
// comment" from "no such comment on this article". Returns the
// updated envelope so the web client can optimistically replace
// the row without a refetch round-trip.
//
// Prisma Comment lacks `@updatedAt` so updatedAt is set
// explicitly; same pattern as articles.service.updateArticle.
//
// Soft-deleted comments 404 here — a terminal state from the
// user's perspective; allowing edit would let them rewrite
// history (AC scenario 3).
export const updateComment = async (
  viewerId: number,
  slug: string,
  commentId: number,
  body: string,
): Promise<CommentEnvelope> => {
  const articleId = await requireArticleId(slug);
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, articleId: true, authorId: true, deletedAt: true },
  });
  if (
    !comment ||
    comment.articleId !== articleId ||
    comment.deletedAt !== null
  ) {
    throw new CommentError("comment", "not found", 404);
  }
  if (comment.authorId !== viewerId) {
    throw new CommentError("comment", "forbidden", 403);
  }
  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { body, updatedAt: new Date() },
    include: commentInclude,
  });
  return toEnvelope(updated, viewerId);
};

import { z } from "@hono/zod-openapi";
import { ProfileSchema } from "./profile.js";

export const CommentSchema = z
  .object({
    id: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    body: z.string(),
    // Soft-delete marker (#171). ISO timestamp when the comment
    // was soft-deleted, or null for live comments. When non-null,
    // `body` carries "[deleted]" / "[removed by moderation]" and
    // `author` is a placeholder (original body stays on the DB
    // row for audit / appeal, never surfaced via API).
    deletedAt: z.string().nullable(),
    author: ProfileSchema,
  })
  .openapi("Comment");

export const CommentResponseSchema = z
  .object({ comment: CommentSchema })
  .openapi("CommentResponse");

export const CommentListResponseSchema = z
  .object({ comments: z.array(CommentSchema) })
  .openapi("CommentListResponse");

export const CreateCommentRequestSchema = z
  .object({
    comment: z.object({
      body: z.string().min(1, "can't be blank").max(10_000),
    }),
  })
  .openapi("CreateCommentRequest");

export const UpdateCommentRequestSchema = z
  .object({
    comment: z.object({
      body: z.string().min(1, "can't be blank").max(10_000),
    }),
  })
  .openapi("UpdateCommentRequest");

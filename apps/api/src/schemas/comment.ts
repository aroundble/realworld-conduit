import { z } from "@hono/zod-openapi";
import { ProfileSchema } from "./profile.js";

export const CommentSchema = z
  .object({
    id: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    body: z.string(),
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

import { z } from "@hono/zod-openapi";

// Inlined here rather than imported from `./profile.ts` — #7's profile
// schema lives on a separate in-flight branch and will land through its
// own PR. Once both merge the evaluator can dedupe via a follow-up.
const ArticleAuthorSchema = z
  .object({
    username: z.string(),
    bio: z.string().nullable(),
    image: z.string().nullable(),
    following: z.boolean(),
  })
  .openapi("ArticleAuthor");

export const ArticleSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    body: z.string(),
    tagList: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
    favorited: z.boolean(),
    favoritesCount: z.number().int().nonnegative(),
    author: ArticleAuthorSchema,
  })
  .openapi("Article");

export const ArticleResponseSchema = z
  .object({ article: ArticleSchema })
  .openapi("ArticleResponse");

export const CreateArticleRequestSchema = z
  .object({
    article: z.object({
      title: z.string().min(1, "can't be blank").max(300),
      description: z.string().max(1000),
      body: z.string().max(50_000),
      tagList: z.array(z.string().min(1).max(50)).max(20).optional(),
    }),
  })
  .openapi("CreateArticleRequest");

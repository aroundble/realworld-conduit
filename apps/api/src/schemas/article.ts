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
    // Server-computed read-time estimate in minutes (#125). Always
    // at least 1 for legibility ("1 min read"); clients display it
    // inline with the date in article meta.
    readingTimeMinutes: z.number().int().positive(),
    author: ArticleAuthorSchema,
  })
  .openapi("Article");

// List-envelope entries omit `body`. RealWorld spec differentiates the
// *single-article* GET (`GET /api/articles/:slug`) from the list
// endpoints: the single response carries the full body, list responses
// don't, so clients reading a homepage feed avoid paying per-article
// markdown cost. See #63 / the canonical Bruno assertions under
// `articles/0{3..7}`, `feed/`, `favorites/`.
export const ArticleListItemSchema = ArticleSchema.omit({ body: true }).openapi(
  "ArticleListItem",
);

export const ArticleResponseSchema = z
  .object({ article: ArticleSchema })
  .openapi("ArticleResponse");

export const ArticleListResponseSchema = z
  .object({
    articles: z.array(ArticleListItemSchema),
    articlesCount: z.number().int().nonnegative(),
  })
  .openapi("ArticleListResponse");

export const CreateArticleRequestSchema = z
  .object({
    article: z.object({
      title: z.string().min(1, "can't be blank").max(300),
      // description + body are required on create per RealWorld spec —
      // the upstream Bruno errors-articles/10 + 11 assert 422 with
      // `"can't be blank"` when either is empty. See #67.
      description: z.string().min(1, "can't be blank").max(1000),
      body: z.string().min(1, "can't be blank").max(50_000),
      tagList: z.array(z.string().min(1).max(50)).max(20).optional(),
    }),
  })
  .openapi("CreateArticleRequest");

// PUT /api/articles/:slug is partial — any subset of title/description/
// body/tagList may be sent; unspecified fields are left untouched.
// tagList semantics per #68: omitted = keep current tags, present `[]`
// = clear all tags, present with values = replace the tag set entirely.
export const UpdateArticleRequestSchema = z
  .object({
    article: z
      .object({
        title: z.string().min(1, "can't be blank").max(300).optional(),
        description: z.string().max(1000).optional(),
        body: z.string().max(50_000).optional(),
        tagList: z.array(z.string().min(1).max(50)).max(20).optional(),
      })
      .refine(
        (value) =>
          value.title !== undefined ||
          value.description !== undefined ||
          value.body !== undefined ||
          value.tagList !== undefined,
        {
          message:
            "at least one of title/description/body/tagList must be provided",
        },
      ),
  })
  .openapi("UpdateArticleRequest");

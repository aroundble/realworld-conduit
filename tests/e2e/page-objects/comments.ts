import { expect, request, type APIRequestContext } from "@playwright/test";

// API-client POP for `/api/articles/:slug/comments*`.
//
// #97 (Phase 2 of #35). Same API-client shape as `ArticlesApi`
// (#96, PR #108) since spec 13 is API-only. The POP owns the
// repeated comment-operation helpers every comment test uses.
//
// Duplication note: `registerUser` + `createArticle` live here
// alongside the comment methods because this branch is off latest
// (pre-#108). Once #108 merges, a follow-up can collapse these to
// share ArticlesApi's versions.
//
// Adapted from mutoe/vue3-realworld-example-app @ dd34ba90 (MIT) —
// the Vue ref exposes `axios.get/post/delete` shortcuts with
// similar names.

const DEFAULT_API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

export type Comment = {
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

export class CommentsApi {
  constructor(
    public readonly api: APIRequestContext,
    private readonly baseURL: string = DEFAULT_API_URL,
  ) {}

  static async newContext(baseURL = DEFAULT_API_URL): Promise<CommentsApi> {
    const ctx = await request.newContext({ baseURL });
    return new CommentsApi(ctx, baseURL);
  }

  // ─── User + article seed helpers ─────────────────────────────

  async registerUser(username: string): Promise<void> {
    const res = await this.api.post("/api/users", {
      data: {
        user: {
          username,
          email: `${username}@jake.jake`,
          password: "jakejake",
        },
      },
    });
    expect(res.status()).toBe(201);
  }

  async createArticle(title: string, tagList: string[] = []): Promise<string> {
    const res = await this.api.post("/api/articles", {
      data: { article: { title, description: "d", body: "b", tagList } },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { article: { slug: string } };
    return body.article.slug;
  }

  // ─── Comments CRUD ───────────────────────────────────────────

  async addComment(slug: string, body: string): Promise<Comment> {
    const res = await this.api.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body } },
    });
    expect(res.status()).toBe(201);
    const payload = (await res.json()) as { comment: Comment };
    return payload.comment;
  }

  // Convenience: most spec sites only want the id of the created
  // comment for the subsequent DELETE assertion.
  async addCommentReturnId(slug: string, body: string): Promise<number> {
    const c = await this.addComment(slug, body);
    return c.id;
  }

  async listComments(slug: string): Promise<Comment[]> {
    const res = await this.api.get(`/api/articles/${slug}/comments`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { comments: Comment[] };
    return body.comments;
  }

  async deleteComment(slug: string, commentId: number): Promise<void> {
    const res = await this.api.delete(
      `/api/articles/${slug}/comments/${commentId}`,
    );
    expect(res.status()).toBe(204);
    // 204 MUST have empty body per RFC 7230 §3.3.3.
    const delBody = await res.body();
    expect(delBody.byteLength).toBe(0);
  }

  // ─── Raw escape hatch for error paths (401/403/404/422) ──────

  rawAddComment(slug: string, body: string) {
    return this.api.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body } },
    });
  }

  rawDeleteComment(slug: string, commentId: number) {
    return this.api.delete(`/api/articles/${slug}/comments/${commentId}`);
  }

  rawListComments(slug: string) {
    return this.api.get(`/api/articles/${slug}/comments`);
  }
}

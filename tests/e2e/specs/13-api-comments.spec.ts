import { expect, test } from "@playwright/test";
import { CommentsApi } from "../page-objects/comments";

// BDD coverage for issue #13: comments CRUD on articles.
// Seven AC scenarios. Each test seeds its own jake / dan / article so
// suites are independent of other specs running against the same
// compose stack.
//
// #97 Phase 2 refactor: API helpers via `CommentsApi`. Scenarios 4-7
// need raw responses (403/401/404/422) and use the POP's `raw*`
// shortcuts — the happy-path wrappers assert 200/201/204.

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #13 — API comments CRUD", () => {
  test("Scenario 1: anonymous list — 200, shape + order", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await CommentsApi.newContext();
    const danApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`List ${id}`);

    await jakeApi.addComment(slug, "jake's first");
    // A hair of delay so createdAt values are strictly increasing at
    // the ms granularity postgres exposes.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await danApi.addComment(slug, "dan replies");

    const anon = await CommentsApi.newContext();
    const comments = await anon.listComments(slug);
    expect(comments.length).toBe(2);
    // Descending by createdAt — dan's "dan replies" (newer) comes first.
    expect(comments[0].author.username).toBe(dan);
    expect(comments[1].author.username).toBe(jake);
    expect(comments[0].body).toBe("dan replies");
    expect(comments[1].body).toBe("jake's first");
    expect(Date.parse(comments[0].createdAt)).toBeGreaterThanOrEqual(
      Date.parse(comments[1].createdAt),
    );
    // Envelope shape: author is a Profile with viewer-relative flag.
    expect(comments[0].author.following).toBe(false);
    // Fresh users have bio = null and image = null (our register path
    // stores the defaults as nulls, matching #4's established shape).
    expect(comments[0].author.bio).toBeNull();
    expect(comments[0].author.image).toBeNull();
  });

  test("Scenario 2: add comment as authenticated user → 201 + envelope", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticle(`Add ${id}`);

    const comment = await jakeApi.addComment(slug, "Thank you!");
    expect(comment.body).toBe("Thank you!");
    expect(comment.author.username).toBe(jake);
    expect(Number.isInteger(comment.id)).toBe(true);

    // Round-trip: GET lists it.
    const comments = await jakeApi.listComments(slug);
    expect(comments.map((c) => c.id)).toContain(comment.id);
  });

  test("Scenario 3: delete own comment → 204, row soft-deleted (body='[deleted]', deletedAt set)", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticle(`Del ${id}`);
    const commentId = await jakeApi.addCommentReturnId(slug, "delete me");

    await jakeApi.deleteComment(slug, commentId);

    // Soft-delete (#171): the row stays in the list with the
    // placeholder envelope. AC scenario 2: "subsequent GET still
    // returns the comment record BUT with body: '[deleted]',
    // author zeroed, deletedAt: <iso>".
    const comments = await jakeApi.listComments(slug);
    const row = comments.find((c) => c.id === commentId);
    expect(row).toBeTruthy();
    expect(row?.body).toBe("[deleted]");
    expect(row?.author.username).toBe("[deleted]");
    expect(row?.deletedAt).toBeTruthy();
  });

  test("Scenario 4: delete someone else's comment → 403", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await CommentsApi.newContext();
    const danApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Owned ${id}`);
    const danCommentId = await danApi.addCommentReturnId(slug, "dan's comment");

    const res = await jakeApi.rawDeleteComment(slug, danCommentId);
    expect(res.status()).toBe(403);

    // Sanity: comment still exists.
    const comments = await jakeApi.listComments(slug);
    expect(comments.map((c) => c.id)).toContain(danCommentId);
  });

  test("Scenario 5: anon POST + DELETE → 401 each", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticle(`Auth ${id}`);
    const commentId = await jakeApi.addCommentReturnId(slug, "gate");

    const anon = await CommentsApi.newContext();
    const post = await anon.rawAddComment(slug, "anon try");
    expect(post.status()).toBe(401);
    const del = await anon.rawDeleteComment(slug, commentId);
    expect(del.status()).toBe(401);
  });

  test("Scenario 6: any comment op on non-existent slug → 404", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);

    const anon = await CommentsApi.newContext();
    const missing = `does-not-exist-${id}`;
    const getRes = await anon.rawListComments(missing);
    expect(getRes.status()).toBe(404);

    const postRes = await jakeApi.rawAddComment(missing, "ghost");
    expect(postRes.status()).toBe(404);

    const delRes = await jakeApi.rawDeleteComment(missing, 1);
    expect(delRes.status()).toBe(404);
  });

  test("Scenario 7: empty body → 422 with errors.body", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await CommentsApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticle(`Empty ${id}`);

    const res = await jakeApi.rawAddComment(slug, "");
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    const allMessages = Object.values(body.errors).flat().join(" ");
    expect(allMessages.toLowerCase()).toContain("can't be blank");
  });
});

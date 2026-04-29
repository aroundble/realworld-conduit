import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/article/ArticleBody";
import { ArticleMeta } from "@/components/article/ArticleMeta";
import { CommentList } from "@/components/comment/CommentList";
import { CommentForm } from "@/components/comment/CommentForm";
import { CommentsSkeleton } from "@/components/skeletons/CommentsSkeleton";
import {
  getArticle,
  listComments,
  type Comment,
} from "@/features/articles/queries";
import {
  isAuthenticated,
  readCurrentUsername,
} from "@/features/auth/session";
import { siteUrl } from "@/lib/site";

// Dynamic share-preview metadata (#113). When a link previewer
// (Slack / Twitter / LinkedIn / Discord / iMessage) fetches the
// article HTML, the OG + Twitter tags below drive the preview card
// off the article's own title + description + author, not the
// generic site chrome.
//
// 404 path: if the slug doesn't resolve, return a plain title with
// no og:type=article so crawlers don't cache the 404 as a real
// article preview (AC scenario 4).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);

  if (!article) {
    return { title: "Article not found — Conduit" };
  }

  const url = `${siteUrl()}/article/${encodeURIComponent(article.slug)}`;
  const title = `${article.title} — Conduit`;

  return {
    title,
    description: article.description,
    openGraph: {
      title: article.title,
      description: article.description,
      type: "article",
      url,
      ...(article.author.image ? { images: [article.author.image] } : {}),
    },
    twitter: {
      card: "summary",
      title: article.title,
      description: article.description,
      ...(article.author.image ? { images: [article.author.image] } : {}),
    },
  };
}

// Article detail page (#18). RSC: fetches article + viewer state
// up-front (needed for the banner + meta), then streams the comments
// region independently via <Suspense>. #114 split the comments off
// the critical path so the banner + body paint as soon as
// `getArticle` resolves.

// Test-only delay knob — see apps/web/src/app/page.tsx for the same
// pattern. Gated on CONDUIT_TEST_SLOW_SUSPENSE=1 so production
// deployments can never accept a `?slow` param.
const testSlowMs = (raw: string | string[] | undefined): number => {
  if (process.env.CONDUIT_TEST_SLOW_SUSPENSE !== "1") return 0;
  const val = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(val ?? "0", 10);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : 0;
};

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const slowMs = testSlowMs(sp.slow);

  // Article + viewer state on the critical path — banner + meta
  // can't render without them.
  const [article, authed, viewerUsername] = await Promise.all([
    getArticle(slug),
    isAuthenticated(),
    readCurrentUsername(),
  ]);

  if (!article) {
    notFound();
  }

  // Kick off comments immediately but don't await — hand the
  // pending Promise into the <Suspense>-wrapped child so the
  // parent render completes with the banner + body while comments
  // stream in behind the skeleton.
  const commentsPromise = listComments(article.slug);

  return (
    <div className="article-page">
      <div className="banner">
        <div className="container">
          <h1>{article.title}</h1>
          <ArticleMeta
            article={article}
            viewerUsername={viewerUsername}
            authed={authed}
          />
        </div>
      </div>

      <div className="container page">
        <ArticleBody body={article.body} tagList={article.tagList} />

        <hr />

        <div className="article-actions">
          <ArticleMeta
            article={article}
            viewerUsername={viewerUsername}
            authed={authed}
          />
        </div>

        <div className="row">
          <div className="col-xs-12 col-md-8 offset-md-2">
            <Suspense fallback={<CommentsSkeleton />}>
              <AsyncComments
                slug={article.slug}
                commentsPromise={commentsPromise}
                authed={authed}
                viewerUsername={viewerUsername}
                slowMs={slowMs}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

const AsyncComments = async ({
  slug,
  commentsPromise,
  authed,
  viewerUsername,
  slowMs,
}: {
  slug: string;
  commentsPromise: Promise<Comment[]>;
  authed: boolean;
  viewerUsername: string | null;
  slowMs: number;
}) => {
  if (slowMs > 0) {
    await new Promise((r) => setTimeout(r, slowMs));
  }
  const comments = await commentsPromise;
  return (
    <section aria-label="Comments">
      <h2 className="sr-only">Comments</h2>
      {authed && viewerUsername ? (
        <CommentForm slug={slug} avatar={null} username={viewerUsername} />
      ) : (
        <p>
          <Link href="/login">Sign in</Link> or{" "}
          <Link href="/register">sign up</Link> to add comments on this article.
        </p>
      )}
      <CommentList
        slug={slug}
        comments={comments}
        viewerUsername={viewerUsername}
      />
    </section>
  );
};

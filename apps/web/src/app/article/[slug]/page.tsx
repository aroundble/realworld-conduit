import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/article/ArticleBody";
import { ArticleMeta } from "@/components/article/ArticleMeta";
import { CommentList } from "@/components/comment/CommentList";
import { CommentForm } from "@/components/comment/CommentForm";
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

// Article detail page (#18). RSC: fetches article + comments + viewer
// state in parallel, renders banner + meta + body + tag list + comments
// region. Interactive buttons (follow, favorite, delete, comment form /
// delete-comment) are client components that wrap server actions so
// the initial paint is fully SSR'd and SEO-friendly.

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Parallel fetches: the article + comments + viewer cookie read are
  // independent, so don't serialize them. getArticle returns null on
  // 404 so we can call notFound() for the correct Next.js 404 flow;
  // listComments returns [] on 404, which is defensive — the article
  // check already filters that case.
  const [article, comments, authed, viewerUsername] = await Promise.all([
    getArticle(slug),
    listComments(slug),
    isAuthenticated(),
    readCurrentUsername(),
  ]);

  if (!article) {
    notFound();
  }

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
            <CommentsRegion
              slug={article.slug}
              comments={comments}
              authed={authed}
              viewerUsername={viewerUsername}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const CommentsRegion = ({
  slug,
  comments,
  authed,
  viewerUsername,
}: {
  slug: string;
  comments: Comment[];
  authed: boolean;
  viewerUsername: string | null;
}) => {
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

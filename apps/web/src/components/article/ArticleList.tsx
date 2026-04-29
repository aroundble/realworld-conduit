import Link from "next/link";
import { ArticlePreview } from "@/components/article/ArticlePreview";
import { EmptyState } from "@/components/EmptyState";
import type { ArticleListItem } from "@/features/articles/queries";

// Context drives the empty-state copy (#127). Each surface that
// renders an article list has its own first-run nudge — an empty
// "your feed" is qualitatively different from an empty tag filter
// or an empty profile-favorited tab. Callers pick the right
// context; ArticleList owns the copy so it stays consistent.
export type ArticleListContext =
  | "global-feed"
  | "your-feed"
  | "tag"
  | "profile-authored"
  | "profile-favorited";

type Props = {
  articles: ArticleListItem[];
  articlesCount: number;
  limit: number;
  currentPage: number;
  // The base href the paginator writes page= onto. Caller assembles
  // the rest of the query string (feed, tag) so links round-trip the
  // current filter state rather than resetting it on page change.
  pagePath: string;
  // Propagates to FavoriteButton on each preview; see #56 scenario 4
  // for the anon click-to-login path.
  authed: boolean;
  // Empty-state context (#127). Defaults to `global-feed` for backward
  // compat with any caller that didn't opt in yet.
  context?: ArticleListContext;
  // Optional — tag name used in the `tag` empty-state body. Safe to
  // omit for other contexts.
  tagLabel?: string;
};

type EmptyCopy = {
  title: string;
  body: string;
  actions?: React.ReactNode;
};

const emptyCopyFor = (
  context: ArticleListContext,
  tagLabel: string | undefined,
): EmptyCopy => {
  switch (context) {
    case "your-feed":
      return {
        title: "Your feed is empty",
        body: "You haven't followed any authors yet. Discover popular writing on the global feed or browse by tag.",
        actions: (
          <>
            <Link href="/">Global feed</Link>
          </>
        ),
      };
    case "tag":
      return {
        title: "No articles for this tag",
        body: tagLabel
          ? `Nothing's been tagged "${tagLabel}" yet. Be the first — publish an article with this tag.`
          : "Nothing's been tagged with this label yet.",
        actions: (
          <>
            <Link href="/">Global feed</Link>
          </>
        ),
      };
    case "profile-authored":
      return {
        title: "No articles yet",
        body: "This user hasn't published anything yet.",
      };
    case "profile-favorited":
      return {
        title: "No favorites yet",
        body: "Browse the global feed to find articles worth saving.",
        actions: (
          <>
            <Link href="/">Global feed</Link>
          </>
        ),
      };
    case "global-feed":
    default:
      return {
        title: "No articles have been published yet",
        body: "If you're the first visitor, register and share your first article.",
        actions: (
          <>
            <Link href="/register">Register</Link>
          </>
        ),
      };
  }
};

// Pagination matches the RealWorld reference: 1-based page index that
// paints as `?page=N`. For the 40-article example in AC scenario 6
// with limit=20, page 2 shows articles 21-40 and the paginator
// displays links 1 + 2.
const buildPageHref = (pagePath: string, page: number): string => {
  // pagePath may already contain `?feed=you&tag=dragons`. We append
  // `&page=N` or `?page=N` accordingly. A simple prefix check avoids
  // pulling URL parsing into every render.
  const sep = pagePath.includes("?") ? "&" : "?";
  return `${pagePath}${sep}page=${page}`;
};

export const ArticleList = ({
  articles,
  articlesCount,
  limit,
  currentPage,
  pagePath,
  authed,
  context = "global-feed",
  tagLabel,
}: Props) => {
  if (articles.length === 0) {
    const copy = emptyCopyFor(context, tagLabel);
    return (
      <div className="article-preview">
        <EmptyState
          title={copy.title}
          body={copy.body}
          actions={copy.actions}
          testId={`empty-state-${context}`}
        />
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(articlesCount / limit));
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <>
      {articles.map((article) => (
        <ArticlePreview article={article} authed={authed} key={article.slug} />
      ))}
      {pageCount > 1 ? (
        <ul className="pagination">
          {pages.map((page) => (
            <li
              className={`page-item${page === currentPage ? " active" : ""}`}
              key={page}
            >
              <Link className="page-link" href={buildPageHref(pagePath, page)}>
                {page}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

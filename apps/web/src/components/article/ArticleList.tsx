import Link from "next/link";
import { ArticlePreview } from "@/components/article/ArticlePreview";
import type { Article } from "@/features/articles/queries";

type Props = {
  articles: Article[];
  articlesCount: number;
  limit: number;
  currentPage: number;
  // The base href the paginator writes page= onto. Caller assembles
  // the rest of the query string (feed, tag) so links round-trip the
  // current filter state rather than resetting it on page change.
  pagePath: string;
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
}: Props) => {
  if (articles.length === 0) {
    return (
      <div className="article-preview">
        <p>No articles are here... yet.</p>
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(articlesCount / limit));
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <>
      {articles.map((article) => (
        <ArticlePreview article={article} key={article.slug} />
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

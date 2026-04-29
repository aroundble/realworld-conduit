import Link from "next/link";
import type { ArticleListItem } from "@/features/articles/queries";
import { ArticlePreviewLink } from "./ArticlePreviewLink";
import { FavoriteButton } from "./FavoriteButton";

// Pattern adapted from yukicountry/realworld-nextjs-rsc @ f455599f
// (`src/modules/features/article/preview-card.tsx`, MIT). The favorite
// button is the interactive `FavoriteButton` client component from
// #18/#56 — compact variant, optimistic update, click-to-login for
// anon viewers. Styling class names match the RealWorld reference.

type Props = {
  article: ArticleListItem;
  // Authed status propagates from the RSC page (`/`, `/profile/*`, etc.)
  // so the favorite button knows whether to POST or redirect to /login.
  authed: boolean;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export const ArticlePreview = ({ article, authed }: Props) => {
  return (
    <div className="article-preview">
      <div className="article-meta">
        <Link href={`/profile/${article.author.username}`}>
          {/*
            Using a plain <img> rather than next/image: avatar URLs come
            from arbitrary user input (article.author.image), and
            next/image requires declaring every hostname up front in
            next.config.ts. Accepting the LCP warning keeps the avatar
            surface open without hardcoding an allowlist that would bite
            us every time a new profile hoster shows up.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={`${article.author.username}'s avatar`}
            src={article.author.image ?? "/default-avatar.svg"}
          />
        </Link>
        <div className="info">
          <Link
            href={`/profile/${article.author.username}`}
            className="author"
          >
            {article.author.username}
          </Link>
          <span className="date">{formatDate(article.createdAt)}</span>
          <span className="read-time" data-testid="read-time">
            {article.readingTimeMinutes} min read
          </span>
        </div>
        <FavoriteButton
          slug={article.slug}
          favorited={article.favorited}
          favoritesCount={article.favoritesCount}
          authed={authed}
          variant="compact"
        />
      </div>
      <ArticlePreviewLink
        href={`/article/${article.slug}`}
        className="preview-link"
      >
        <h1>{article.title}</h1>
        <p>{article.description}</p>
        <span>Read more...</span>
        {article.tagList.length > 0 ? (
          <ul className="tag-list">
            {article.tagList.map((tag) => (
              <li className="tag-default tag-pill tag-outline" key={tag}>
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </ArticlePreviewLink>
    </div>
  );
};

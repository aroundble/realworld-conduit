import Link from "next/link";
import type { ArticleListItem } from "@/features/articles/queries";

// Pattern adapted from yukicountry/realworld-nextjs-rsc @ f455599f
// (`src/modules/features/article/preview-card.tsx`, MIT). The favorite
// button is rendered as a non-interactive badge here — the homepage
// contract in #17 (post-rescope) is envelope-driven display only; the
// interactive click→favorite toggle ships in the follow-up issue #56.
// Styling class names match the RealWorld reference so the shared
// globals.css works without overrides.

type Props = {
  article: ArticleListItem;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export const ArticlePreview = ({ article }: Props) => {
  const favoriteClass = article.favorited
    ? "btn btn-sm btn-primary"
    : "btn btn-sm btn-outline-primary";

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
        </div>
        {/*
          Non-interactive badge: the outlined/filled state tracks
          `article.favorited` but the element is a plain button with
          `disabled` so assistive tech and click handlers don't treat
          it as actionable. #56 ships the client-component version
          that handles the POST round-trip + optimistic update.
        */}
        <button
          className={`${favoriteClass} pull-xs-right`}
          type="button"
          disabled
          aria-label={`favorites: ${article.favoritesCount}`}
        >
          <i className="ion-heart" /> {article.favoritesCount}
        </button>
      </div>
      <Link href={`/article/${article.slug}`} className="preview-link">
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
      </Link>
    </div>
  );
};

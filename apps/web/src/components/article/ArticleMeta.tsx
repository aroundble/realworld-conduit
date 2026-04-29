import Link from "next/link";
import type { Article } from "@/features/articles/queries";
import { FollowButton } from "./FollowButton";
import { FavoriteButton } from "./FavoriteButton";
import { DeleteArticleButton } from "./DeleteArticleButton";

type Props = {
  article: Article;
  viewerUsername: string | null;
  authed: boolean;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
};

// Article author line + action buttons. Reused by both the banner
// (top of page) and the footer meta (below body) per the RealWorld
// UI spec — content identical, wrapper differs.
export const ArticleMeta = ({ article, viewerUsername, authed }: Props) => {
  const isOwn = viewerUsername === article.author.username;
  const profileHref = `/profile/${encodeURIComponent(article.author.username)}`;

  return (
    <div className="article-meta">
      <Link href={profileHref}>
        {article.author.image ? (
          // Remote user-supplied avatar URLs don't belong in next/image's
          // domains allowlist; the bitmap is tiny (32–64 px) and cached
          // by the browser. Matches the pattern in Navbar / ArticlePreview.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.author.image} alt={`${article.author.username} avatar`} />
        ) : null}
      </Link>
      <div className="info">
        <Link href={profileHref} className="author">
          {article.author.username}
        </Link>
        <span className="date">{formatDate(article.createdAt)}</span>
      </div>
      {isOwn ? (
        <>
          <Link
            href={`/editor/${encodeURIComponent(article.slug)}`}
            className="btn btn-sm btn-outline-secondary"
          >
            <span aria-hidden="true">✎</span> Edit Article
          </Link>
          &nbsp;&nbsp;
          <DeleteArticleButton slug={article.slug} />
        </>
      ) : authed ? (
        <>
          <FollowButton
            username={article.author.username}
            following={article.author.following}
          />
          &nbsp;&nbsp;
          <FavoriteButton
            slug={article.slug}
            favorited={article.favorited}
            favoritesCount={article.favoritesCount}
            authed={true}
          />
        </>
      ) : (
        <>
          <Link href="/login" className="btn btn-sm btn-outline-secondary">
            <span aria-hidden="true">+</span> Follow {article.author.username}
          </Link>
          &nbsp;&nbsp;
          <Link href="/login" className="btn btn-sm btn-outline-primary">
            <span aria-hidden="true">♥</span> Favorite Article ({article.favoritesCount})
          </Link>
        </>
      )}
    </div>
  );
};

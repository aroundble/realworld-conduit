import type { Comment } from "@/features/articles/queries";
import { DeleteCommentButton } from "./DeleteCommentButton";

type Props = {
  slug: string;
  comment: Comment;
  viewerUsername: string | null;
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

export const CommentItem = ({ slug, comment, viewerUsername }: Props) => {
  const isOwn = viewerUsername === comment.author.username;
  return (
    <div className="card" data-testid={`comment-${comment.id}`}>
      <div className="card-block">
        <p className="card-text">{comment.body}</p>
      </div>
      <div className="card-footer">
        <a
          href={`/profile/${encodeURIComponent(comment.author.username)}`}
          className="comment-author"
        >
          {comment.author.image ? (
            // Tiny comment-author avatar; see established pattern in
            // Navbar / ArticlePreview for plain <img> vs next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={comment.author.image}
              alt={`${comment.author.username} avatar`}
              className="comment-author-img"
            />
          ) : null}
        </a>
        &nbsp;
        <a
          href={`/profile/${encodeURIComponent(comment.author.username)}`}
          className="comment-author"
        >
          {comment.author.username}
        </a>
        <span className="date-posted">{formatDate(comment.createdAt)}</span>
        {isOwn ? (
          <DeleteCommentButton slug={slug} commentId={comment.id} />
        ) : null}
      </div>
    </div>
  );
};

import { RelativeTime } from "@/components/RelativeTime";
import type { Comment } from "@/features/articles/queries";
import { DeleteCommentButton } from "./DeleteCommentButton";

type Props = {
  slug: string;
  comment: Comment;
  viewerUsername: string | null;
};

export const CommentItem = ({ slug, comment, viewerUsername }: Props) => {
  const isOwn = viewerUsername === comment.author.username;
  return (
    <div className="card" data-testid={`comment-${comment.id}`}>
      <div className="card-block">
        <p className="card-text">{comment.body}</p>
      </div>
      <div className="card-footer">
        {comment.author.image ? (
          <a
            href={`/profile/${encodeURIComponent(comment.author.username)}`}
            className="comment-author"
            aria-label={`${comment.author.username} profile`}
          >
            {/* Tiny comment-author avatar; see established pattern in
                Navbar / ArticlePreview for plain <img> vs next/image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={comment.author.image}
              alt={`${comment.author.username} avatar`}
              className="comment-author-img"
            />
          </a>
        ) : null}
        &nbsp;
        <a
          href={`/profile/${encodeURIComponent(comment.author.username)}`}
          className="comment-author"
        >
          {comment.author.username}
        </a>
        <RelativeTime iso={comment.createdAt} className="date-posted" />
        {isOwn ? (
          <DeleteCommentButton slug={slug} commentId={comment.id} />
        ) : null}
      </div>
    </div>
  );
};

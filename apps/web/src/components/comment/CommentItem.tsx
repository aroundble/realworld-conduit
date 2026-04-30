import { RelativeTime } from "@/components/RelativeTime";
import type { Comment } from "@/features/articles/queries";
import { DeleteCommentButton } from "./DeleteCommentButton";
import { EditableCommentBody } from "./EditableCommentBody";

type Props = {
  slug: string;
  comment: Comment;
  viewerUsername: string | null;
};

// 5 seconds of tolerance for clock skew between the DB
// createdAt default and the service-level updatedAt that runs
// a few ms later. Anything past this window counts as an edit.
const EDIT_TOLERANCE_MS = 5000;

const wasEdited = (createdAt: string, updatedAt: string): boolean => {
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  return updated - created > EDIT_TOLERANCE_MS;
};

export const CommentItem = ({ slug, comment, viewerUsername }: Props) => {
  const isDeleted = Boolean(comment.deletedAt);
  const isOwn = !isDeleted && viewerUsername === comment.author.username;
  const edited =
    !isDeleted && wasEdited(comment.createdAt, comment.updatedAt);

  // Soft-deleted placeholder (#171). Render a grayed-out card so
  // the thread preserves its shape (later replies stay anchored,
  // comment-count in the banner is unchanged). No Edit / Delete
  // controls — a soft-deleted comment is terminal; the author
  // cannot rewrite history.
  if (isDeleted) {
    return (
      <div
        className="card comment-deleted"
        data-testid={`comment-${comment.id}`}
        data-deleted="true"
      >
        <div className="card-block">
          <p
            className="card-text comment-deleted-body"
            data-testid={`comment-body-${comment.id}`}
          >
            {comment.body}
          </p>
        </div>
        <div className="card-footer">
          <span className="comment-author comment-deleted-author">
            {comment.author.username}
          </span>
          <RelativeTime iso={comment.createdAt} className="date-posted" />
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid={`comment-${comment.id}`}>
      <EditableCommentBody
        slug={slug}
        commentId={comment.id}
        initialBody={comment.body}
        canEdit={isOwn}
      />
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
        {edited ? (
          <time
            className="comment-edited-badge"
            dateTime={comment.updatedAt}
            title={`edited ${new Date(comment.updatedAt).toLocaleString()}`}
            data-testid={`comment-edited-badge-${comment.id}`}
          >
            (edited)
          </time>
        ) : null}
        {isOwn ? (
          <DeleteCommentButton slug={slug} commentId={comment.id} />
        ) : null}
      </div>
    </div>
  );
};

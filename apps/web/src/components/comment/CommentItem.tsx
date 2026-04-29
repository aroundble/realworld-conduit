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
  const isOwn = viewerUsername === comment.author.username;
  const edited = wasEdited(comment.createdAt, comment.updatedAt);
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

import type { Comment } from "@/features/articles/queries";
import { CommentItem } from "./CommentItem";

type Props = {
  slug: string;
  comments: Comment[];
  viewerUsername: string | null;
};

export const CommentList = ({ slug, comments, viewerUsername }: Props) => {
  if (comments.length === 0) {
    return <p className="empty-comments">No comments yet.</p>;
  }
  // Newest first per AC scenario 5. The API lists by createdAt desc
  // already; re-sort defensively in case that ordering is ever
  // relaxed upstream.
  const sorted = [...comments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <div data-testid="comment-list">
      {sorted.map((c) => (
        <CommentItem
          key={c.id}
          slug={slug}
          comment={c}
          viewerUsername={viewerUsername}
        />
      ))}
    </div>
  );
};

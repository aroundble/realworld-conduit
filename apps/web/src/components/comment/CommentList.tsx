import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { Comment } from "@/features/articles/queries";
import { CommentItem } from "./CommentItem";

type Props = {
  slug: string;
  comments: Comment[];
  viewerUsername: string | null;
};

export const CommentList = ({ slug, comments, viewerUsername }: Props) => {
  if (comments.length === 0) {
    // Authed viewers see a nudge toward the comment-compose form that
    // sits beside this list (next in tab order per AC). Anon viewers
    // get a /login?redirect=... link so they can come back to this
    // article after signing in.
    const authed = viewerUsername !== null;
    return (
      <EmptyState
        testId="empty-comments"
        className="empty-comments"
        title="No comments yet"
        body={
          authed
            ? "Start the discussion."
            : "Sign in to start the discussion."
        }
        actions={
          authed ? undefined : (
            <Link
              href={`/login?redirect=${encodeURIComponent(`/article/${slug}`)}`}
            >
              Sign in
            </Link>
          )
        }
      />
    );
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

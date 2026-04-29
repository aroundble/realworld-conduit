import { Shimmer } from "./Shimmer";

// Comment-thread placeholder shown while listComments is in flight
// (wrapped in a <Suspense> boundary on the article detail page).
export const CommentsSkeleton = () => {
  return (
    <section
      aria-label="Loading comments"
      aria-busy="true"
      aria-live="polite"
      data-testid="comments-skeleton"
      className="skeleton-comments"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="card comment-skeleton"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            padding: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <Shimmer width="90%" />
          <Shimmer width="70%" />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Shimmer width="24px" height="24px" style={{ borderRadius: "50%" }} />
            <Shimmer width="120px" height="0.8rem" />
          </div>
        </div>
      ))}
    </section>
  );
};

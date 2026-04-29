import { Shimmer } from "./Shimmer";

// Article-preview list placeholder (#114). Renders 3 preview-card
// shaped rows — enough to occupy the fold without being distracting.
export const ArticleListSkeleton = () => {
  return (
    <div
      className="skeleton-article-list"
      aria-busy="true"
      aria-live="polite"
      data-testid="article-list-skeleton"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="article-preview skeleton-article-preview"
          style={{
            padding: "1rem 0",
            borderBottom: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <Shimmer width="32px" height="32px" style={{ borderRadius: "50%" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <Shimmer width="140px" height="0.9rem" />
              <Shimmer width="80px" height="0.7rem" />
            </div>
          </div>
          <Shimmer width="75%" height="1.5rem" style={{ marginBottom: "0.4rem" }} />
          <Shimmer width="95%" />
        </div>
      ))}
    </div>
  );
};

import { Shimmer } from "./Shimmer";

// Banner + body placeholder for /article/[slug] (#114).
export const ArticleDetailSkeleton = () => {
  return (
    <div
      className="article-page skeleton-article"
      aria-busy="true"
      aria-live="polite"
      data-testid="article-detail-skeleton"
    >
      <div className="banner">
        <div className="container">
          <Shimmer
            width="70%"
            height="2.5rem"
            style={{ marginBottom: "1rem" }}
          />
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Shimmer
              width="32px"
              height="32px"
              style={{ borderRadius: "50%" }}
            />
            <Shimmer width="160px" height="1rem" />
          </div>
        </div>
      </div>
      <div className="container page">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <Shimmer width="95%" />
          <Shimmer width="92%" />
          <Shimmer width="88%" />
          <Shimmer width="75%" />
        </div>
      </div>
    </div>
  );
};

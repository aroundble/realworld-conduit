import { Shimmer } from "./Shimmer";

// Sidebar tag-cloud placeholder (#114). The real TagCloud renders a
// .sidebar with "Popular Tags" heading + pill cloud; the skeleton
// mimics that envelope so layout doesn't shift on resolve.
export const TagCloudSkeleton = () => {
  return (
    <div
      className="sidebar skeleton-tag-cloud"
      aria-busy="true"
      aria-live="polite"
      data-testid="tag-cloud-skeleton"
    >
      <p>Popular Tags</p>
      <div
        className="tag-list"
        style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}
      >
        {[60, 48, 72, 55, 40, 68, 50, 45, 62, 38].map((w, i) => (
          <Shimmer
            key={i}
            width={`${w}px`}
            height="1.2rem"
            style={{ borderRadius: "10rem" }}
          />
        ))}
      </div>
    </div>
  );
};

import Link from "next/link";

export type FeedMode = "global" | "you" | "tag";

type Props = {
  activeMode: FeedMode;
  activeTag?: string;
  // Authenticated viewers see "Your Feed" as the first tab. Anonymous
  // visitors only see Global (and the per-tag tab when one is pinned).
  showYourFeed: boolean;
};

// URL-driven feed switching — no client state. Each tab is a <Link>
// that navigates to the homepage with the right search-params set.
// When a tag is currently pinned (activeMode="tag"), a third tab
// `# <tag>` is rendered; clicking Global or Your Feed drops the tag
// (href omits the `tag` param).
export const FeedTabs = ({ activeMode, activeTag, showYourFeed }: Props) => {
  const tabClass = (mode: FeedMode) =>
    `nav-link${activeMode === mode ? " active" : ""}`;

  return (
    <div className="feed-toggle">
      <ul className="nav nav-pills outline-active">
        {showYourFeed ? (
          <li className="nav-item">
            <Link className={tabClass("you")} href="/?feed=you">
              Your Feed
            </Link>
          </li>
        ) : null}
        <li className="nav-item">
          <Link className={tabClass("global")} href="/">
            Global Feed
          </Link>
        </li>
        {activeMode === "tag" && activeTag ? (
          <li className="nav-item">
            <Link
              className={tabClass("tag")}
              href={`/?tag=${encodeURIComponent(activeTag)}`}
            >
              <i className="ion-pound" /># {activeTag}
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
};

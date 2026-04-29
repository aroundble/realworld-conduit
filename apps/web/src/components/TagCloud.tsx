import Link from "next/link";

type Props = {
  tags: string[];
  // When a tag is currently selected (via ?tag= in the URL), highlight
  // it so the sidebar reflects "you're looking at articles for this
  // tag". Purely visual — the active tab is driven by FeedTabs.
  activeTag?: string;
};

// Tag sidebar — clicking a pill navigates to `/?tag=<name>`. Plain
// anchor / next/link, no client state, so server rendering keeps
// working for anon + authed callers alike.
export const TagCloud = ({ tags, activeTag }: Props) => {
  if (tags.length === 0) {
    return (
      <div className="sidebar">
        <p>Popular Tags</p>
        <p>No tags are here... yet.</p>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <p>Popular Tags</p>
      <div className="tag-list">
        {tags.map((tag) => (
          <Link
            className={`tag-pill tag-default${
              tag === activeTag ? " tag-primary" : ""
            }`}
            href={`/?tag=${encodeURIComponent(tag)}`}
            key={tag}
          >
            {tag}
          </Link>
        ))}
      </div>
    </div>
  );
};

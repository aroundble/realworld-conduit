import { ArticleList } from "@/components/article/ArticleList";
import { FeedTabs, type FeedMode } from "@/components/FeedTabs";
import { TagCloud } from "@/components/TagCloud";
import {
  feedArticles,
  listArticles,
  listTopTags,
  type ArticleListPayload,
} from "@/features/articles/queries";
import { isAuthenticated } from "@/features/auth/session";

// Home page. RSC; reads search params + session cookie, picks the
// article source (global list vs personalised feed vs tag-filtered
// list), and renders the RealWorld banner + feed tabs + article list +
// tag sidebar in one server render. No client components — the
// interactive favorite button lands in follow-up issue #56.

const PAGE_SIZE = 20;

type SearchParams = { [key: string]: string | string[] | undefined };

const getString = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const parsePage = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

const buildPagePath = (mode: FeedMode, tag: string | undefined): string => {
  if (mode === "you") return "/?feed=you";
  if (mode === "tag" && tag) return `/?tag=${encodeURIComponent(tag)}`;
  return "/";
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tag = getString(params.tag);
  const feedParam = getString(params.feed);
  const currentPage = parsePage(getString(params.page));
  const offset = (currentPage - 1) * PAGE_SIZE;

  const authed = await isAuthenticated();
  // Mode selection: a pinned tag wins over feed=you (clicking a tag
  // switches away from the feed tab). Anonymous callers can't see
  // their feed, so feed=you silently falls back to global for them.
  let mode: FeedMode;
  if (tag) {
    mode = "tag";
  } else if (feedParam === "you" && authed) {
    mode = "you";
  } else {
    mode = "global";
  }

  // Load articles + tags in parallel. Empty list stays empty (scenario
  // 7); any fetch failure bubbles up as a 500, which the Next.js
  // default error boundary handles — we don't want the homepage to
  // silently render a half-populated state.
  let payload: ArticleListPayload;
  if (mode === "you") {
    payload = await feedArticles({ limit: PAGE_SIZE, offset });
  } else {
    payload = await listArticles({
      tag: mode === "tag" ? tag : undefined,
      limit: PAGE_SIZE,
      offset,
    });
  }
  const tagsPayload = await listTopTags();

  return (
    <div className="home-page">
      <div className="banner">
        <div className="container">
          <h1 className="logo-font">conduit</h1>
          <p>A place to share your knowledge.</p>
        </div>
      </div>

      <div className="container page">
        <div className="row">
          <div className="col-md-9">
            <FeedTabs
              activeMode={mode}
              activeTag={tag}
              showYourFeed={authed}
            />
            <ArticleList
              articles={payload.articles}
              articlesCount={payload.articlesCount}
              limit={PAGE_SIZE}
              currentPage={currentPage}
              pagePath={buildPagePath(mode, tag)}
            />
          </div>
          <div className="col-md-3">
            <TagCloud tags={tagsPayload.tags} activeTag={tag} />
          </div>
        </div>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { ArticleList } from "@/components/article/ArticleList";
import { FeedTabs, type FeedMode } from "@/components/FeedTabs";
import { TagCloud } from "@/components/TagCloud";
import { TagCloudSkeleton } from "@/components/skeletons/TagCloudSkeleton";
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

// When CONDUIT_TEST_SLOW_SUSPENSE=1 (set in the dev compose env), a
// `?slow=<ms>` querystring inserts an artificial delay in the
// Suspense-wrapped children. Used only by tests/e2e/specs/114 to
// observe the streaming fallback deterministically. Ignored otherwise.
const testSlowMs = (raw: string | undefined): number => {
  if (process.env.CONDUIT_TEST_SLOW_SUSPENSE !== "1") return 0;
  const n = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : 0;
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
  const slowMs = testSlowMs(getString(params.slow));

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

  // Articles + tags fetch in parallel. Articles stay on the critical
  // path because the feed tabs' render depends on `payload` shape;
  // tags stream separately through <Suspense> so a slow tags query
  // (#14 tag-count aggregation) doesn't block the article list
  // first-paint. Any fetch failure bubbles up as a 500 — the Next
  // default error boundary handles it.
  const articlesPromise: Promise<ArticleListPayload> =
    mode === "you"
      ? feedArticles({ limit: PAGE_SIZE, offset })
      : listArticles({
          tag: mode === "tag" ? tag : undefined,
          limit: PAGE_SIZE,
          offset,
        });
  const tagsPromise = listTopTags();
  const payload = await articlesPromise;

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
              authed={authed}
            />
          </div>
          <div className="col-md-3">
            <Suspense fallback={<TagCloudSkeleton />}>
              <AsyncTagCloud
                tagsPromise={tagsPromise}
                activeTag={tag}
                slowMs={slowMs}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

const AsyncTagCloud = async ({
  tagsPromise,
  activeTag,
  slowMs,
}: {
  tagsPromise: Promise<{ tags: string[] }>;
  activeTag: string | undefined;
  slowMs: number;
}) => {
  if (slowMs > 0) {
    await new Promise((r) => setTimeout(r, slowMs));
  }
  const tagsPayload = await tagsPromise;
  return <TagCloud tags={tagsPayload.tags} activeTag={activeTag} />;
};

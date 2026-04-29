import { Suspense } from "react";
import { ArticleList } from "@/components/article/ArticleList";
import { SearchBar } from "@/components/article/SearchBar";
import { FeedTabs, type FeedMode } from "@/components/FeedTabs";
import { JsonLd } from "@/components/JsonLd";
import { TagCloud } from "@/components/TagCloud";
import { TagCloudSkeleton } from "@/components/skeletons/TagCloudSkeleton";
import {
  feedArticles,
  listArticles,
  listTopTags,
  type ArticleListPayload,
} from "@/features/articles/queries";
import { isAuthenticated } from "@/features/auth/session";
import { buildWebSiteJsonLd } from "@/lib/jsonld";

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

const buildPagePath = (
  mode: FeedMode,
  tag: string | undefined,
  q: string | undefined,
): string => {
  const params = new URLSearchParams();
  if (mode === "you") params.set("feed", "you");
  if (mode === "tag" && tag) params.set("tag", tag);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
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
  const rawQ = getString(params.q);
  // Clamp to the API's bounded range on the web side too — a 1-char
  // `?q=r` from a hand-typed URL shouldn't even hit the API.
  const q =
    rawQ && rawQ.trim().length >= 2 && rawQ.length <= 100
      ? rawQ.trim()
      : undefined;
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

  // Articles stay on the critical path (feed-tabs render depends
  // on the payload shape). Tags stream separately via <Suspense>
  // from #114. Search (#117) adds `q` to the listArticles filter
  // on every non-feed branch; `q` on feed is a separate API surface
  // (out-of-scope) so dropping it silently for Your Feed is the
  // least-surprising behaviour.
  const articlesPromise: Promise<ArticleListPayload> =
    mode === "you"
      ? feedArticles({ limit: PAGE_SIZE, offset })
      : listArticles({
          tag: mode === "tag" ? tag : undefined,
          q,
          limit: PAGE_SIZE,
          offset,
        });
  const tagsPromise = listTopTags();
  const payload = await articlesPromise;

  return (
    <div className="home-page">
      {/* WebSite + SearchAction JSON-LD (#148). Search engines
          render an in-SERP search box for the site when this is
          present. The action template points at /?q={search} —
          same URL SearchBar (#117) emits. */}
      <JsonLd payload={buildWebSiteJsonLd()} id="jsonld-website" />
      <div className="banner">
        <div className="container">
          <h1 className="logo-font">conduit</h1>
          <p>A place to share your knowledge.</p>
        </div>
      </div>

      <div className="container page">
        <div className="row">
          <div className="col-md-9">
            <SearchBar initialQ={q ?? ""} />
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
              pagePath={buildPagePath(mode, tag, q)}
              authed={authed}
              context={
                mode === "you"
                  ? "your-feed"
                  : mode === "tag"
                    ? "tag"
                    : "global-feed"
              }
              tagLabel={mode === "tag" ? tag : undefined}
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

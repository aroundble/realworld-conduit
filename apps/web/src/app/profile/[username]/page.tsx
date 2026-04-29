import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleList } from "@/components/article/ArticleList";
import { JsonLd } from "@/components/JsonLd";
import { ProfileBanner } from "@/components/profile/ProfileBanner";
import { ArticleListSkeleton } from "@/components/skeletons/ArticleListSkeleton";
import {
  listArticles,
  type ArticleListPayload,
} from "@/features/articles/queries";
import {
  isAuthenticated,
  readCurrentUsername,
} from "@/features/auth/session";
import { getProfile } from "@/features/profiles/queries";
import { buildPersonJsonLd } from "@/lib/jsonld";
import { siteUrl } from "@/lib/site";

// Dynamic share-preview metadata (#113). See the article page's
// generateMetadata for the broader rationale.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return { title: "Profile not found — Conduit" };
  }

  // Fallback copy when the user hasn't written a bio — keeps the
  // preview card informative instead of empty.
  const description =
    profile.bio && profile.bio.trim().length > 0
      ? profile.bio
      : `View ${profile.username}'s articles on Conduit`;
  const url = `${siteUrl()}/profile/${encodeURIComponent(profile.username)}`;

  return {
    title: `${profile.username} — Conduit`,
    description,
    openGraph: {
      title: profile.username,
      description,
      type: "profile",
      url,
      ...(profile.image ? { images: [profile.image] } : {}),
    },
    twitter: {
      card: "summary",
      title: profile.username,
      description,
      ...(profile.image ? { images: [profile.image] } : {}),
    },
  };
}

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

// Test-only Suspense delay — see apps/web/src/app/page.tsx.
const testSlowMs = (raw: string | undefined): number => {
  if (process.env.CONDUIT_TEST_SLOW_SUSPENSE !== "1") return 0;
  const n = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : 0;
};

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { username } = await params;
  const sp = await searchParams;
  const tab = getString(sp.tab) === "favorited" ? "favorited" : "authored";
  const currentPage = parsePage(getString(sp.page));
  const offset = (currentPage - 1) * PAGE_SIZE;
  const slowMs = testSlowMs(getString(sp.slow));

  const [profile, authed, viewerUsername] = await Promise.all([
    getProfile(username),
    isAuthenticated(),
    readCurrentUsername(),
  ]);

  if (!profile) {
    notFound();
  }

  // Articles for the selected tab — kicked off immediately, streamed
  // behind <Suspense> so the banner paints before this resolves.
  // `author=` for "My Articles", `favorited=` for "Favorited Articles"
  // — both reach the same /api/articles endpoint per spec.
  const articlesPromise: Promise<ArticleListPayload> = listArticles(
    tab === "favorited"
      ? { favorited: profile.username, limit: PAGE_SIZE, offset }
      : { author: profile.username, limit: PAGE_SIZE, offset },
  );

  const tabPath = `/profile/${encodeURIComponent(profile.username)}`;
  const pagePath =
    tab === "favorited" ? `${tabPath}?tab=favorited` : tabPath;

  return (
    <div className="profile-page">
      {/* Person JSON-LD (#148). Profile pages opt into Person
          rich-results. */}
      <JsonLd payload={buildPersonJsonLd(profile)} id="jsonld-person" />
      <ProfileBanner
        profile={profile}
        viewerUsername={viewerUsername}
        authed={authed}
      />

      <div className="container">
        <div className="row">
          <div className="col-xs-12 col-md-10 offset-md-1">
            <div className="articles-toggle">
              <ul className="nav nav-pills outline-active feed-toggle">
                <li className="nav-item">
                  <Link
                    href={tabPath}
                    className={`nav-link${tab === "authored" ? " active" : ""}`}
                  >
                    My Articles
                  </Link>
                </li>
                <li className="nav-item">
                  <Link
                    href={`${tabPath}?tab=favorited`}
                    className={`nav-link${tab === "favorited" ? " active" : ""}`}
                  >
                    Favorited Articles
                  </Link>
                </li>
              </ul>
            </div>
            <Suspense fallback={<ArticleListSkeleton />}>
              <AsyncProfileArticles
                articlesPromise={articlesPromise}
                currentPage={currentPage}
                pagePath={pagePath}
                authed={authed}
                slowMs={slowMs}
                tab={tab}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

const AsyncProfileArticles = async ({
  articlesPromise,
  currentPage,
  pagePath,
  authed,
  slowMs,
  tab,
}: {
  articlesPromise: Promise<ArticleListPayload>;
  currentPage: number;
  pagePath: string;
  authed: boolean;
  slowMs: number;
  tab: "authored" | "favorited";
}) => {
  if (slowMs > 0) {
    await new Promise((r) => setTimeout(r, slowMs));
  }
  const articles = await articlesPromise;
  return (
    <ArticleList
      articles={articles.articles}
      articlesCount={articles.articlesCount}
      limit={PAGE_SIZE}
      currentPage={currentPage}
      pagePath={pagePath}
      authed={authed}
      context={tab === "favorited" ? "profile-favorited" : "profile-authored"}
    />
  );
};

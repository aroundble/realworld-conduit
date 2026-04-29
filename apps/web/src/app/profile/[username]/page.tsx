import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleList } from "@/components/article/ArticleList";
import { ProfileBanner } from "@/components/profile/ProfileBanner";
import { listArticles } from "@/features/articles/queries";
import {
  isAuthenticated,
  readCurrentUsername,
} from "@/features/auth/session";
import { getProfile } from "@/features/profiles/queries";
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

  const [profile, authed, viewerUsername] = await Promise.all([
    getProfile(username),
    isAuthenticated(),
    readCurrentUsername(),
  ]);

  if (!profile) {
    notFound();
  }

  // Articles for the selected tab. `author=` for "My Articles",
  // `favorited=` for "Favorited Articles" — both reach the same
  // /api/articles endpoint per spec.
  const articles = await listArticles(
    tab === "favorited"
      ? { favorited: profile.username, limit: PAGE_SIZE, offset }
      : { author: profile.username, limit: PAGE_SIZE, offset },
  );

  const tabPath = `/profile/${encodeURIComponent(profile.username)}`;
  const pagePath =
    tab === "favorited" ? `${tabPath}?tab=favorited` : tabPath;

  return (
    <div className="profile-page">
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
            <ArticleList
              articles={articles.articles}
              articlesCount={articles.articlesCount}
              limit={PAGE_SIZE}
              currentPage={currentPage}
              pagePath={pagePath}
              authed={authed}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

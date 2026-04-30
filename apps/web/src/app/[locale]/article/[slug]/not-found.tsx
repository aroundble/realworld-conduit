import type { Metadata } from "next";
import Link from "next/link";

// Static fallback metadata for the 404 boundary. The page-level
// generateMetadata returns a non-article title when getArticle
// resolves null, but if Next reaches this not-found boundary
// directly the metadata below keeps the crawler from indexing a
// stale article preview (#113 AC scenario 4).
export const metadata: Metadata = {
  title: "Article not found — Conduit",
};

export default function NotFound() {
  return (
    <div className="container page article-not-found">
      <h1>Article not found</h1>
      <p>
        The article you were looking for does not exist or has been removed.
      </p>
      <Link href="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}

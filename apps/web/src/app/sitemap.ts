import type { MetadataRoute } from "next";
import { listArticles } from "@/features/articles/queries";
import { siteUrl } from "@/lib/site";

// Dynamic sitemap (#135). Next.js 16 resolves this export at request
// time and returns XML with the right content-type. We page through
// `listArticles` to avoid loading everything at once — each article's
// `updatedAt` becomes the `<lastmod>`, and the author username is
// harvested as a side effect so we emit a profile entry per unique
// writer without a separate DB round-trip.
//
// Sitemap protocol caps one file at 50,000 URLs. We ship a single
// file for now — at walking-skeleton scale (articles < 1,000) that's
// far below the ceiling. When the corpus grows past ~10k entries,
// split into a sitemap index (`app/sitemap.ts` returns the index,
// `app/sitemap-articles-N/route.ts` per shard). Track that in a
// follow-up when monitoring surfaces a count > 10,000.

// Force dynamic rendering so the sitemap reflects fresh articles
// without a rebuild. Next.js's default for metadata routes is
// `force-static`; for a crawler-facing endpoint that defeats the
// point — a stale sitemap is only slightly better than no sitemap.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
// Protect against a pathological DB — if something goes sideways
// and a caller sends us into an infinite loop, cap at 500 pages
// (50k URLs, the sitemap-protocol ceiling). Past that the corpus
// warrants a sharded sitemap index anyway.
const MAX_PAGES = 500;

const truncateToIsoDate = (iso: string): string => {
  // Some crawlers are pedantic about lastmod being ISO 8601 with
  // seconds precision — our API already emits that shape, so pass
  // through untouched. If a value came in malformed, fall back to
  // the string unchanged rather than throwing mid-sitemap.
  return iso;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const entries: MetadataRoute.Sitemap = [];

  // Homepage — highest priority, lastmod is "now" since the feed is
  // perpetually fresh.
  entries.push({
    url: `${origin}/`,
    lastModified: new Date(),
    priority: 1.0,
    changeFrequency: "hourly",
  });

  // Walk articles page by page. Each article contributes one URL +
  // (uniquely) one profile URL for its author.
  const seenAuthors = new Map<string, string>();
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let payload;
    try {
      payload = await listArticles({ limit: PAGE_SIZE, offset });
    } catch {
      // If the API is unreachable at build/request time, emit what
      // we have rather than 500ing the crawler. An empty sitemap is
      // still valid and won't drop the site from the index.
      break;
    }
    for (const article of payload.articles) {
      entries.push({
        url: `${origin}/article/${article.slug}`,
        lastModified: new Date(truncateToIsoDate(article.updatedAt)),
        priority: 0.8,
        changeFrequency: "weekly",
      });
      const author = article.author.username;
      if (!seenAuthors.has(author)) {
        // Profile lastmod best-effort: newest article's updatedAt —
        // close enough without a dedicated "profile updated" timestamp
        // on the API (RealWorld spec doesn't expose one).
        seenAuthors.set(author, article.updatedAt);
      }
    }
    if (payload.articles.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset >= payload.articlesCount) break;
  }

  for (const [username, lastmod] of seenAuthors) {
    entries.push({
      url: `${origin}/profile/${username}`,
      lastModified: new Date(lastmod),
      priority: 0.5,
      changeFrequency: "weekly",
    });
  }

  return entries;
}

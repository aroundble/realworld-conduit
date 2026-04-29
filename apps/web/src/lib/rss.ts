import type { ArticleListItem } from "@/features/articles/queries";
import { siteUrl } from "./site";

// Atom 1.0 feed builder (#150). Handwritten — the surface is tiny
// (root <feed> + N <entry>s), the escape rules are straightforward,
// and pulling in `feed` or `xmlbuilder2` would add ~30KB for no
// functionality our users' readers need.
//
// Escape strategy: pass every author-supplied string (title,
// description, username) through `escapeXml` before embedding.
// Character references for `&`, `<`, `>`, `"`, `'` are the full
// set Atom requires; no other transformation is needed because
// Atom entries use plain text (no HTML), not embedded markup.

type FeedMeta = {
  // Feed-level title: "Conduit — Latest articles", "... tagged #react", etc.
  title: string;
  // Canonical URL the feed surfaces — homepage for the global
  // feed, profile URL for author feeds, filtered homepage for
  // tag feeds.
  webUrl: string;
  // Self URL — the feed URL itself. Helps aggregators cache and
  // detect redirects.
  feedUrl: string;
};

const escapeXml = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Stable URN for each entry. Using `tag:<host>,<date>:article/<slug>`
// is the canonical pattern for content feeds (RFC 4151). Readers
// dedupe on `<id>`, so using the slug keeps dedup working even
// when we regenerate the feed.
const entryId = (origin: string, slug: string): string => {
  const host = origin.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  // Use the article's publish year for the date component; we
  // don't have that pre-parsed here, but "first-write" stability
  // isn't needed — the slug alone is unique. Hardcode 2026 as
  // the registration year for this tag URI scheme.
  return `tag:${host},2026:article/${slug}`;
};

export const buildAtomFeed = (
  articles: ArticleListItem[],
  meta: FeedMeta,
): string => {
  const origin = siteUrl();
  const updated =
    articles.length > 0
      ? articles[0]!.updatedAt
      : new Date().toISOString();

  const entries = articles
    .map((article) => {
      const url = `${origin}/article/${article.slug}`;
      return [
        "  <entry>",
        `    <title>${escapeXml(article.title)}</title>`,
        `    <link href="${escapeXml(url)}" rel="alternate" />`,
        `    <id>${entryId(origin, article.slug)}</id>`,
        `    <updated>${article.updatedAt}</updated>`,
        `    <published>${article.createdAt}</published>`,
        `    <summary>${escapeXml(article.description)}</summary>`,
        "    <author>",
        `      <name>${escapeXml(article.author.username)}</name>`,
        `      <uri>${escapeXml(`${origin}/profile/${article.author.username}`)}</uri>`,
        "    </author>",
        ...article.tagList.map(
          (t) => `    <category term="${escapeXml(t)}" />`,
        ),
        "  </entry>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(meta.title)}</title>`,
    `  <link href="${escapeXml(meta.webUrl)}" rel="alternate" />`,
    `  <link href="${escapeXml(meta.feedUrl)}" rel="self" />`,
    `  <id>${meta.webUrl}</id>`,
    `  <updated>${updated}</updated>`,
    entries,
    "</feed>",
    "",
  ].join("\n");
};

// Standard Cache-Control for every feed endpoint. Readers poll
// every 30-60 minutes; max-age=5min + swr=1h keeps the DB load
// low and readers fresh.
export const FEED_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600";

// Atom MIME type.
export const FEED_CONTENT_TYPE = "application/atom+xml; charset=utf-8";

// Feed item cap per the AC — 20 newest per feed.
export const FEED_LIMIT = 20;

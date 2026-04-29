import { listArticles } from "@/features/articles/queries";
import {
  buildAtomFeed,
  FEED_CACHE_CONTROL,
  FEED_CONTENT_TYPE,
  FEED_LIMIT,
} from "@/lib/rss";
import { siteUrl } from "@/lib/site";

// Global feed (#150). Newest 20 articles across the whole site.
// Used by feed readers as the default "follow the whole
// publication" subscription.

export const dynamic = "force-dynamic";

export async function GET() {
  const origin = siteUrl();
  const payload = await listArticles({ limit: FEED_LIMIT });
  const xml = buildAtomFeed(payload.articles, {
    title: "Conduit — Latest articles",
    webUrl: `${origin}/`,
    feedUrl: `${origin}/rss.xml`,
  });
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": FEED_CONTENT_TYPE,
      "Cache-Control": FEED_CACHE_CONTROL,
    },
  });
}

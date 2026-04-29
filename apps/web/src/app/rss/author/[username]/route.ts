import { listArticles } from "@/features/articles/queries";
import {
  buildAtomFeed,
  FEED_CACHE_CONTROL,
  FEED_CONTENT_TYPE,
  FEED_LIMIT,
} from "@/lib/rss";
import { siteUrl } from "@/lib/site";

// Per-author feed (#150). Newest 20 articles by `<username>`.

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const origin = siteUrl();
  const payload = await listArticles({ author: username, limit: FEED_LIMIT });
  const xml = buildAtomFeed(payload.articles, {
    title: `Conduit — Articles by ${username}`,
    webUrl: `${origin}/profile/${encodeURIComponent(username)}`,
    feedUrl: `${origin}/rss/author/${encodeURIComponent(username)}`,
  });
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": FEED_CONTENT_TYPE,
      "Cache-Control": FEED_CACHE_CONTROL,
    },
  });
}

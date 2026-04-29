import { listArticles } from "@/features/articles/queries";
import {
  buildAtomFeed,
  FEED_CACHE_CONTROL,
  FEED_CONTENT_TYPE,
  FEED_LIMIT,
} from "@/lib/rss";
import { siteUrl } from "@/lib/site";

// Per-tag feed (#150). Newest 20 articles tagged `<tag>`.

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tag: string }> },
) {
  const { tag } = await params;
  const origin = siteUrl();
  const payload = await listArticles({ tag, limit: FEED_LIMIT });
  const xml = buildAtomFeed(payload.articles, {
    title: `Conduit — Articles tagged #${tag}`,
    webUrl: `${origin}/?tag=${encodeURIComponent(tag)}`,
    feedUrl: `${origin}/rss/tag/${encodeURIComponent(tag)}`,
  });
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": FEED_CONTENT_TYPE,
      "Cache-Control": FEED_CACHE_CONTROL,
    },
  });
}

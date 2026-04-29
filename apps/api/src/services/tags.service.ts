import { prisma } from "../prisma/client.js";

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/tags.service.ts`, attribution).
// Upstream returns every tag; we cap at 20 since the issue scope pins
// this as "top-20 by usage" for the homepage sidebar (matches the
// reference frontend's expectation).

// Cap is a code constant rather than an env var: the "popular tags"
// sidebar has a fixed visual slot count, and 20 is the canonical number
// across every RealWorld reference frontend. Anything dynamic would be
// a different feature (paginated tag listing), not this one.
const TOP_TAGS_CAP = 20;

export const listTopTags = async (): Promise<string[]> => {
  // Order by the count of articles using the tag, desc. Ties break on
  // tag name (ascending) so the output is deterministic across runs —
  // the AC's literal `["dragons", "training", "programming"]` example
  // uses distinct counts, but two tags at count=1 would otherwise flip
  // between test runs without a secondary sort key.
  const rows = await prisma.tag.findMany({
    select: {
      name: true,
      _count: { select: { articles: true } },
    },
    orderBy: [
      { articles: { _count: "desc" } },
      { name: "asc" },
    ],
    take: TOP_TAGS_CAP,
  });
  // Drop tags that exist in the table but aren't on any article — those
  // are possible if an article was deleted without cascading the tag
  // (we don't cascade; orphans are fine). The AC's "empty list when no
  // articles have tags" scenario requires orphans to be excluded.
  return rows.filter((r) => r._count.articles > 0).map((r) => r.name);
};

import type { Article } from "@/features/articles/queries";
import { siteUrl } from "./site";

// Builders for schema.org JSON-LD payloads (#148). Returns plain
// serializable objects; the <JsonLd> component handles the
// `<script>` wrapping + the `</` escape that prevents a literal
// `</script>` inside a title from closing the script tag early.
//
// Hand-typed rather than pulling in `schema-dts` — the subset we
// emit is tiny (Article, Person, WebSite + SearchAction) and the
// dependency would be 5x the size of the payload it types.

// Minimum shape of our JSON-LD payloads. Schema.org permits many
// more properties; we emit only the ones crawlers weight highly.
type JsonLdObject = Record<string, unknown>;

const ORG_NAME = "Conduit";

// Trim the origin once per build; siteUrl already handles this,
// but we surface it here so callers can concatenate without
// thinking about trailing slashes.
const origin = (): string => siteUrl();

// Omit null / empty values from the final payload so crawlers
// don't see `"description": null` — that fails some validators
// and adds noise in Search Console's rich-result report.
const compact = <T extends JsonLdObject>(obj: T): T => {
  const out: JsonLdObject = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out as T;
};

export const buildArticleJsonLd = (article: Article): JsonLdObject => {
  const authorUrl = `${origin()}/profile/${article.author.username}`;
  const author = compact({
    "@type": "Person",
    name: article.author.username,
    url: authorUrl,
    image: article.author.image,
  });
  return compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.createdAt,
    dateModified: article.updatedAt,
    mainEntityOfPage: `${origin()}/article/${article.slug}`,
    author,
    publisher: {
      "@type": "Organization",
      name: ORG_NAME,
      url: origin(),
    },
    image: article.author.image ?? undefined,
  });
};

export type PersonJsonLdInput = {
  username: string;
  bio: string | null;
  image: string | null;
};

export const buildPersonJsonLd = (user: PersonJsonLdInput): JsonLdObject =>
  compact({
    "@context": "https://schema.org",
    "@type": "Person",
    name: user.username,
    description: user.bio,
    image: user.image,
    url: `${origin()}/profile/${user.username}`,
  });

export const buildWebSiteJsonLd = (): JsonLdObject => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: ORG_NAME,
  url: origin(),
  // SearchAction points at the homepage's `?q=` query — the
  // same search parameter the SearchBar from #117 reads. Google
  // uses this to render an in-SERP search box for the site.
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${origin()}/?q={search_term_string}`,
    },
    // `query-input` naming is a schema.org quirk — it's a string,
    // not an object, and search engines expect exactly this form.
    "query-input": "required name=search_term_string",
  },
});

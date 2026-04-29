// Canonical site origin — used by generateMetadata (#113) for the
// og:url tag. Reads NEXT_PUBLIC_SITE_URL at runtime; defaults to
// localhost so dev works out of the box.
//
// Trailing slashes are stripped so callers can consistently
// `${siteUrl()}/article/${slug}` without risking a double-slash
// between origin + path.
export const siteUrl = (): string => {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
};

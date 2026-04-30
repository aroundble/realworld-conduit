import { getTranslations } from "next-intl/server";
import Link from "next/link";

// Root not-found page (#167a). Next renders this when `notFound()`
// is called from a route without a pair-scoped not-found.tsx, or
// when a URL doesn't match any route. Translated via `notFound.*`
// so every locale carries its own copy.

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="not-found-page" data-testid="app-not-found">
      <div className="container page">
        <h1>{t("title")}</h1>
        <p>{t("message")}</p>
        <Link href="/" className="btn btn-primary">
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}

import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// next-intl per-request config (#167a). Called by the provider on
// every server render to resolve which locale applies + which
// message bundle to hand to child components. The bundle lookup is
// intentionally static (`await import("../../messages/...json")`)
// so the build step tree-shakes missing bundles at compile time
// rather than a silent runtime fallback.

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages = (
    await import(`../../messages/${locale}/common.json`)
  ).default;

  return {
    locale,
    messages,
  };
});

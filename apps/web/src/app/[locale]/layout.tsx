import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

// Per-locale layout (#167a). Walking-skeleton scope: this layout
// validates the locale segment + sets it on the per-request store
// so server components deeper in the tree can call
// `getTranslations()` without passing the locale explicitly.
//
// generateStaticParams returns the five locales so Next can
// pre-render locale shells at build time where possible (#167a
// doesn't force static-only rendering; dynamic routes still work).

export const generateStaticParams = () =>
  routing.locales.map((locale) => ({ locale }));

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  return children;
}

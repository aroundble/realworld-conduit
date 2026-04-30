"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

// Locale switcher (#167a). Sits in the Navbar next to ThemeToggle.
// A native <select> is used on purpose — zero-JS-in-paint, works
// with keyboard + screen readers for free, and survives in
// headless-browser + a11y audit paths without needing a custom
// combobox pattern.
//
// On change: call router.replace(pathname, {locale}) which
// next-intl resolves to the same path under the new locale prefix
// (or un-prefixed for `en`). The cookie `conduit-locale` updates
// automatically.

const LABELS: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
  ja: "日本語",
  es: "Español",
  de: "Deutsch",
};

export const LocaleSwitcher = () => {
  const locale = useLocale();
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="locale-switcher" aria-label={t("languageMenuLabel")}>
      <span className="sr-only">{t("language")}</span>
      <select
        className="locale-switcher-select"
        data-testid="locale-switcher"
        value={locale}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value as Locale;
          // router.replace alone doesn't re-evaluate the active
          // locale in hydrated client components because next-intl
          // reads the locale once per server render; a full-page
          // navigation is what propagates the message bundle +
          // <html lang> attribute to the switched locale. Using
          // window.location.href here (vs. router.push) forces a
          // document-level navigation so every server + client
          // component re-renders against the new bundle.
          //
          // Write the cookie before navigating so the server render
          // that lands on the new URL sees the updated preference
          // (the middleware would otherwise attempt another
          // Accept-Language redirect).
          document.cookie = `conduit-locale=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
          const prefix = next === "en" ? "" : `/${next}`;
          startTransition(() => {
            window.location.href = `${prefix}${pathname}`;
          });
        }}
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
};

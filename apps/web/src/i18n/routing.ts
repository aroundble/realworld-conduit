import { defineRouting } from "next-intl/routing";

// i18n routing config (#167a). Walking-skeleton scope:
//   - 5 locales: en (default, no URL prefix) + ko/ja/es/de (prefixed).
//   - localePrefix "as-needed" means the default locale keeps the
//     canonical un-prefixed URL (`/article/<slug>`) while the other
//     four carry `/ko/article/<slug>` etc. Matches the AC + every
//     production i18n site (Stripe, Linear, Notion).
//   - localeDetection enabled so Accept-Language + the
//     `conduit-locale` cookie drive the first-visit redirect.

export const routing = defineRouting({
  locales: ["en", "ko", "ja", "es", "de"] as const,
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: true,
  localeCookie: { name: "conduit-locale" },
});

export type Locale = (typeof routing.locales)[number];

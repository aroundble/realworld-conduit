// Skip-to-main-content link (#161). First focusable element on
// every page. Visually hidden until it receives keyboard focus,
// then paints at the top-left with the primary-button palette.
// Server component — no interaction state, pure static anchor.
//
// Anchor target is `#main-content` on the <main> element in
// layout.tsx; <main> carries `tabindex="-1"` so it's
// programmatically focusable when the skip link activates.
//
// The hide-but-keep-tabbable CSS trick uses `clip-path` + the
// `sr-only` pattern. `display: none` would remove it from the
// tab order entirely, which defeats the purpose.

import { getTranslations } from "next-intl/server";

export const SkipLink = async () => {
  const t = await getTranslations("skip");
  return (
    <a href="#main-content" className="skip-link" data-testid="skip-link">
      {t("toContent")}
    </a>
  );
};

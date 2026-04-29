// Relative-time formatter (#158). Returns locale-aware short
// labels like "3h ago" / "yesterday" / "2 weeks ago" — what
// every modern feed surface displays instead of formal dates.
// Formal dates are still available via the `formatFormalDate`
// helper for the <time title> hover reveal.
//
// Uses browser-native `Intl.RelativeTimeFormat` so every locale
// the user's browser reports is supported out of the box; no
// library needed. When the delta exceeds ~1 year the formatter
// falls back to a short formal date (e.g. "Jan 2025") because
// "23 months ago" is less useful than the year.

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH = 30 * MS_PER_DAY; // calendar-month approximation
const MS_PER_YEAR = 365 * MS_PER_DAY;

export const formatRelativeTime = (
  iso: string,
  now: Date = new Date(),
  locale: string | undefined = undefined,
): string => {
  const parsed = new Date(iso);
  const parsedTime = parsed.getTime();
  if (!Number.isFinite(parsedTime)) return iso;

  const deltaMs = now.getTime() - parsedTime;
  // Treat near-zero + mild future drift (clock skew) as "just now"
  // rather than "in 0s"; "in 3m" for a 3-minute future delta is
  // confusing and usually a clock-skew artifact.
  if (deltaMs < MS_PER_MIN) return "just now";

  // Past-direction formatter. Intl returns e.g. "3 minutes ago",
  // "yesterday", "2 weeks ago" in the user's locale.
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (deltaMs < MS_PER_HOUR) {
    const mins = Math.floor(deltaMs / MS_PER_MIN);
    return rtf.format(-mins, "minute");
  }
  if (deltaMs < MS_PER_DAY) {
    const hours = Math.floor(deltaMs / MS_PER_HOUR);
    return rtf.format(-hours, "hour");
  }
  if (deltaMs < 2 * MS_PER_DAY) {
    return rtf.format(-1, "day");
  }
  if (deltaMs < MS_PER_WEEK) {
    const days = Math.floor(deltaMs / MS_PER_DAY);
    return rtf.format(-days, "day");
  }
  if (deltaMs < 4 * MS_PER_WEEK) {
    const weeks = Math.floor(deltaMs / MS_PER_WEEK);
    return rtf.format(-weeks, "week");
  }
  if (deltaMs < MS_PER_YEAR) {
    const months = Math.floor(deltaMs / MS_PER_MONTH);
    return rtf.format(-months, "month");
  }
  // Over one year — short formal date beats "14 months ago".
  return formatShortYearMonth(parsed, locale);
};

// Short formal date for long-past entries. "Jan 2025" rather
// than "January 2025" to keep card meta strips compact.
const formatShortYearMonth = (d: Date, locale: string | undefined): string =>
  d.toLocaleDateString(locale, { month: "short", year: "numeric" });

// Formal date for <time title> hover. Full locale-aware form.
export const formatFormalDate = (
  iso: string,
  locale: string | undefined = undefined,
): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

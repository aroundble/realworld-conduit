"use client";

import { useSyncExternalStore } from "react";
import {
  formatFormalDate,
  formatRelativeTime,
} from "@/lib/relativeTime";

// Renders a <time> element whose visible text is the relative
// age ("3h ago", "yesterday", "2 weeks ago") and whose `title`
// attribute carries the formal date for hover reveal. (#158)
//
// The label auto-refreshes every 60s via a single shared
// external store so all RelativeTime instances on the page
// re-render in lockstep (cheaper than a per-component interval).
//
// SSR/CSR shape: the server renders the formal date so the
// initial HTML looks stable to crawlers + first-paint users.
// `useSyncExternalStore` then flips `mounted` → true on the
// client and the visible label becomes the relative form after
// hydration. `suppressHydrationWarning` quiets React's
// mismatch log because the initial post-mount text is expected
// to differ from the SSR text.

// Shared 60s tick — all RelativeTime instances share one
// timer. Subscribing bumps the count; unsubscribing drops it.
let tickValue = 0;
const tickSubscribers = new Set<() => void>();
let tickerStarted = false;

const startTicker = () => {
  if (tickerStarted || typeof window === "undefined") return;
  tickerStarted = true;
  window.setInterval(() => {
    tickValue += 1;
    for (const fn of tickSubscribers) fn();
  }, 60_000);
};

const subscribeTick = (onStoreChange: () => void): (() => void) => {
  tickSubscribers.add(onStoreChange);
  startTicker();
  return () => {
    tickSubscribers.delete(onStoreChange);
  };
};
const getTickClient = (): number => tickValue;
const getTickServer = (): number => -1;

// Separate mount flag, same useSyncExternalStore pattern as
// next-themes / ThemeToggle — returns `true` on client and
// `false` on SSR + first-client render. React 19's "no setState
// in effect" rule forbids the older mount-via-useEffect trick.
const mountedSubscribe = (): (() => void) => () => {};
const mountedClient = (): boolean => true;
const mountedServer = (): boolean => false;

type Props = {
  iso: string;
  // Optional locale override; defaults to the browser's. Tests
  // use `locale="en-US"` for deterministic formatting.
  locale?: string;
  // Optional className for meta-strip styling consistency with
  // the old formal-date span.
  className?: string;
};

export const RelativeTime = ({ iso, locale, className }: Props) => {
  const mounted = useSyncExternalStore(
    mountedSubscribe,
    mountedClient,
    mountedServer,
  );
  // Subscribing to the tick is what makes the label refresh; we
  // don't read the value, just the side-effect of re-rendering.
  useSyncExternalStore(subscribeTick, getTickClient, getTickServer);

  const visible = mounted
    ? formatRelativeTime(iso, new Date(), locale)
    : formatFormalDate(iso, locale);
  const hoverTitle = formatFormalDate(iso, locale);
  return (
    <time
      dateTime={iso}
      title={hoverTitle}
      className={className}
      suppressHydrationWarning
      data-testid="relative-time"
    >
      {visible}
    </time>
  );
};

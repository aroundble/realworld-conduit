"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

// Prefetch-on-hover for article preview cards (#138). Next.js's
// `<Link prefetch>` prop handles viewport-based prefetch already;
// this hook adds the hover signal so a user showing intent to
// click gets a warm RSC cache before the click fires — click-to-
// paint feels sub-100ms rather than waiting a full round-trip.
//
// Three discipline points:
//   1. `navigator.connection.saveData` === true → no-op. Don't burn
//      a mobile user's data budget on speculative fetches.
//   2. `prefers-reduced-data` media query → no-op. Same reason,
//      the standard CSS equivalent.
//   3. Dedupe per-href within a session via a ref-set so bouncing
//      a mouse over the same card doesn't retrigger the fetch.
//      Next's own router.prefetch dedupes too but this saves the
//      call entirely.

type ConnectionWithSaveData = {
  saveData?: boolean;
};

const shouldSkipPrefetch = (): boolean => {
  if (typeof window === "undefined") return true;
  // Save-Data header surfaces through navigator.connection; not all
  // browsers expose the API, so an `undefined` is a "no signal,
  // proceed" default rather than a hard-no.
  const nav = window.navigator as Navigator & {
    connection?: ConnectionWithSaveData;
  };
  if (nav.connection?.saveData === true) return true;
  try {
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-data: reduce)").matches
    ) {
      return true;
    }
  } catch {
    /* older engines without matchMedia — ignore */
  }
  return false;
};

export const usePrefetchOnHover = (href: string) => {
  const router = useRouter();
  const prefetchedRef = useRef<Set<string>>(new Set());

  return useCallback(() => {
    if (prefetchedRef.current.has(href)) return;
    if (shouldSkipPrefetch()) return;
    prefetchedRef.current.add(href);
    try {
      router.prefetch(href);
    } catch {
      // Router.prefetch can throw on older Next.js versions or
      // during SSR-ish contexts; hover is best-effort so we
      // swallow and let the click fall back to the normal
      // fetch path.
    }
  }, [href, router]);
};

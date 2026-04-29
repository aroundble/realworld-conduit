"use client";

import { useEffect } from "react";

// Register the no-op service worker on page load (#149). Scoped
// client-only so SSR stays untouched; deferred behind the `load`
// event so it never competes with first-paint / hydration work.
//
// `navigator.serviceWorker` is not defined in private browsing on
// some browsers and during SSR — every access is optional-chained.
// A registration failure is non-fatal; the PWA install affordance
// just won't appear. Logged to the console at warn level so a
// developer opening DevTools notices without it surfacing as a
// page-level error.

export const ServiceWorkerRegistration = () => {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] registration failed:", err);
      });
    };

    // If the page is already loaded by the time this effect runs
    // (likely, since it's client-side), register immediately.
    // Otherwise wait for `load` so we don't compete with
    // hydration / LCP.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
    return;
  }, []);

  return null;
};

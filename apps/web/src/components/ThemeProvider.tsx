"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// Thin client-component wrapper around `next-themes`. next-themes
// needs to render on the client to read localStorage and match
// prefers-color-scheme; it injects an inline <script> into <head>
// (via its `<ThemeProvider>`) that sets the `data-theme` attribute
// before first paint — the trick that defeats FOUC.
//
// We pin the config here rather than letting each caller tweak it,
// so the behaviour (attribute name, storage key, default) stays
// consistent across the app and the Playwright spec in #136.

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey="conduit-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
};

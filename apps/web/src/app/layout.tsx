import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Footer } from "@/components/Footer";
import { KeyboardShortcutHelp } from "@/components/KeyboardShortcutHelp";
import { KeyboardShortcutProvider } from "@/components/KeyboardShortcutProvider";
import { Navbar } from "@/components/Navbar";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SkipLink } from "@/components/SkipLink";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conduit",
  description: "A place to share your knowledge.",
  // Apple-specific touch icon (#149). Standard /icons/ path keeps
  // the PWA + legacy iOS home-screen affordances aligned.
  appleWebApp: {
    capable: true,
    title: "Conduit",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
  // Global RSS feed discovery (#150). Feed readers scan <head>
  // for <link rel="alternate"> with an Atom/RSS type and
  // auto-subscribe. Per-author + per-tag feeds override on their
  // own pages below.
  alternates: {
    types: {
      "application/atom+xml": "/rss.xml",
    },
  },
};

// theme-color (#149) with separate light + dark entries so the
// phone's status bar tints to match whichever palette the user
// sees. Dark value mirrors the palette in #136.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2c7a2c" },
    { media: "(prefers-color-scheme: dark)", color: "#151517" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` belongs on <html> when next-themes
    // is the one setting `data-theme` on first paint — the inline
    // script runs before React hydrates and edits the attribute,
    // which would otherwise log a warning. Scope is just this one
    // element; content inside still hydrates strictly.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {/* Keyboard shortcuts (#160). The provider owns the global
              keydown listener + sequence state machine; the Help
              modal mounts here (rendered conditionally by the
              provider context's helpOpen flag). Wraps everything
              below so any component can open/close the help dialog
              through useShortcutContext. */}
          <KeyboardShortcutProvider>
            {/* Skip-to-content link (#161). First focusable element on
                every page. Visually hidden until it receives keyboard
                focus; jumps past the navbar straight to <main>. */}
            <SkipLink />
            <Navbar />
          {/* Every page's content sits inside <main> so axe's
              landmark-one-main + region rules are satisfied globally
              (see tests/e2e/axe-config.ts + #87). `tabindex="-1"`
              lets the SkipLink's fragment navigation move focus here
              programmatically. */}
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <Footer />
          {/* Toast layer (#115). Sonner's <Toaster> mounts a
              role="status" live region so any client-component
              action-caller can surface transient failure feedback
              via `toast.error(...)`. Progressive enhancement: with
              JS off the toaster is inert (no rendered DOM), but
              inline error surfaces (conform-to error-messages lists
              on forms, data-errored attrs on buttons) still work. */}
          <Toaster position="top-center" closeButton />
          {/* PWA service worker registration (#149). Lazy on
              `load` so it never competes with first-paint. */}
          <ServiceWorkerRegistration />
          {/* Keyboard-shortcut help modal (#160). Renders null
              unless helpOpen=true in the provider. */}
          <KeyboardShortcutHelp />
          </KeyboardShortcutProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

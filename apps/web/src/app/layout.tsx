import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conduit",
  description: "A place to share your knowledge.",
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
          <Navbar />
          {/* Every page's content sits inside <main> so axe's
              landmark-one-main + region rules are satisfied globally
              (see tests/e2e/axe-config.ts + #87). */}
          <main>{children}</main>
          <Footer />
          {/* Toast layer (#115). Sonner's <Toaster> mounts a
              role="status" live region so any client-component
              action-caller can surface transient failure feedback
              via `toast.error(...)`. Progressive enhancement: with
              JS off the toaster is inert (no rendered DOM), but
              inline error surfaces (conform-to error-messages lists
              on forms, data-errored attrs on buttons) still work. */}
          <Toaster position="top-center" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}

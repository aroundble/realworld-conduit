import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conduit",
  description: "A place to share your knowledge.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
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
      </body>
    </html>
  );
}

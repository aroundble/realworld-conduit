import type { Metadata } from "next";
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
      </body>
    </html>
  );
}

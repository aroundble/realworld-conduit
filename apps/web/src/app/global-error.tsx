"use client";

import { ErrorState } from "@/components/ErrorState";
import "./globals.css";

// Global error boundary (#147). Fires when the root `layout.tsx`
// itself throws — e.g. a ThemeProvider init failure, a layout
// server-component throw. Because this replaces the entire HTML
// shell, we own <html> and <body> directly; no navbar / footer /
// ThemeProvider are available here.
//
// We deliberately do NOT call `reset()` via a router action here —
// if the root layout is broken, client-side routing may be too.
// The "Back to homepage" link does a hard navigation instead,
// giving the user a clean slate.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="container" style={{ padding: "3rem 1rem" }}>
          <ErrorState
            title="Something went wrong"
            description="Conduit hit an unexpected error and couldn't render. Retry, or reload the page."
            error={error}
            reset={reset}
            testId="error-global"
          />
        </main>
      </body>
    </html>
  );
}

"use client";

import { ErrorState } from "@/components/ErrorState";

// Root-segment error boundary (#147). Catches unhandled throws
// from the homepage — `listArticles`, `listTopTags`, etc. The
// root layout (navbar + footer) continues to render; Next swaps
// in this UI inside <main>.

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong loading the feed"
      description="We hit a snag pulling up the latest articles. It's not you — the issue is on our side. Give it another try, or head back to the homepage."
      error={error}
      reset={reset}
      testId="error-home"
    />
  );
}

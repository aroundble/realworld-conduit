"use client";

import { ErrorState } from "@/components/ErrorState";

// Profile-page segment error boundary (#147). Catches throws from
// `getProfile` / `listArticles(author)` etc. 404s (user not found)
// route through notFound() and the not-found boundary; this
// catches genuine throws only.

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong loading this profile"
      description="We couldn't pull up this profile's page. It's not you — the issue is on our side."
      error={error}
      reset={reset}
      testId="error-profile"
    />
  );
}

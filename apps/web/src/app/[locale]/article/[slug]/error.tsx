"use client";

import { ErrorState } from "@/components/ErrorState";

// Article-detail segment error boundary (#147). Fires when
// `getArticleBySlug` throws unexpectedly. Note: a missing slug
// calls notFound() (4xx, not 5xx) and routes through Next's
// not-found boundary — this error.tsx only catches genuine
// throws (DB outage, upstream API crash, render error).

export default function ArticleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong on this article"
      description="We hit a snag loading this article. It's not you — the issue is on our side."
      error={error}
      reset={reset}
      testId="error-article"
    />
  );
}

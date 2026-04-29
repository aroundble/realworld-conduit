"use client";

import Link from "next/link";

// Shared branded error state (#147). Mirrors EmptyState (#127) in
// shape + styling, differs in role: errors use `role="alert"` so
// screen readers announce the condition as "assertive" rather than
// polite. Every `error.tsx` segment wraps this component.
//
// Next.js 16 passes `{ error, reset }` to every error boundary; we
// forward `reset` as the retry button's onClick and log the error's
// `digest` to the browser console so support can cross-reference
// with the server-side pino log line that fired at the same
// request-id.

type Props = {
  title: string;
  description: string;
  // Next's retry primitive — the framework will re-render the
  // segment when called. Optional so `global-error.tsx` can use
  // the same component without a reset path.
  reset?: () => void;
  // Error instance from Next; we read its `digest` for the
  // correlation console line. Optional for the same reason.
  error?: Error & { digest?: string };
  // Home link defaults to "/" but `global-error.tsx` may want to
  // hard-refresh (no client-side router available there).
  homeHref?: string;
  // Test hook so specs scope to a specific boundary instance.
  testId?: string;
};

export const ErrorState = ({
  title,
  description,
  reset,
  error,
  homeHref = "/",
  testId,
}: Props) => {
  // One-shot effect — log the digest so a support request carrying
  // a screenshot can correlate with the server's pino line. No
  // network call; purely a console breadcrumb.
  if (typeof window !== "undefined" && error?.digest) {
    console.error(`[error-boundary] digest=${error.digest}`, error);
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid={testId ?? "error-state"}
      className="error-state"
    >
      <p className="error-state-title">{title}</p>
      <p className="error-state-body">{description}</p>
      {error?.digest ? (
        <p className="error-state-digest" data-testid="error-digest">
          Support reference: <code>{error.digest}</code>
        </p>
      ) : null}
      <div className="error-state-actions">
        {reset ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={reset}
            data-testid="error-retry"
          >
            Try again
          </button>
        ) : null}
        <Link href={homeHref} className="error-state-home-link">
          Back to homepage
        </Link>
      </div>
    </div>
  );
};

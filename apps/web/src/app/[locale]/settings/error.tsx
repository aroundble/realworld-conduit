"use client";

import { ErrorState } from "@/components/ErrorState";

// Settings segment error boundary (#147).

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong loading settings"
      description="We couldn't open your settings. It's not you — the issue is on our side."
      error={error}
      reset={reset}
      testId="error-settings"
    />
  );
}

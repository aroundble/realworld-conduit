"use client";

import { ErrorState } from "@/components/ErrorState";

// Editor segment error boundary (#147). Covers /editor (new) and
// /editor/[slug] (edit) — both sit under this segment. Draft
// autosave (#137) lives in localStorage; an error here does NOT
// touch saved draft state, so retrying is safe.

export default function EditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong in the editor"
      description="We couldn't open the editor. Your draft is still saved locally — retry or head home and try again."
      error={error}
      reset={reset}
      testId="error-editor"
    />
  );
}

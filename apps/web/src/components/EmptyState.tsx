import type { ReactNode } from "react";

// Shared empty-state card (#127). Used by the homepage article list,
// the profile page's favorited/authored tabs, and the article-detail
// comment thread. Keeping the shape unified prevents copy drift —
// every empty state has the same title / body / actions rhythm and
// the same a11y treatment.
//
// `role="status"` is deliberate: empty-states are "the app has a
// non-error condition to announce" which is exactly what
// `role="status"` expresses (polite live-region), and screen readers
// will announce the title/body once. We do NOT use `role="alert"` —
// an empty feed isn't an error.

type Props = {
  title: string;
  body: string;
  // Optional action links / buttons rendered beneath the body.
  // Callers pass `<Link>` components so routing is owned by Next.js.
  actions?: ReactNode;
  // Test hook — lets specs scope to a specific empty-state instance
  // without relying on fragile text matchers.
  testId?: string;
  // Optional extra class — some call sites sit inside a Bootstrap-like
  // `.article-preview` wrapper for consistent spacing.
  className?: string;
};

export const EmptyState = ({
  title,
  body,
  actions,
  testId,
  className,
}: Props) => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={`empty-state${className ? ` ${className}` : ""}`}
    >
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-body">{body}</p>
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </div>
  );
};

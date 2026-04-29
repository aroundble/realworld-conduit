"use client";

import { useOptimistic, useTransition } from "react";
import { followAuthor, unfollowAuthor } from "@/features/articles/actions";

// Client toggle for follow/unfollow. useOptimistic lets the label +
// active class flip immediately on click, the server action runs in
// a transition, and the RSC page revalidates so the persisted state
// lands on the next render — matching AC scenario 2's "button
// switches … without full reload / refresh shows persisted".

type Props = {
  username: string;
  following: boolean;
  // Anonymous viewers see a disabled-looking button that links to
  // login (matches AC scenario 1 — we render it here rather than
  // hiding entirely so the page structure is identical authed vs
  // anonymous; the action just gates behind authed flag).
  disabled?: boolean;
};

export const FollowButton = ({ username, following, disabled }: Props) => {
  const [optimisticFollowing, setOptimisticFollowing] = useOptimistic(
    following,
    (_, next: boolean) => next,
  );
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    if (disabled) return;
    const next = !optimisticFollowing;
    startTransition(async () => {
      setOptimisticFollowing(next);
      if (next) {
        await followAuthor(username);
      } else {
        await unfollowAuthor(username);
      }
    });
  };

  const label = optimisticFollowing
    ? `Unfollow ${username}`
    : `Follow ${username}`;
  const icon = optimisticFollowing ? "−" : "+";

  return (
    <button
      type="button"
      aria-pressed={optimisticFollowing}
      aria-busy={isPending}
      disabled={disabled || isPending}
      onClick={onClick}
      className={`btn btn-sm ${
        optimisticFollowing ? "btn-secondary" : "btn-outline-secondary"
      }`}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
};

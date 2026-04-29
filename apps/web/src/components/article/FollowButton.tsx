"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { followAuthor, unfollowAuthor } from "@/features/articles/actions";

// Client toggle for follow/unfollow. useOptimistic lets the label +
// active class flip immediately on click, the server action runs in
// a transition, and `router.refresh()` re-fetches the page's RSC
// props *after* the action resolves — matching AC scenario 2's
// "button switches … without full reload / refresh shows persisted".
// Driving the refetch from the client (rather than from the action
// via revalidatePath) keeps the ordering strict: DB write → refresh.
// See #76 for the race this closes.

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
  const router = useRouter();

  const onClick = () => {
    if (disabled) return;
    const next = !optimisticFollowing;
    startTransition(async () => {
      setOptimisticFollowing(next);
      try {
        if (next) {
          await followAuthor(username);
        } else {
          await unfollowAuthor(username);
        }
        router.refresh();
      } catch {
        // Server 5xx / network error: useOptimistic reverts the label
        // automatically; surface a toast so the user sees why the
        // button snapped back (#115).
        toast.error(
          next
            ? `Couldn't follow @${username} — please try again`
            : `Couldn't unfollow @${username} — please try again`,
        );
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

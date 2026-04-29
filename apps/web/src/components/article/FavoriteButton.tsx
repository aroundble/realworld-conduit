"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  favoriteArticle,
  unfavoriteArticle,
} from "@/features/articles/actions";

type Props = {
  slug: string;
  favorited: boolean;
  favoritesCount: number;
  // Anonymous viewers click-to-login instead of firing the POST. When
  // `authed` is false the click routes to `/login?next=/article/<slug>`;
  // no network request is issued (AC scenario 4 on #56).
  authed: boolean;
  // variant=detail is the big banner/footer button; variant=compact
  // is the preview card's right-aligned pill. Both flip the same
  // state; they differ only in label + classes.
  variant?: "detail" | "compact";
};

export const FavoriteButton = ({
  slug,
  favorited,
  favoritesCount,
  authed,
  variant = "detail",
}: Props) => {
  const [optimistic, setOptimistic] = useOptimistic(
    { favorited, favoritesCount },
    (
      prev: { favorited: boolean; favoritesCount: number },
      next: { favorited: boolean },
    ) => ({
      favorited: next.favorited,
      favoritesCount:
        prev.favoritesCount + (next.favorited === prev.favorited ? 0 : next.favorited ? 1 : -1),
    }),
  );
  const [isPending, startTransition] = useTransition();
  const [errored, setErrored] = useState(false);
  const router = useRouter();

  const onClick = () => {
    if (!authed) {
      // Anon path: send to login with a return target, skip the POST
      // entirely so the test can assert no network request fired.
      const next = `/article/${encodeURIComponent(slug)}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const next = !optimistic.favorited;
    startTransition(async () => {
      setOptimistic({ favorited: next });
      setErrored(false);
      try {
        if (next) {
          await favoriteArticle(slug);
        } else {
          await unfavoriteArticle(slug);
        }
        // Drive the refetch from the client so it runs strictly after
        // the action's DB write has returned — avoids the optimistic /
        // revalidate race in #76 where Follow's revalidation could
        // arrive mid-Favorite-transition and flash stale state.
        router.refresh();
      } catch {
        // Server 5xx / network error: React's useOptimistic will drop
        // the pending optimistic value on throw and restore the last
        // committed props — so the UI reverts automatically. Flag the
        // error so the AC scenario-3 assertion can observe the revert +
        // error indication.
        setErrored(true);
      }
    });
  };

  const label =
    variant === "compact"
      ? optimistic.favoritesCount
      : `${optimistic.favorited ? "Unfavorite" : "Favorite"} Article (${optimistic.favoritesCount})`;

  return (
    <button
      type="button"
      aria-pressed={optimistic.favorited}
      aria-busy={isPending}
      data-errored={errored || undefined}
      data-testid="favorite-button"
      disabled={isPending}
      onClick={onClick}
      className={`btn btn-sm ${
        optimistic.favorited ? "btn-primary" : "btn-outline-primary"
      } ${variant === "compact" ? "pull-xs-right" : ""}${errored ? " favorite-button--errored" : ""}`}
    >
      <span aria-hidden="true">♥</span> {label}
    </button>
  );
};

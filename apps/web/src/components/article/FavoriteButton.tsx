"use client";

import { useOptimistic, useTransition } from "react";
import {
  favoriteArticle,
  unfavoriteArticle,
} from "@/features/articles/actions";

type Props = {
  slug: string;
  favorited: boolean;
  favoritesCount: number;
  disabled?: boolean;
  // variant=detail is the big banner/footer button; variant=compact
  // is the preview card's right-aligned pill. Both flip the same
  // state; they differ only in label + classes.
  variant?: "detail" | "compact";
};

export const FavoriteButton = ({
  slug,
  favorited,
  favoritesCount,
  disabled,
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

  const onClick = () => {
    if (disabled) return;
    const next = !optimistic.favorited;
    startTransition(async () => {
      setOptimistic({ favorited: next });
      if (next) {
        await favoriteArticle(slug);
      } else {
        await unfavoriteArticle(slug);
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
      disabled={disabled || isPending}
      onClick={onClick}
      className={`btn btn-sm ${
        optimistic.favorited ? "btn-primary" : "btn-outline-primary"
      } ${variant === "compact" ? "pull-xs-right" : ""}`}
    >
      <span aria-hidden="true">♥</span> {label}
    </button>
  );
};

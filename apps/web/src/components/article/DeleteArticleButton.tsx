"use client";

import { useTransition } from "react";
import { deleteArticle } from "@/features/articles/actions";

type Props = { slug: string };

// Confirm-before-delete is the browser-native confirm(). Spec
// scenario 4 expects the delete to fire after the user confirms and
// then redirect to `/` — the server action handles the redirect.
// No additional client UI here; keeping the surface small.
export const DeleteArticleButton = ({ slug }: Props) => {
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    if (!window.confirm("Delete this article?")) return;
    startTransition(async () => {
      await deleteArticle(slug);
    });
  };

  return (
    <button
      type="button"
      aria-busy={isPending}
      disabled={isPending}
      onClick={onClick}
      className="btn btn-sm btn-outline-danger"
    >
      <span aria-hidden="true">🗑</span> Delete Article
    </button>
  );
};

"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteArticle } from "@/features/articles/actions";

type Props = { slug: string };

// Confirm-before-delete is the browser-native confirm(). Spec
// scenario 4 expects the delete to fire after the user confirms and
// then redirect to `/` — the server action handles the redirect.
// No additional client UI here; keeping the surface small.
//
// The server action calls `redirect("/")` on success, which throws a
// special NEXT_REDIRECT error that Next's runtime consumes. We rethrow
// it so Next's redirect flow continues; anything else is a real
// failure and gets surfaced as a toast (#115).
const isNextRedirectError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
};

export const DeleteArticleButton = ({ slug }: Props) => {
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    if (!window.confirm("Delete this article?")) return;
    startTransition(async () => {
      try {
        await deleteArticle(slug);
      } catch (err) {
        if (isNextRedirectError(err)) throw err;
        toast.error("Couldn't delete — please try again");
      }
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

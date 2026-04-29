"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteComment } from "@/features/comments/actions";

type Props = { slug: string; commentId: number };

export const DeleteCommentButton = ({ slug, commentId }: Props) => {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      try {
        await deleteComment(slug, commentId);
        router.refresh();
      } catch {
        // #115 — network / 5xx makes the row stay put silently under
        // the old flow; surface the failure so the user knows to retry.
        toast.error("Couldn't delete comment — please try again");
      }
    });
  };

  return (
    <button
      type="button"
      className="mod-options"
      aria-label="Delete comment"
      aria-busy={isPending}
      disabled={isPending}
      onClick={onClick}
    >
      <span aria-hidden="true">🗑</span>
    </button>
  );
};

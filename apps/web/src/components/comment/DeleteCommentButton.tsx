"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteComment } from "@/features/comments/actions";

type Props = { slug: string; commentId: number };

export const DeleteCommentButton = ({ slug, commentId }: Props) => {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      await deleteComment(slug, commentId);
      router.refresh();
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

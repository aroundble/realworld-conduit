"use client";

import { useActionState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  postCommentAction,
  type PostCommentResult,
} from "@/features/comments/actions";

type Props = { slug: string; avatar: string | null; username: string };

// Authenticated comment compose box. useActionState drives the
// submission; on success we reset the textarea + call
// `router.refresh()` to pull in the new comment (AC scenario 6).
// Refresh runs from the client after the action resolves so the
// ordering DB-write → refetch stays strict — see #76.
export const CommentForm = ({ slug, avatar, username }: Props) => {
  const action = postCommentAction.bind(null, slug);
  const [state, formAction, isPending] = useActionState<
    PostCommentResult | null,
    FormData
  >(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="card comment-form"
      aria-label="Post a comment"
    >
      <div className="card-block">
        <textarea
          name="body"
          className="form-control"
          placeholder="Write a comment..."
          rows={3}
          aria-label="Comment body"
          required
        />
      </div>
      <div className="card-footer">
        {avatar ? (
          // Tiny author avatar; see Navbar / ArticlePreview for the
          // established pattern of plain <img> over next/image here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={`${username} avatar`}
            className="comment-author-img"
          />
        ) : null}
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={isPending}
          aria-busy={isPending}
        >
          Post Comment
        </button>
      </div>
      {state && !state.ok ? (
        <ul className="error-messages" role="alert">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
};

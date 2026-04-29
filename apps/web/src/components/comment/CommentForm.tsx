"use client";

import { useActionState, useRef, useEffect } from "react";
import {
  postCommentAction,
  type PostCommentResult,
} from "@/features/comments/actions";

type Props = { slug: string; avatar: string | null; username: string };

// Authenticated comment compose box. useActionState drives the
// submission; on success we reset the textarea (the list below
// re-renders from revalidatePath so the new comment appears at the
// top per AC scenario 6). Errors render in-form.
export const CommentForm = ({ slug, avatar, username }: Props) => {
  const action = postCommentAction.bind(null, slug);
  const [state, formAction, isPending] = useActionState<
    PostCommentResult | null,
    FormData
  >(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

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

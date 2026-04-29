"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCommentAction } from "@/features/comments/actions";

// Inline editor for a single comment (#159). Renders the body as
// static text by default; owner clicks "Edit" → the <p> swaps to
// a <textarea> + Save / Cancel. Save calls the server action,
// updates the rendered body optimistically, then router.refresh()
// to reconcile the (edited) badge + updatedAt from the server.
//
// The Edit + Delete buttons coexist — Delete stays in the parent
// (DeleteCommentButton) so this component only owns the edit flow.

type Props = {
  slug: string;
  commentId: number;
  initialBody: string;
  canEdit: boolean;
};

export const EditableCommentBody = ({
  slug,
  commentId,
  initialBody,
  canEdit,
}: Props) => {
  const [body, setBody] = useState(initialBody);
  const [draft, setDraft] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEditing = () => {
    setDraft(body);
    setErrors([]);
    setEditing(true);
    // Focus the textarea on next paint so the cursor lands at the
    // end of the existing body — matches the "Edit" UX pattern on
    // Substack / Medium (focus, don't re-select).
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  const cancelEditing = () => {
    setDraft(body);
    setErrors([]);
    setEditing(false);
  };

  const save = () => {
    startTransition(async () => {
      const result = await updateCommentAction(slug, commentId, draft);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      // Optimistic render of the new body so the user sees their
      // edit immediately; router.refresh() then pulls the updated
      // envelope (including the fresh updatedAt for the edited
      // badge in CommentItem).
      setBody(result.comment.body);
      setErrors([]);
      setEditing(false);
      router.refresh();
    });
  };

  if (!canEdit) {
    return (
      <div className="card-block">
        <p className="card-text">{body}</p>
      </div>
    );
  }

  return (
    <div className="card-block">
      {editing ? (
        <div className="comment-edit">
          <textarea
            ref={textareaRef}
            className="form-control"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isPending}
            aria-label="Edit comment"
            data-testid={`comment-edit-textarea-${commentId}`}
          />
          {errors.length > 0 ? (
            <ul
              className="error-messages"
              role="alert"
              data-testid={`comment-edit-errors-${commentId}`}
            >
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div className="comment-edit-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={save}
              disabled={isPending}
              aria-busy={isPending}
              data-testid={`comment-edit-save-${commentId}`}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={cancelEditing}
              disabled={isPending}
              data-testid={`comment-edit-cancel-${commentId}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="card-text" data-testid={`comment-body-${commentId}`}>
            {body}
          </p>
          <button
            type="button"
            className="comment-edit-trigger"
            onClick={startEditing}
            data-testid={`comment-edit-trigger-${commentId}`}
            aria-label="Edit comment"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
};

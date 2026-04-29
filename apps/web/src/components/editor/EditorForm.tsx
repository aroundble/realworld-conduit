"use client";

import { useActionState, useState } from "react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import {
  createArticleAction,
  updateArticleAction,
} from "@/features/articles/actions";
import { editorSchema } from "@/features/articles/schema";
import { TagInput } from "./TagInput";
import {
  draftKeyFor,
  useDraftAutosave,
  type DraftPayload,
} from "./useDraftAutosave";

type LastResult = {
  initialValue?: Record<string, string | string[] | undefined>;
} | null;

const echoed = (
  lastResult: LastResult,
  field: string,
  fallback: string,
): string => {
  const raw = lastResult?.initialValue?.[field];
  if (typeof raw === "string") return raw;
  return fallback;
};

export type EditorInitial = {
  slug?: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
};

type Props = { initial?: EditorInitial };

// Relative-time formatter for the restore banner. Using Intl for
// localisation correctness; falls back to a naive minute count on
// engines that don't ship RelativeTimeFormat (unlikely in a 2026
// browser, but the try-shim keeps the banner useful either way).
const formatAgo = (savedAt: number): string => {
  const diffMs = Date.now() - savedAt;
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  try {
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    return rtf.format(-minutes, "minute");
  } catch {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
};

// Editor form (#19). On create (no `initial`) wires createArticleAction;
// on edit (initial.slug defined) wires updateArticleAction bound to the
// existing slug. Validation mirrors the API so most errors surface
// inline before the POST; API-origin errors (422 / 403) land via
// mergeEditorErrors in the action.
//
// Draft autosave (#137): every 3s after last keystroke, the form's
// title / description / body / tagList are written to localStorage
// under `conduit-draft-new` (or `conduit-draft-edit-<slug>`). On
// remount, a restore banner offers Keep / Discard. Successful
// submit clears the key from the client-side onSubmit handler —
// the server action doesn't see localStorage.
export const EditorForm = ({ initial }: Props) => {
  const isEdit = Boolean(initial?.slug);
  const boundAction = isEdit
    ? updateArticleAction.bind(null, initial!.slug!)
    : createArticleAction;

  const draftKey = draftKeyFor(initial?.slug);
  const { formRef, restoredDraft, dismissRestore, discard, clear, hasStorage } =
    useDraftAutosave(draftKey);

  // When the user clicks Keep, we swap the form's initial values
  // to the draft and remount via a new key, so defaultValue picks
  // up the draft content. Stored here so the banner's dismissal
  // and the remount flow both see the same source of truth.
  const [appliedDraft, setAppliedDraft] = useState<DraftPayload | null>(null);

  const [lastResult, action] = useActionState(boundAction, null);
  const [form, fields] = useForm({
    lastResult,
    onValidate: ({ formData }) =>
      parseWithZod(formData, { schema: editorSchema }),
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const formErrors = form.errors ?? [];
  const fieldErrors = {
    title: fields.title.errors ?? [],
    description: fields.description.errors ?? [],
    body: fields.body.errors ?? [],
  };
  const allErrors = [
    ...formErrors,
    ...fieldErrors.title,
    ...fieldErrors.description,
    ...fieldErrors.body,
  ];

  const typed = lastResult as LastResult;
  // Order of precedence for the initial field values:
  // 1. A failed server action echoes back the last form submission
  //    (via `lastResult.initialValue`) so the user keeps what they
  //    typed.
  // 2. Applied draft from localStorage (user clicked Keep).
  // 3. `initial` prop (edit-mode seed data).
  // 4. Empty string.
  const fallback = {
    title: appliedDraft?.title ?? initial?.title ?? "",
    description:
      appliedDraft?.description ?? initial?.description ?? "",
    body: appliedDraft?.body ?? initial?.body ?? "",
  };
  const remountKey = typed?.initialValue
    ? `echo-${echoed(typed, "title", fallback.title)}`
    : appliedDraft
      ? `draft-${appliedDraft.savedAt}`
      : `initial-${initial?.slug ?? "new"}`;

  // Restore banner: visible when storage is available, a draft was
  // found on mount, and the user hasn't acted on it yet. Once
  // applied (Keep) or discarded (Discard), the banner hides.
  const showBanner = hasStorage && restoredDraft !== null && appliedDraft === null;

  const onKeep = () => {
    if (restoredDraft !== null) {
      setAppliedDraft(restoredDraft);
    }
    dismissRestore();
  };

  const onDiscard = () => {
    discard();
  };

  // Submit path: call conform's onSubmit first so validation runs,
  // then clear the draft. Server action succeeds → redirect;
  // server action fails → stays on page, draft cleared (user's
  // mid-edit state still in DOM; next debounce write re-populates).
  // That's fine — it treats a failed submit as "your draft is still
  // accurate, re-save from current DOM" rather than "restore old
  // draft", which is the simpler mental model.
  const onFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    form.onSubmit(event);
    if (!event.defaultPrevented) {
      clear();
    }
  };

  const tagListInitial =
    appliedDraft?.tagList ?? initial?.tagList ?? [];

  return (
    <>
      {showBanner && restoredDraft ? (
        <div
          className="editor-draft-banner"
          role="status"
          aria-live="polite"
          data-testid="draft-restore-banner"
        >
          <span>Restored draft from {formatAgo(restoredDraft.savedAt)}</span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onKeep}
            data-testid="draft-keep"
          >
            Keep
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={onDiscard}
            data-testid="draft-discard"
          >
            Discard
          </button>
        </div>
      ) : null}
      <form
        id={form.id}
        action={action}
        onSubmit={onFormSubmit}
        ref={formRef}
        noValidate
        aria-label="Editor"
      >
        {allErrors.length > 0 ? (
          <ul className="error-messages">
            {allErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        ) : null}
        <fieldset>
          <fieldset className="form-group">
            <input
              key={`title-${remountKey}`}
              id={fields.title.id}
              form={fields.title.formId}
              type="text"
              name={fields.title.name}
              defaultValue={echoed(typed, "title", fallback.title)}
              className="form-control form-control-lg"
              placeholder="Article Title"
              aria-invalid={fieldErrors.title.length > 0 || undefined}
            />
          </fieldset>
          <fieldset className="form-group">
            <input
              key={`description-${remountKey}`}
              id={fields.description.id}
              form={fields.description.formId}
              type="text"
              name={fields.description.name}
              defaultValue={echoed(
                typed,
                "description",
                fallback.description,
              )}
              className="form-control"
              placeholder="What's this article about?"
              aria-invalid={fieldErrors.description.length > 0 || undefined}
            />
          </fieldset>
          <fieldset className="form-group">
            <textarea
              key={`body-${remountKey}`}
              id={fields.body.id}
              form={fields.body.formId}
              name={fields.body.name}
              defaultValue={echoed(typed, "body", fallback.body)}
              rows={8}
              className="form-control"
              placeholder="Write your article (in markdown)"
              aria-invalid={fieldErrors.body.length > 0 || undefined}
            />
          </fieldset>
          <TagInput
            key={`tags-${remountKey}`}
            name={fields.tagList.name}
            initialTags={tagListInitial}
          />
          <button
            type="submit"
            className="btn btn-lg pull-xs-right btn-primary"
          >
            Publish Article
          </button>
        </fieldset>
      </form>
    </>
  );
};

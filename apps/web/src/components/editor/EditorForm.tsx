"use client";

import { useActionState } from "react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import {
  createArticleAction,
  updateArticleAction,
} from "@/features/articles/actions";
import { editorSchema } from "@/features/articles/schema";
import { TagInput } from "./TagInput";

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

// Editor form (#19). On create (no `initial`) wires createArticleAction;
// on edit (initial.slug defined) wires updateArticleAction bound to the
// existing slug. Validation mirrors the API so most errors surface
// inline before the POST; API-origin errors (422 / 403) land via
// mergeEditorErrors in the action.
export const EditorForm = ({ initial }: Props) => {
  const isEdit = Boolean(initial?.slug);
  const boundAction = isEdit
    ? updateArticleAction.bind(null, initial!.slug!)
    : createArticleAction;

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
  const fallback = {
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    body: initial?.body ?? "",
  };
  const remountKey = typed?.initialValue
    ? `echo-${echoed(typed, "title", fallback.title)}`
    : `initial-${initial?.slug ?? "new"}`;

  return (
    <form
      id={form.id}
      action={action}
      onSubmit={form.onSubmit}
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
            defaultValue={echoed(typed, "description", fallback.description)}
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
          name={fields.tagList.name}
          initialTags={initial?.tagList ?? []}
        />
        <button
          type="submit"
          className="btn btn-lg pull-xs-right btn-primary"
        >
          Publish Article
        </button>
      </fieldset>
    </form>
  );
};

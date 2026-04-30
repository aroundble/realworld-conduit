"use client";

import { useActionState } from "react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { AvatarUpload } from "./AvatarUpload";
import { logoutAction, updateUserAction } from "./actions";
import { settingsSchema } from "./schema";

type LastResult = {
  initialValue?: Record<string, string | string[] | undefined>;
} | null;

const echoed = (lastResult: LastResult, field: string, fallback: string): string => {
  const raw = lastResult?.initialValue?.[field];
  if (typeof raw === "string") return raw;
  return fallback;
};

export type CurrentUser = {
  email: string;
  username: string;
  bio: string | null;
  image: string | null;
};

type Props = { currentUser: CurrentUser };

// Authenticated settings form (#21). Pattern parallels LoginForm /
// RegisterForm — useActionState + conform-to — with prefilled fields
// from the server-rendered current user envelope. Logout is a sibling
// plain <form action={logoutAction}> below the update button so the
// browser POSTs the server action directly (no JS needed).
export const SettingsForm = ({ currentUser }: Props) => {
  const [lastResult, action] = useActionState(updateUserAction, null);
  const [form, fields] = useForm({
    lastResult,
    onValidate: ({ formData }) =>
      parseWithZod(formData, { schema: settingsSchema }),
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const formErrors = form.errors ?? [];
  const fieldErrors = {
    image: fields.image.errors ?? [],
    username: fields.username.errors ?? [],
    bio: fields.bio.errors ?? [],
    email: fields.email.errors ?? [],
    password: fields.password.errors ?? [],
  };
  const allErrors = [
    ...formErrors,
    ...fieldErrors.image,
    ...fieldErrors.username,
    ...fieldErrors.bio,
    ...fieldErrors.email,
    ...fieldErrors.password,
  ];

  const typed = lastResult as LastResult;
  // Remount inputs when the action replied with echoed values so
  // conform-to repopulates the defaults; matches the LoginForm pattern.
  const remountKey = typed?.initialValue
    ? `echo-${echoed(typed, "username", currentUser.username)}`
    : `initial-${currentUser.username}`;

  return (
    <>
      <form
        id={form.id}
        action={action}
        onSubmit={form.onSubmit}
        noValidate
        aria-label="Settings"
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
              key={`image-${remountKey}`}
              id={fields.image.id}
              form={fields.image.formId}
              type="text"
              name={fields.image.name}
              defaultValue={echoed(typed, "image", currentUser.image ?? "")}
              className="form-control"
              placeholder="URL of profile picture"
              aria-invalid={fieldErrors.image.length > 0 || undefined}
            />
            {/* Avatar upload (#169). Sits under the text URL input
                so paste-a-URL still works for users with externally-
                hosted images; local upload writes back into the
                same field via a native-setter + input event. */}
            <AvatarUpload
              imageInputId={fields.image.id}
              initialUrl={currentUser.image}
            />
          </fieldset>
          <fieldset className="form-group">
            <input
              key={`username-${remountKey}`}
              id={fields.username.id}
              form={fields.username.formId}
              type="text"
              name={fields.username.name}
              defaultValue={echoed(typed, "username", currentUser.username)}
              className="form-control form-control-lg"
              placeholder="Your Name"
              aria-invalid={fieldErrors.username.length > 0 || undefined}
            />
          </fieldset>
          <fieldset className="form-group">
            <textarea
              key={`bio-${remountKey}`}
              id={fields.bio.id}
              form={fields.bio.formId}
              name={fields.bio.name}
              defaultValue={echoed(typed, "bio", currentUser.bio ?? "")}
              rows={8}
              className="form-control form-control-lg"
              placeholder="Short bio about you"
              aria-invalid={fieldErrors.bio.length > 0 || undefined}
            />
          </fieldset>
          <fieldset className="form-group">
            <input
              key={`email-${remountKey}`}
              id={fields.email.id}
              form={fields.email.formId}
              type="email"
              name={fields.email.name}
              defaultValue={echoed(typed, "email", currentUser.email)}
              className="form-control form-control-lg"
              placeholder="Email"
              aria-invalid={fieldErrors.email.length > 0 || undefined}
            />
          </fieldset>
          <fieldset className="form-group">
            <input
              key={`password-${remountKey}`}
              id={fields.password.id}
              form={fields.password.formId}
              type="password"
              name={fields.password.name}
              className="form-control form-control-lg"
              placeholder="New Password"
              autoComplete="new-password"
              aria-invalid={fieldErrors.password.length > 0 || undefined}
            />
          </fieldset>
          <button
            type="submit"
            className="btn btn-lg btn-primary pull-xs-right"
          >
            Update Settings
          </button>
        </fieldset>
      </form>

      <hr />

      {/* Logout is a separate form so it doesn't inherit SettingsForm's
          updateUserAction. Plain server-action POST — no JS required. */}
      <form action={logoutAction}>
        <button
          type="submit"
          className="btn btn-outline-danger"
        >
          Or click here to logout.
        </button>
      </form>
    </>
  );
};

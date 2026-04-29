"use client";

import { useActionState } from "react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { registerAction } from "./actions";
import { registerSchema } from "./schema";

// Conform-wrapped register form. Progressive enhancement: the `<form
// action={...}>` prop works without JS by posting to the Server Action
// route, and `useActionState` layers client-side re-render on top once
// JS runs. Client-side zod validation (`onValidate`) short-circuits the
// network call for purely-structural mistakes — the matching server-
// side parse in the action is the source of truth.
//
// When the server action replies with an error, its SubmissionResult
// carries the submitted payload in `initialValue`. We thread that
// straight onto the inputs' `defaultValue` (keyed so React remounts
// with the new defaults) — conform-to's internal `defaultValue`
// snapshots on first mount only, so it won't rehydrate the inputs
// for us on the re-render. Spec #16 AC: "username and email are
// preserved (not cleared)" after a 422 from the API.

type LastResult = {
  initialValue?: Record<string, string | string[] | undefined>;
} | null;

const echoed = (lastResult: LastResult, field: string): string => {
  const raw = lastResult?.initialValue?.[field];
  return typeof raw === "string" ? raw : "";
};

export const RegisterForm = () => {
  const [lastResult, action] = useActionState(registerAction, null);
  const [form, fields] = useForm({
    lastResult,
    onValidate: ({ formData }) =>
      parseWithZod(formData, { schema: registerSchema }),
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const formErrors = form.errors ?? [];
  const usernameErrors = fields.username.errors ?? [];
  const emailErrors = fields.email.errors ?? [];
  const passwordErrors = fields.password.errors ?? [];
  const allErrors = [
    ...formErrors,
    ...usernameErrors,
    ...emailErrors,
    ...passwordErrors,
  ];

  const typed = lastResult as LastResult;
  // Keys flip on every reply so React remounts the inputs with the
  // freshly-echoed defaults.
  const remountKey = typed?.initialValue
    ? `echo-${echoed(typed, "username")}-${echoed(typed, "email")}`
    : "initial";

  return (
    <form id={form.id} action={action} onSubmit={form.onSubmit} noValidate>
      {allErrors.length > 0 ? (
        <ul className="error-messages">
          {allErrors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      ) : null}
      <fieldset className="form-group">
        <input
          key={`username-${remountKey}`}
          id={fields.username.id}
          form={fields.username.formId}
          type="text"
          name={fields.username.name}
          defaultValue={echoed(typed, "username")}
          className="form-control form-control-lg"
          placeholder="Your Name"
          aria-invalid={usernameErrors.length > 0 || undefined}
          aria-describedby={
            usernameErrors.length > 0 ? fields.username.errorId : undefined
          }
        />
      </fieldset>
      <fieldset className="form-group">
        <input
          key={`email-${remountKey}`}
          id={fields.email.id}
          form={fields.email.formId}
          type="email"
          name={fields.email.name}
          defaultValue={echoed(typed, "email")}
          className="form-control form-control-lg"
          placeholder="Email"
          aria-invalid={emailErrors.length > 0 || undefined}
          aria-describedby={
            emailErrors.length > 0 ? fields.email.errorId : undefined
          }
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
          placeholder="Password"
          autoComplete="new-password"
          aria-invalid={passwordErrors.length > 0 || undefined}
          aria-describedby={
            passwordErrors.length > 0 ? fields.password.errorId : undefined
          }
        />
      </fieldset>
      <button className="btn btn-lg btn-primary pull-xs-right" type="submit">
        Sign up
      </button>
    </form>
  );
};

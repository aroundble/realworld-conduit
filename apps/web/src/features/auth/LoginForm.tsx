"use client";

import { useActionState } from "react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { loginAction } from "./actions";
import { loginSchema } from "./schema";

type LastResult = {
  initialValue?: Record<string, string | string[] | undefined>;
} | null;

const echoed = (lastResult: LastResult, field: string): string => {
  const raw = lastResult?.initialValue?.[field];
  return typeof raw === "string" ? raw : "";
};

export const LoginForm = () => {
  const [lastResult, action] = useActionState(loginAction, null);
  const [form, fields] = useForm({
    lastResult,
    onValidate: ({ formData }) =>
      parseWithZod(formData, { schema: loginSchema }),
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const formErrors = form.errors ?? [];
  const emailErrors = fields.email.errors ?? [];
  const passwordErrors = fields.password.errors ?? [];
  const allErrors = [...formErrors, ...emailErrors, ...passwordErrors];

  const typed = lastResult as LastResult;
  const remountKey = typed?.initialValue
    ? `echo-${echoed(typed, "email")}`
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
          autoComplete="current-password"
          aria-invalid={passwordErrors.length > 0 || undefined}
          aria-describedby={
            passwordErrors.length > 0 ? fields.password.errorId : undefined
          }
        />
      </fieldset>
      <button className="btn btn-lg btn-primary pull-xs-right" type="submit">
        Sign in
      </button>
    </form>
  );
};

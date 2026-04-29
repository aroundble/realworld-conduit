"use server";

import { redirect } from "next/navigation";
import { parseWithZod } from "@conform-to/zod/v4";
import { apiFetch } from "@/lib/api/client";
import { loginSchema, registerSchema } from "./schema";
import { writeSession } from "./session";

// Pattern adapted from yukicountry/realworld-nextjs-rsc @ f455599f
// (`src/modules/features/auth/actions.ts`, MIT). The shape — Server
// Action + @conform-to/zod parse + SubmissionResult reply on failure —
// is the same; the transport is ours (our cookie-first API per ADR 004,
// not the demo remote).
//
// Failure returns a SubmissionResult so @conform-to/react can render
// per-field errors on the client. Success redirects, which throws the
// special NEXT_REDIRECT — we never return from the success branch.

type UserEnvelope = {
  user: {
    email: string;
    token: string;
    username: string;
    bio: string | null;
    image: string | null;
  };
};

type ApiErrors = { errors?: Record<string, string[]> };

// Map the API's 422 `{ errors: { email: ["has already been taken"] } }`
// into conform-to's `{ field: [msg] }` shape, keying every error under
// the form's canonical field name so the inline error element renders
// next to the right input. Unknown keys (e.g. the API's generic "body"
// validation failures) surface on the form root.
const mergeApiErrors = (
  api: ApiErrors,
  knownFields: readonly string[],
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [field, msgs] of Object.entries(api.errors ?? {})) {
    if (knownFields.includes(field)) {
      out[field] = msgs.map((m) => `${field} ${m}`);
    } else {
      out[""] = [...(out[""] ?? []), ...msgs.map((m) => `${field} ${m}`)];
    }
  }
  if (Object.keys(out).length === 0) {
    out[""] = ["something went wrong — please try again"];
  }
  return out;
};

export const registerAction = async (
  _prev: unknown,
  formData: FormData,
) => {
  const submission = parseWithZod(formData, { schema: registerSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }

  const res = await apiFetch<UserEnvelope>("/api/users", {
    method: "POST",
    body: JSON.stringify({ user: submission.value }),
  });

  if (!res.ok) {
    if (res.status === 422) {
      return submission.reply({
        fieldErrors: mergeApiErrors(res.data, ["username", "email", "password"]),
      });
    }
    return submission.reply({
      formErrors: ["server error — please try again"],
    });
  }

  await writeSession(res.setCookie, {
    username: res.data.user.username,
    image: res.data.user.image,
  });
  redirect("/");
};

export const loginAction = async (
  _prev: unknown,
  formData: FormData,
) => {
  const submission = parseWithZod(formData, { schema: loginSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }

  const res = await apiFetch<UserEnvelope>("/api/users/login", {
    method: "POST",
    body: JSON.stringify({ user: submission.value }),
  });

  if (!res.ok) {
    // 401 here means "email or password is invalid" — the API emits
    // `{ errors: { "email or password": ["is invalid"] } }`. The key
    // has a space in it (spec-mandated), so we surface it as a form-
    // level error rather than trying to map it to a field.
    if (res.status === 401) {
      return submission.reply({
        formErrors: ["email or password is invalid"],
      });
    }
    if (res.status === 422) {
      return submission.reply({
        fieldErrors: mergeApiErrors(res.data, ["email", "password"]),
      });
    }
    return submission.reply({
      formErrors: ["server error — please try again"],
    });
  }

  await writeSession(res.setCookie, {
    username: res.data.user.username,
    image: res.data.user.image,
  });
  redirect("/");
};

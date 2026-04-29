"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseWithZod } from "@conform-to/zod/v4";
import { apiFetch } from "@/lib/api/client";
import { loginSchema, registerSchema, settingsSchema } from "./schema";
import {
  SESSION_COOKIE,
  USER_COOKIE,
  readSessionCookie,
  writeSession,
} from "./session";

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

// Map the API's field-keyed error envelope (422 for validation, 409
// for duplicate on register) into conform-to's `{ field: [msg] }`
// shape, keying every error under the form's canonical field name so
// the inline error element renders next to the right input. Unknown
// keys (e.g. the API's generic "body" validation failures) surface
// on the form root.
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
    // 409 = duplicate username/email (per #66), 422 = other field
    // validation. Both carry the same `{errors:{field:[msg]}}` shape
    // so the field-error mapping is identical.
    if (res.status === 409 || res.status === 422) {
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

// (loginAction follows)
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
    // 401 here means the credentials didn't match. The API emits the
    // canonical RealWorld envelope `{ errors: { credentials: ["invalid"] } }`
    // (per #62); we surface a user-facing form-level message rather
    // than echoing the field-keyed envelope because "credentials" is
    // not a form field and "invalid" is too terse to read in the UI.
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

// Settings update (#21). On success the API returns a fresh UserEnvelope
// + Set-Cookie (the token rotates whenever password changes and stays
// stable otherwise — either way we re-write the session cookie so the
// browser carries the latest). Success redirects to the user's profile.
export const updateUserAction = async (
  _prev: unknown,
  formData: FormData,
) => {
  const submission = parseWithZod(formData, { schema: settingsSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const v = submission.value;

  // Strip empty strings on optional fields so the API update is a
  // proper partial — blank image/bio/password stay omitted (no change)
  // rather than sent as "" and routed through the #64 empty-string
  // coerce. Explicit clears are a different UX not exposed today.
  const cookie = await readSessionCookie();
  if (!cookie) {
    redirect("/login?redirect=/settings");
  }
  const payload: Record<string, string> = {
    username: v.username,
    email: v.email,
  };
  if (v.image && v.image.length > 0) payload.image = v.image;
  if (v.bio && v.bio.length > 0) payload.bio = v.bio;
  if (v.password && v.password.length > 0) payload.password = v.password;

  const res = await apiFetch<UserEnvelope>("/api/user", {
    method: "PUT",
    cookie: `${SESSION_COOKIE}=${cookie}`,
    body: JSON.stringify({ user: payload }),
  });
  if (!res.ok) {
    if (res.status === 422) {
      return submission.reply({
        fieldErrors: mergeApiErrors(res.data, [
          "username",
          "email",
          "password",
          "bio",
          "image",
        ]),
      });
    }
    return submission.reply({
      formErrors: ["server error — please try again"],
    });
  }

  // API rotated the token (always new jti, fresh on password change).
  // writeSession refreshes both cookies so the authed chrome + any
  // downstream API calls carry the new credential.
  await writeSession(res.setCookie, {
    username: res.data.user.username,
    image: res.data.user.image,
  });
  redirect(`/profile/${encodeURIComponent(res.data.user.username)}`);
};

// Logout (#21 scenario 5). Clears both cookies and redirects home.
export const logoutAction = async (): Promise<never> => {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(USER_COOKIE);
  redirect("/");
};

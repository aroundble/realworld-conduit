import { z } from "@hono/zod-openapi";

export const UserSchema = z
  .object({
    email: z.string(),
    token: z.string(),
    username: z.string(),
    bio: z.string().nullable(),
    image: z.string().nullable(),
  })
  .openapi("User");

export const UserResponseSchema = z
  .object({ user: UserSchema })
  .openapi("UserResponse");

export const RegisterRequestSchema = z
  .object({
    user: z.object({
      username: z.string().min(1, "can't be blank").max(100),
      email: z.string().email("is not a valid email"),
      password: z.string().min(8, "is too short (minimum is 8 characters)").max(200),
    }),
  })
  .openapi("RegisterRequest");

export const LoginRequestSchema = z
  .object({
    user: z.object({
      email: z.string().email("is not a valid email"),
      password: z.string().min(1, "can't be blank"),
    }),
  })
  .openapi("LoginRequest");

// Empty string → null coercion for nullable user-update fields.
// Spec treats `{"bio":""}` / `{"image":""}` as "clear this field"
// and expects the response to echo `null` + persist null (see #64).
// Apply to the bio + image branches only — email/username/password
// stay required-string shaped because the spec rejects empty strings
// there (see #65 / errors-auth/12-update-email-to-empty-string-
// should-reject.bru).
const emptyToNull = <T extends z.ZodType<string, unknown>>(inner: T) =>
  z.preprocess((v) => (v === "" ? null : v), inner.nullable());

export const UpdateUserRequestSchema = z
  .object({
    user: z
      .object({
        email: z.string().email("is not a valid email").optional(),
        username: z.string().min(1, "can't be blank").max(100).optional(),
        password: z
          .string()
          .min(8, "is too short (minimum is 8 characters)")
          .max(200)
          .optional(),
        bio: emptyToNull(z.string().max(2000)).optional(),
        image: emptyToNull(z.string().url("is not a valid url")).optional(),
      })
      .refine(
        (u) => Object.values(u).some((v) => v !== undefined),
        { message: "at least one field must be provided" },
      ),
  })
  .openapi("UpdateUserRequest");

export const ErrorResponseSchema = z
  .object({ errors: z.record(z.string(), z.array(z.string())) })
  .openapi("ErrorResponse");

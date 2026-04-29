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
        bio: z.string().max(2000).nullable().optional(),
        image: z.string().url("is not a valid url").nullable().optional(),
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

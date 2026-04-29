import { z } from "zod";

// The shapes mirror the API's RegisterRequestSchema / LoginRequestSchema
// field-for-field so server-side validation rejects the same inputs the
// API would, preventing a wasted round-trip when JS is on (scenario 3
// in issue #16). Error messages here are what the user sees inline;
// API-origin errors (e.g. "email has already been taken") are merged in
// the server action after a 422 response.

export const registerSchema = z.object({
  username: z
    .string({ message: "username can't be blank" })
    .min(1, "username can't be blank")
    .max(100, "username is too long (maximum is 100 characters)"),
  email: z
    .string({ message: "email can't be blank" })
    .min(1, "email can't be blank")
    .email("email must be a valid email"),
  password: z
    .string({ message: "password can't be blank" })
    .min(1, "password can't be blank")
    .min(8, "password is too short (minimum is 8 characters)"),
});

export const loginSchema = z.object({
  email: z
    .string({ message: "email can't be blank" })
    .min(1, "email can't be blank")
    .email("email must be a valid email"),
  password: z
    .string({ message: "password can't be blank" })
    .min(1, "password can't be blank"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

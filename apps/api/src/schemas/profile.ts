import { z } from "@hono/zod-openapi";

export const ProfileSchema = z
  .object({
    username: z.string(),
    bio: z.string().nullable(),
    image: z.string().nullable(),
    following: z.boolean(),
  })
  .openapi("Profile");

export const ProfileResponseSchema = z
  .object({ profile: ProfileSchema })
  .openapi("ProfileResponse");

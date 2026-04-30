import { z } from "@hono/zod-openapi";

export const UploadResponseSchema = z
  .object({
    url: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .openapi("UploadResponse");

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

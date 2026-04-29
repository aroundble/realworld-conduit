import { z } from "zod";

// Mirrors the API's CreateArticleRequestSchema field-for-field — the
// editor submits the same shape whether creating or updating (the
// update case sends a partial, but the required fields still have to
// pass client-side on "Publish" so we don't round-trip a 422).
export const editorSchema = z.object({
  title: z
    .string({ message: "title can't be blank" })
    .min(1, "title can't be blank")
    .max(300, "title is too long (maximum is 300 characters)"),
  description: z
    .string({ message: "description can't be blank" })
    .min(1, "description can't be blank")
    .max(1000, "description is too long (maximum is 1000 characters)"),
  body: z
    .string({ message: "body can't be blank" })
    .min(1, "body can't be blank")
    .max(50_000, "body is too long (maximum is 50000 characters)"),
  // tagList rides as a hidden JSON-encoded input from the TagInput
  // component. We decode + validate array shape here.
  tagList: z
    .string()
    .optional()
    .transform((s) => {
      if (!s) return [] as string[];
      try {
        const parsed = JSON.parse(s) as unknown;
        if (!Array.isArray(parsed)) return [] as string[];
        return parsed.filter((t): t is string => typeof t === "string");
      } catch {
        return [] as string[];
      }
    }),
});

export type EditorInput = z.infer<typeof editorSchema>;

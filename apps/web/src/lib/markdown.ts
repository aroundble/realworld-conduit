import "server-only";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

// Markdown pipeline for article bodies.
//
// Adapted from yukicountry/realworld-nextjs-rsc @ f455599f
// (MIT, attributed in ADR 000 §12). The yukicountry chain is
// unified → remark-parse → remark-rehype → rehype-stringify.
// We add **rehype-sanitize** in the middle — the upstream omits it,
// and without it `<script>` / `<iframe>` / event-handler attributes
// ride the article body straight into the DOM (XSS). Deliberate
// redesign vs upstream; non-negotiable per ADR 000 §12.
//
// Server-only so the (moderately heavy) ESM-only pipeline never
// leaks into the client bundle — renders happen during the article
// page's RSC pass.

// Start from rehype-sanitize's default schema (GitHub-style — the
// same safe subset rehype-sanitize README recommends) and re-allow
// the two attributes our article body actually uses: `className`
// (the remark-rehype output carries it for syntax blocks) and
// `target` / `rel` on anchor tags (so external links open in a new
// tab with noopener, the a11y-friendly default).
const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["target", "_blank"],
      ["rel", "noopener", "noreferrer"],
    ],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify);

export const renderMarkdown = async (body: string): Promise<string> => {
  const file = await processor.process(body);
  return String(file);
};

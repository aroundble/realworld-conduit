// Article read-time estimate (#125). Medium's convention: 238 words
// per minute, round up, minimum 1 minute so a one-sentence post still
// reads as "1 min read".
//
// Word split is whitespace-based on the raw Markdown body. Code
// fences, tables, and inline HTML that `rehype-sanitize` may rewrite
// later are counted by their source tokens — good enough for an
// expectation-setter, and cheap. Per the AC: we run against the
// Markdown source (before HTML rewrite) so formatting syntax
// (`**bold**`, `[text](url)`) contributes as users wrote it, not as
// the rendered DOM exposes it.

const WORDS_PER_MINUTE = 238;

export const computeReadTimeMinutes = (body: string): number => {
  if (!body) return 1;
  // `.trim()` then `.split(/\s+/)` is the canonical Medium / dev.to
  // approach — whitespace-separated tokens, empty string fast-paths
  // to 1. A body of "   " (only whitespace) returns 1 because we
  // pre-trim and then a zero-length split would yield [""], length 1.
  const trimmed = body.trim();
  if (trimmed.length === 0) return 1;
  const words = trimmed.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
};

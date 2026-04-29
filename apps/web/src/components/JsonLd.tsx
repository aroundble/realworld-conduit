// JSON-LD script tag renderer (#148). Takes a serializable
// schema.org payload and emits a `<script type="application/ld+json">`
// with the JSON stringified in a way that can't be prematurely
// closed by a literal `</script>` inside a title / description /
// bio. The escape strategy: replace `</` with `<\/` in the
// serialized output. Parsers accept the escaped form as
// equivalent; a literal `</script>` inside a title no longer
// terminates the enclosing script tag.
//
// We use React's `dangerouslySetInnerHTML` because it's the only
// way to inject raw text inside a `<script>` element — React's
// normal children rendering would escape the JSON's quotes. The
// sanitize() step below is what makes the raw text safe: input
// from `JSON.stringify` has no interpretable HTML except for
// sequences containing `</`, which we rewrite to the escaped
// form before the string ever reaches the DOM. This is the
// canonical pattern documented by OWASP for embedding JSON in
// HTML (see "Embedding JSON directly in HTML" in the XSS Prevention
// Cheat Sheet).

type Props = {
  payload: Record<string, unknown>;
  // Distinct id helps the Playwright spec query multiple JsonLd
  // emissions on the same page (e.g. homepage WebSite + a stats
  // object). Defaults to type-derived so callers rarely pass it.
  id?: string;
};

// Replace every `</` occurrence with `<\/` in the serialized JSON.
// `</script>` inside a user-supplied title would otherwise close
// the enclosing <script> tag and inject attacker-controlled HTML.
const sanitizeForScriptTag = (json: string): string =>
  json.replace(/<\//g, "<\\/");

export const JsonLd = ({ payload, id }: Props) => {
  const scriptId = id ?? `jsonld-${payload["@type"] ?? "data"}`;
  const safe = sanitizeForScriptTag(JSON.stringify(payload));
  return (
    <script
      id={scriptId}
      type="application/ld+json"
      data-testid="jsonld"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
};

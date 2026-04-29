import { renderMarkdown } from "@/lib/markdown";

type Props = { body: string; tagList: string[] };

// RSC markdown render. The pipeline runs server-side through
// rehype-sanitize (lib/markdown.ts), so the returned HTML is already
// XSS-safe: scripts, event handlers, and unsafe URL protocols are
// stripped. dangerouslySetInnerHTML is the only way to inject
// pre-rendered HTML into React; the "dangerous" naming is the React
// convention, but the content here is sanitized input per ADR 000
// §12 (rehype-sanitize is non-negotiable).
//
// data-testid on the wrapper scopes the Playwright assertion in AC
// scenario 3 to the body region only.
export const ArticleBody = async ({ body, tagList }: Props) => {
  const html = await renderMarkdown(body);
  return (
    <div className="row article-content">
      <div className="col-md-12">
        <div
          className="article-body"
          data-testid="article-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {tagList.length > 0 ? (
          <ul className="tag-list">
            {tagList.map((tag) => (
              <li key={tag} className="tag-default tag-pill tag-outline">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

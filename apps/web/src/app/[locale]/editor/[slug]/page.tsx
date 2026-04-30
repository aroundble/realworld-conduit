import { notFound, redirect } from "next/navigation";
import { EditorForm } from "@/components/editor/EditorForm";
import { getArticle } from "@/features/articles/queries";
import {
  isAuthenticated,
  readCurrentUsername,
} from "@/features/auth/session";

export const metadata = { title: "Edit Article — Conduit" };

// Edit-article editor (#19). Auth-gated like the create route; also
// rejects non-author edits by redirecting to the article detail page
// (AC scenario 5) so the user sees the content they can't modify
// rather than a blank 403.
export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const authed = await isAuthenticated();
  if (!authed) {
    redirect(
      `/login?redirect=${encodeURIComponent(`/editor/${slug}`)}`,
    );
  }

  const [article, viewer] = await Promise.all([
    getArticle(slug),
    readCurrentUsername(),
  ]);
  if (!article) {
    notFound();
  }
  if (viewer !== article.author.username) {
    // Not the author — bounce to the read-only article page. The
    // detail page handles the rest; no flash copy here, the redirect
    // itself is the UX signal.
    redirect(`/article/${encodeURIComponent(slug)}`);
  }

  return (
    <div className="editor-page">
      <div className="container page">
        <div className="row">
          <div className="col-md-10 offset-md-1 col-xs-12">
            <EditorForm
              initial={{
                slug: article.slug,
                title: article.title,
                description: article.description,
                body: article.body,
                tagList: article.tagList,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

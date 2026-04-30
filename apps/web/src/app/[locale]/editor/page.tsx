import { redirect } from "next/navigation";
import { EditorForm } from "@/components/editor/EditorForm";
import { isAuthenticated } from "@/features/auth/session";

export const metadata = { title: "New Article — Conduit" };

// Create-article editor (#19). Anon viewers → /login?redirect=/editor.
export default async function NewEditorPage() {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect("/login?redirect=/editor");
  }
  return (
    <div className="editor-page">
      <div className="container page">
        <div className="row">
          <div className="col-md-10 offset-md-1 col-xs-12">
            <EditorForm />
          </div>
        </div>
      </div>
    </div>
  );
}

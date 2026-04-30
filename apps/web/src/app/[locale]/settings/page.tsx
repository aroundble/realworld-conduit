import { redirect } from "next/navigation";
import { SettingsForm } from "@/features/auth/SettingsForm";
import { getCurrentUser } from "@/features/auth/session";

export const metadata = { title: "Settings — Conduit" };

// RSC settings page (#21). Fetches the current user via GET /api/user
// so the form defaults always reflect the committed DB state (not the
// stale `conduit-user` presentation cookie). Anon viewers get a 307
// redirect to /login?redirect=/settings per AC scenario 6.
export default async function SettingsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login?redirect=/settings");
  }

  return (
    <div className="settings-page">
      <div className="container page">
        <div className="row">
          <div className="col-md-6 offset-md-3 col-xs-12">
            <h1 className="text-xs-center">Your Settings</h1>
            <SettingsForm currentUser={currentUser} />
          </div>
        </div>
      </div>
    </div>
  );
}

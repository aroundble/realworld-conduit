import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/features/auth/RegisterForm";
import { isAuthenticated } from "@/features/auth/session";

export const metadata = { title: "Sign up — Conduit" };

export default async function RegisterPage() {
  if (await isAuthenticated()) {
    redirect("/");
  }
  return (
    <div className="auth-page">
      <div className="container page">
        <div className="row">
          <div className="col-md-6 offset-md-3 col-xs-12">
            <h1 className="text-xs-center">Sign up</h1>
            <p className="text-xs-center">
              <Link href="/login">Have an account?</Link>
            </p>
            <RegisterForm />
          </div>
        </div>
      </div>
    </div>
  );
}

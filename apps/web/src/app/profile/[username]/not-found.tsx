import type { Metadata } from "next";
import Link from "next/link";

// See article/[slug]/not-found.tsx for the rationale — same pattern,
// applied to the profile 404 path (#113 AC scenario 4).
export const metadata: Metadata = {
  title: "Profile not found — Conduit",
};

export default function NotFound() {
  return (
    <div className="container page profile-not-found">
      <h1>User not found</h1>
      <p>The profile you were looking for does not exist.</p>
      <Link href="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}

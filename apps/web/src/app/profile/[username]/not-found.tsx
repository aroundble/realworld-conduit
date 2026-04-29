import Link from "next/link";

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

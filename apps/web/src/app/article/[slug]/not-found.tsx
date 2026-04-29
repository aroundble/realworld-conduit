import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container page article-not-found">
      <h1>Article not found</h1>
      <p>
        The article you were looking for does not exist or has been removed.
      </p>
      <Link href="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}

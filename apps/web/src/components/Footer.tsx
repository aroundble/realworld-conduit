import Link from "next/link";

export const Footer = () => (
  <footer>
    <div className="container">
      <Link href="/" className="logo-font">
        conduit
      </Link>
      <span className="attribution">
        An interactive learning project from{" "}
        <a href="https://thinkster.io">Thinkster</a>. Code &amp; design
        licensed under MIT.
      </span>
      <span className="attribution">
        {" "}
        See the{" "}
        <a href="https://realworld-docs.netlify.app/">RealWorld spec</a>.
      </span>
    </div>
  </footer>
);

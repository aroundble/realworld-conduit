import type { ReactNode } from "react";

export const ComingSoon = ({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) => (
  <div className="container">
    <section className="coming-soon">
      <h1>Coming soon — {title}</h1>
      {children}
    </section>
  </div>
);

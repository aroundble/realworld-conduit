"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePrefetchOnHover } from "@/lib/usePrefetchOnHover";

// Client-side wrapper around the outer article-preview <Link> so it
// can attach a hover-prefetch handler (#138). Extracted from
// ArticlePreview (a server component) because useRouter + a ref-
// based dedupe require the client boundary.

type Props = {
  href: string;
  className?: string;
  children: ReactNode;
};

export const ArticlePreviewLink = ({ href, className, children }: Props) => {
  const onMouseEnter = usePrefetchOnHover(href);
  // Next's `<Link prefetch>` defaults to lazy viewport-based prefetch.
  // Hover adds the intent signal; router.prefetch inside the hook
  // dedupes against Next's own cache so `prefetch={true}` + the
  // hover handler are belt-and-braces without double-fetching.
  return (
    <Link
      href={href}
      prefetch={true}
      className={className}
      onMouseEnter={onMouseEnter}
      onFocus={onMouseEnter}
      data-testid="article-preview-link"
    >
      {children}
    </Link>
  );
};

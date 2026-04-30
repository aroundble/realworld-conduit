import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware wrappers around next/navigation (#167a). Every
// in-app link / router.push must go through these so the locale
// prefix is preserved / switched correctly. next-intl rewrites
// `<Link href="/settings">` to `/ko/settings` when the current
// locale is ko, and the reverse when switching back to en.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { KeyboardShortcutFooterLink } from "./KeyboardShortcutFooterLink";

export const Footer = async () => {
  const t = await getTranslations("footer");
  return (
    <footer>
      <div className="container">
        <Link href="/" className="logo-font">
          conduit
        </Link>
        <span className="attribution">
          {t("attribution")}{" "}
          <a href="https://thinkster.io">Thinkster</a>. {t("license")}
        </span>
        <span className="attribution">
          {" "}
          {t("spec")}{" "}
          <a href="https://realworld-docs.netlify.app/">{t("specLink")}</a>.
        </span>
        <span className="attribution">
          {" "}
          <KeyboardShortcutFooterLink />
        </span>
      </div>
    </footer>
  );
};

import { ComingSoon } from "@/components/ComingSoon";

export const metadata = { title: "Article — Conduit" };

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ComingSoon title="Article">
      <p>
        Viewing <code>{slug}</code> — markdown rendering, comments, and
        follow/favorite controls land in issue #18.
      </p>
    </ComingSoon>
  );
}

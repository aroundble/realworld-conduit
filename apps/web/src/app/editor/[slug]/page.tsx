import { ComingSoon } from "@/components/ComingSoon";

export const metadata = { title: "Edit Article — Conduit" };

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ComingSoon title="Edit Article">
      <p>Editing article <code>{slug}</code> — issue #19.</p>
    </ComingSoon>
  );
}

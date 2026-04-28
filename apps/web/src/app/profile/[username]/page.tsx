import { ComingSoon } from "@/components/ComingSoon";

export const metadata = { title: "Profile — Conduit" };

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return (
    <ComingSoon title="Profile">
      <p>
        @{username}&rsquo;s articles and favorited tabs land in
        issue #20.
      </p>
    </ComingSoon>
  );
}

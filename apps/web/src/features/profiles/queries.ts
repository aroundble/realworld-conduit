import "server-only";
import { apiFetch } from "@/lib/api/client";
import { readSessionCookie, SESSION_COOKIE } from "@/features/auth/session";

export type Profile = {
  username: string;
  bio: string | null;
  image: string | null;
  following: boolean;
};

type ProfilePayload = { profile: Profile };

const cookieHeader = async (): Promise<string | undefined> => {
  const token = await readSessionCookie();
  return token ? `${SESSION_COOKIE}=${token}` : undefined;
};

// GET /api/profiles/:username — returns the public profile card for
// any user. 404 when the user doesn't exist; callers use that to
// drive Next's notFound() for the correct 404 flow (AC scenario 4 of
// #20). Any other non-2xx still throws so an unexpected API issue
// surfaces as a 500 rather than a silent empty page.
export const getProfile = async (username: string): Promise<Profile | null> => {
  const cookie = await cookieHeader();
  const res = await apiFetch<ProfilePayload>(
    `/api/profiles/${encodeURIComponent(username)}`,
    { cookie },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`getProfile failed: ${res.status}`);
  }
  return res.data.profile;
};
